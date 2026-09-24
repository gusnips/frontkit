/**
 * The i18n gate: what a compiler cannot see in a set of translation catalogs, checked where CI
 * runs.
 *
 * Nine repos wrote this, 4,540 lines between them: six copies of one script and three written from
 * scratch. Each copy knew a rule the others lacked, and six of them passed when a catalog failed to
 * load — they printed "skipped" and returned zero, so a broken JSON file turned the gate green.
 * This is the merge, and a catalog that does not load fails it.
 *
 * The canonical language is typed (`i18next.d.ts` reads it), so a `t()` with no key there is a
 * compile error. The other languages are not, and neither is anything inside a string. That is
 * what this checks:
 *
 * - **parity**: a key in one language is in every language, and no value is blank.
 * - **plural**: a counted key carries every form ITS language selects, read from CLDR through
 *   `Intl.PluralRules`. Portuguese and Spanish have a `many` form English does not, for exact
 *   millions: a Portuguese page showed "104 mi followers" in English for exactly 104,000,000, and
 *   15.1M on the same screen read correctly, which is why nobody saw it.
 * - **placeholders**: every `{{name}}`, its `, format`, and every `<0>` tag survive translation. A
 *   `{{nome}}` fills with nothing, and a dropped `, number` prints 5000 where the reader writes
 *   5.000.
 * - **reserved**: no placeholder borrows a name `t()` reads as an option. `{{lng}}` switches the
 *   language instead of filling the gap.
 * - **tags**: `<0>`…`</0>` open in order and close once, which is what `<Trans>` binds by.
 * - the code rules, when `code` is given: every static `t("key")` exists, a template key's prefix
 *   exists, `<Trans>` takes no fallback children, and copy with markup does not go through `t()`.
 * - **server-key**: every key the server can send resolves in every language.
 *
 * Runs on node and bun: `fs.promises.glob`, never Bun's `Glob`, and no `import.meta.dir`.
 */
import { glob, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** One i18next namespace's catalog: nested objects with strings at the leaves. */
export type Catalog = object;
/** One language's catalogs, by namespace: `{ translation: {…} }`. */
export type Catalogs = Readonly<Record<string, Catalog>>;

export interface I18nBundle {
  /** Shown beside every problem: `"apps/web"`. */
  name: string;
  locales: readonly string[];
  /** The app's `fallbackLng`: the language the others are compared to, and code keys must be in. */
  canonical: string;
  /**
   * One language's catalogs. A throw fails the check with its message — it never skips the bundle,
   * because every other rule compares languages and a missing one would pass them all.
   */
  load: (locale: string) => Catalogs | Promise<Catalogs>;
  /** Copy kept as fragments, one area per file: see `mergeFragments`. Paths are relative to `root`. */
  fragments?: FragmentsCheck;
  /** Source that calls `t()`, as globs relative to `root`. Tests and `i18n/` folders are skipped. */
  code?: readonly string[];
  /** Every key the server can send, imported from where it is declared. Preferred over a scan. */
  serverKeys?: readonly string[];
  /** Server source to scan for `messageKey: "…"` when there is no list to import. */
  serverCode?: readonly string[];
  /** String literals in `serverCode` starting with one of these are keys too: `["serverErrors."]`. */
  serverKeyPrefixes?: readonly string[];
  /** Placeholders the app fills before i18next sees the string, so they may use a reserved name. */
  brandVars?: Readonly<Record<string, string>>;
  /** The namespace a `t()` bound to nothing reads. Default `"translation"`. */
  defaultNamespace?: string;
}

export interface FragmentsCheck {
  dir: string;
  /**
   * Where the merged catalogs are written, for an app that commits them. `out/<locale>.json` must
   * then equal a fresh merge, so a hand edit or a fragment saved without re-merging fails. Leave it
   * out when the app merges at runtime.
   */
  out?: string;
  /** Refuse two fragments that share a top-level key: see `MergeOptions`. */
  ownTopLevel?: boolean;
}

export interface CheckI18nOptions {
  /** What `code`, `serverCode` and `fragments` are relative to. Default: the working directory. */
  root?: string;
  /**
   * Refuse a price typed into copy, for a product whose prices come from a formatter. Off by
   * default: most copy that matches is an example, not a price.
   */
  price?: RegExp;
}

export type I18nRule =
  | "load"
  | "fragments"
  | "parity"
  | "plural"
  | "placeholders"
  | "reserved"
  | "tags"
  | "price"
  | "missing-key"
  | "dynamic-key"
  | "trans-children"
  | "markup"
  | "server-key";

export interface I18nProblem {
  rule: I18nRule;
  /** A warning is shown and does not fail the gate. */
  level: "error" | "warning";
  bundle: string;
  locale?: string;
  key?: string;
  /** `file:line`, for a problem found in code. */
  at?: string;
  message: string;
}

export interface I18nReport {
  problems: I18nProblem[];
  /** Canonical keys no static reference, template prefix or key-path literal reaches. Advisory. */
  unused: { bundle: string; key: string }[];
}

const PLURAL = /_(zero|one|two|few|many|other)$/;

/** Options `t()` takes beside the values. `count` is both, so it is not here. */
const RESERVED = new Set(["lng", "lngs", "ns", "context", "defaultValue", "keyPrefix", "ordinal"]);

/** Every leaf by dotted key, and every path that names a node, walking the tree once. A key whose
 *  own name holds a dot (`message.created`) stays one leaf, which a split-and-descend lookup
 *  would lose. */
function flatten(tree: unknown): { leaves: Map<string, unknown>; nodes: Set<string> } {
  const leaves = new Map<string, unknown>();
  const nodes = new Set<string>();
  const walk = (node: unknown, prefix: string): void => {
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (value !== null && typeof value === "object") {
        nodes.add(path);
        walk(value, path);
      } else leaves.set(path, value);
    }
  };
  walk(tree, "");
  return { leaves, nodes };
}

type Flat = ReturnType<typeof flatten>;

/** `x.count_other` → `["x.count", "other"]`; anything else → null. */
function pluralSplit(key: string): [string, string] | null {
  const match = PLURAL.exec(key);
  return match === null ? null : [key.slice(0, match.index), match[1] ?? ""];
}

function categories(locale: string): Set<string> {
  return new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
}

/** A value's placeholders and positional tags, as one comparable string. `{{ name ,number }}` and
 *  `{{name, number}}` are the same to i18next, so they read the same here; a dropped format is not. */
function tokens(value: string, dropCount: boolean): string {
  const found = new Set<string>();
  for (const match of value.matchAll(/\{\{(-?)\s*([^{},]+?)\s*(?:,\s*([^{}]*?)\s*)?\}\}/g)) {
    const [, unescape = "", name = "", format] = match;
    if (dropCount && name === "count") continue;
    const spec = format === undefined ? "" : `, ${format.replace(/\s+/g, " ")}`;
    found.add(`{{${unescape}${name}${spec}}}`);
  }
  for (const match of value.matchAll(/<(\/?)(\d+)\s*(\/?)>/g)) {
    found.add(`<${match[1]}${match[2]}${match[3]}>`);
  }
  return [...found].sort().join(" ");
}

function placeholderNames(value: string): string[] {
  return [...value.matchAll(/\{\{-?\s*([^{},]+?)\s*(?:,[^{}]*)?\}\}/g)].map((m) => m[1] ?? "");
}

/** `<0>`…`</0>` must open in order — a tag's number is the count of tags opened before it — and
 *  close in reverse, once each: that is how `<Trans>` binds its components. Null when well-formed. */
function tagIssue(value: string): string | null {
  const stack: number[] = [];
  const opened = new Set<number>();
  for (const [, close, number, selfClose] of value.matchAll(/<(\/)?(\d+)\s*(\/)?>/g)) {
    const n = Number(number);
    if (close === undefined) {
      if (n !== opened.size) return `<${n}> is out of order`;
      opened.add(n);
      if (selfClose === undefined) stack.push(n);
    } else if (stack.pop() !== n) {
      return `</${n}> closes the wrong tag`;
    }
  }
  return stack.length > 0 ? `<${stack[stack.length - 1]}> is never closed` : null;
}

// ── Code ──────────────────────────────────────────────────────────────────────

/** Any call whose first argument is a string. The callee is then checked against the file's
 *  t-functions, so `console.log("a.b")` is not a key. */
const CALL = /\b([A-Za-z_$][\w$]*)\(\s*(["'`])((?:\\.|(?!\2).)*?)\2/g;
const I18N_KEY = /\bi18nKey\s*=\s*\{?\s*(["'`])((?:\\.|(?!\1).)*?)\1/g;
/** `labelKey: "nav.home"`: keys built in data and passed to `t()` as a variable, which a call scan
 *  cannot see. Counted only when the first segment is a real area, so `apiKey: "…"` is not one. */
const KEY_FIELD = /\b[a-zA-Z][a-zA-Z0-9]*[kK]ey\s*[:=]\s*\{?\s*(["'`])((?:\\.|(?!\1).)*?)\1/g;
const MESSAGE_KEY = /\bmessageKey\s*:\s*(["'`])((?:\\.|(?!\1).)*?)\1/g;
/** A dotted literal naming an area (`"graph.enrichments"`), or a template's static head before
 *  `.${`. Either may be a prefix later fed to `t(`${prefix}.title`)`, so the subtree it names is
 *  not reported unused. */
const KEY_PATH = /(["'`])([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+)+)\1/g;
const TEMPLATE_HEAD = /`([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)*)\.\$\{/g;
const TRANS_BLOCK = /<Trans\b[^>]*?(?:\/>|>([\s\S]*?)<\/Trans\s*>)/g;
/** Tags a reader would see as text if the string went through `t()`, which React escapes. */
const MARKUP = /<(?:code|strong|em|b|i|a|br)\b[^>]*>/;

const skipped = (file: string): boolean =>
  /(?:^|\/)__tests__\//.test(file) ||
  /\.(test|spec)\.[tj]sx?$/.test(file) ||
  /(?:^|\/)i18n\//.test(file);

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** Each identifier a file binds to `t`, and the namespaces behind it:
 *  `const { t: tc } = useTranslation("requests")` → `tc` → `requests`. */
function bindings(source: string, defaultNs: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const pattern =
    /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*useTranslation\(\s*(?:(["'`])([^"'`]*)\2)?\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const names = match[1] ?? "";
    const alias = /(?:^|,)\s*t\s*:\s*([A-Za-z_$][\w$]*)/.exec(names)?.[1];
    const name = alias ?? (/(?:^|,)\s*t\s*(?:,|$)/.test(names) ? "t" : undefined);
    if (name === undefined) continue;
    const set = found.get(name) ?? new Set<string>();
    set.add(match[3] || defaultNs);
    found.set(name, set);
  }
  return found;
}

/** Blank `{…}` expressions and `{/* comments *\/}` in one innermost pass, keeping newlines, so a
 *  `components={[<code />]}` does not read as the `<Trans>` closing itself.
 *  ponytail: one pass. Iterating to a fixed point lets a function body swallow whole `<Trans>`
 *  blocks once its inner braces are gone; an expression with nested braces stays unblanked. */
function blankExpressions(source: string): string {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}|\{[^{}]*\}/g, (m) => m.replace(/[^\n]/g, " "));
}

interface Reference {
  key: string;
  namespaces: string[];
  at: string;
  hasDefault: boolean;
  /** Reached through `t()`, which returns a string, so its copy may not carry markup. */
  viaT: boolean;
}

interface Prefix {
  namespaces: string[];
  /** The static text before `${`. */
  head: string;
  /** Whether `${` sits mid-segment (`read_${x}`) rather than after a dot. */
  partial: boolean;
  at: string;
}

interface Scan {
  references: Reference[];
  prefixes: Map<string, Prefix>;
  keyPaths: Set<string>;
  /** The static end of a template with no static start: `.loadProblem` in `\`\${ns}.loadProblem\``. */
  tails: Set<string>;
  transChildren: string[];
}

interface Areas {
  defaultNs: string;
  namespaces: Set<string>;
  /** Top-level area → the namespaces declaring it. */
  owners: Map<string, string[]>;
}

function record(
  raw: string,
  namespaces: string[],
  file: string,
  source: string,
  index: number,
  areas: Areas,
  scan: Scan,
  viaT: boolean,
): void {
  let key = raw;
  let candidates = namespaces;
  const colon = raw.indexOf(":");
  if (colon > 0 && areas.namespaces.has(raw.slice(0, colon))) {
    candidates = [raw.slice(0, colon)];
    key = raw.slice(colon + 1);
  }
  const at = `${file}:${lineAt(source, index)}`;
  const dollar = key.indexOf("${");
  if (dollar === -1) {
    // A `defaultValue` beside the call still renders something, so a miss there is a warning.
    const hasDefault = /defaultValue/.test(source.slice(index, index + 200));
    scan.references.push({ key, namespaces: candidates, at, hasDefault, viaT });
    return;
  }
  const head = key.slice(0, dollar);
  const tail = /\}(\.[\w.]+)$/.exec(key)?.[1];
  if (head === "" && tail !== undefined) scan.tails.add(tail);
  const partial = !head.endsWith(".");
  const id = `${candidates.join("|")}:${head}`;
  if (!scan.prefixes.has(id))
    scan.prefixes.set(id, {
      namespaces: candidates,
      head: partial ? head : head.slice(0, -1),
      partial,
      at,
    });
}

function scanCode(source: string, file: string, areas: Areas, scan: Scan): void {
  const bound = bindings(source, areas.defaultNs);
  for (const match of source.matchAll(CALL)) {
    const callee = match[1] ?? "";
    const namespaces = bound.get(callee) ?? (callee === "t" ? new Set([areas.defaultNs]) : null);
    if (namespaces === null) continue;
    record(match[3] ?? "", [...namespaces], file, source, match.index, areas, scan, true);
  }
  for (const match of source.matchAll(I18N_KEY)) {
    record(match[2] ?? "", [areas.defaultNs], file, source, match.index, areas, scan, false);
  }
  for (const match of source.matchAll(KEY_FIELD)) {
    const raw = match[2] ?? "";
    const owners = areas.owners.get(raw.split(/[.$]/, 1)[0] ?? "");
    if (owners !== undefined) record(raw, owners, file, source, match.index, areas, scan, false);
  }
  for (const pattern of [KEY_PATH, TEMPLATE_HEAD]) {
    for (const match of source.matchAll(pattern)) {
      const path = match[pattern === KEY_PATH ? 2 : 1] ?? "";
      if (areas.owners.has(path.split(".", 1)[0] ?? "")) scan.keyPaths.add(path);
    }
  }
  const blanked = blankExpressions(source);
  for (const match of blanked.matchAll(TRANS_BLOCK)) {
    if ((match[1] ?? "").trim() !== "")
      scan.transChildren.push(`${file}:${lineAt(source, match.index)}`);
  }
}

function scanServer(
  source: string,
  file: string,
  prefixes: readonly string[],
  areas: Areas,
  scan: Scan,
): void {
  for (const match of source.matchAll(MESSAGE_KEY)) {
    const raw = match[2] ?? "";
    // Only keys into an area the client catalog has: a server may name keys of its own catalog too.
    if (!areas.owners.has(raw.split(/[.$]/, 1)[0] ?? "")) continue;
    record(raw, [areas.defaultNs], file, source, match.index, areas, scan, false);
  }
  for (const prefix of prefixes) {
    for (const match of source.matchAll(/(["'`])([A-Za-z0-9_.]+)\1/g)) {
      const raw = match[2] ?? "";
      if (raw.startsWith(prefix) && raw.length > prefix.length)
        record(raw, [areas.defaultNs], file, source, match.index, areas, scan, false);
    }
  }
}

async function files(root: string, patterns: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const pattern of patterns) {
    for await (const file of glob(pattern, { cwd: root })) {
      if (!skipped(file)) found.add(file);
    }
  }
  return [...found].sort();
}

// ── Fragments ─────────────────────────────────────────────────────────────────

export interface MergeOptions {
  /**
   * Refuse two fragments that share a top-level key. Set it when the app merges fragments at
   * runtime with a spread — `{ ...auth.en, ...nav.en }` — where the second `nav` replaces the
   * first instead of joining it, and the keys of one fragment vanish with no error anywhere.
   */
  ownTopLevel?: boolean;
}

export interface MergedFragments {
  /** The text each `<locale>.json` must hold: keys sorted, two-space indent, a final newline. */
  files: Map<string, string>;
  /** A fragment that does not parse, or two that disagree. When not empty, nothing may be written. */
  errors: string[];
}

type Tree = { [key: string]: unknown };

const isTree = (value: unknown): value is Tree =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function mergeInto(
  target: Tree,
  source: Tree,
  path: string,
  origin: string,
  errors: string[],
): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (isTree(value)) {
      if (existing !== undefined && !isTree(existing)) {
        errors.push(`${origin}: ${path}${key} is a string elsewhere and an object here`);
        continue;
      }
      const child: Tree = isTree(existing) ? existing : {};
      target[key] = child;
      mergeInto(child, value, `${path}${key}.`, origin, errors);
    } else if (typeof value !== "string") {
      errors.push(`${origin}: ${path}${key} must be a string or an object`);
    } else if (existing !== undefined && existing !== value) {
      errors.push(`${origin}: ${path}${key} is defined twice with different values`);
    } else {
      target[key] = value;
    }
  }
}

function sortTree(tree: Tree): Tree {
  return Object.fromEntries(
    Object.keys(tree)
      .sort()
      .map((key) => {
        const value = tree[key];
        return [key, isTree(value) ? sortTree(value) : value];
      }),
  );
}

/**
 * Fold `dir/*.json` — one file per area, every language side by side, `{ "en": {…}, "pt-BR": {…} }`
 * — into one catalog per language. Fragments exist so that people and agents building screens in
 * parallel do not all edit the same three files. Deterministic: files in name order, keys sorted,
 * so two runs write the same bytes and a derived catalog can be compared with a fresh merge.
 */
export async function mergeFragments(
  dir: string,
  locales: readonly string[],
  options: MergeOptions = {},
): Promise<MergedFragments> {
  const trees = new Map(locales.map((locale): [string, Tree] => [locale, {}]));
  const errors: string[] = [];
  const owners = new Map<string, string>();
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  for (const name of names) {
    let fragment: unknown;
    try {
      fragment = JSON.parse(await readFile(join(dir, name), "utf8"));
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!isTree(fragment)) {
      errors.push(`${name}: expected an object keyed by language`);
      continue;
    }
    for (const language of Object.keys(fragment)) {
      if (!trees.has(language)) errors.push(`${name}: "${language}" is not one of the languages`);
    }
    if (options.ownTopLevel === true) {
      const tops = new Set(
        Object.values(fragment).flatMap((tree) => (isTree(tree) ? Object.keys(tree) : [])),
      );
      for (const top of tops) {
        const owner = owners.get(top);
        if (owner === undefined) owners.set(top, name);
        else
          errors.push(
            `${name}: "${top}" is already a key of ${owner}, and a spread keeps only one of them`,
          );
      }
    }
    for (const [locale, target] of trees) {
      const tree = fragment[locale];
      if (tree === undefined) continue;
      if (!isTree(tree)) errors.push(`${name}: "${locale}" must be an object`);
      else mergeInto(target, tree, "", `${name} [${locale}]`, errors);
    }
  }
  const files = new Map(
    [...trees].map(([locale, tree]): [string, string] => [
      locale,
      `${JSON.stringify(sortTree(tree), null, 2)}\n`,
    ]),
  );
  return { files, errors };
}

/** Merge `dir` and write `out/<locale>.json`. Writes nothing when a fragment is broken, so a
 *  catalog is never missing the half that failed to parse. Returns the errors. */
export async function writeFragments(
  dir: string,
  out: string,
  locales: readonly string[],
  options: MergeOptions = {},
): Promise<string[]> {
  const { files, errors } = await mergeFragments(dir, locales, options);
  if (errors.length > 0) return errors;
  await mkdir(out, { recursive: true });
  for (const [locale, text] of files) await writeFile(join(out, `${locale}.json`), text);
  return [];
}

// ── The check ─────────────────────────────────────────────────────────────────

async function checkBundle(
  bundle: I18nBundle,
  options: CheckI18nOptions,
  report: I18nReport,
): Promise<void> {
  const root = options.root ?? process.cwd();
  const defaultNs = bundle.defaultNamespace ?? "translation";
  const problem = (p: Omit<I18nProblem, "bundle" | "level"> & { level?: "warning" }): void => {
    report.problems.push({ bundle: bundle.name, level: "error", ...p });
  };

  if (!bundle.locales.includes(bundle.canonical)) {
    problem({
      rule: "load",
      message: `the canonical language ${bundle.canonical} is not in the list`,
    });
    return;
  }

  const fragments = bundle.fragments;
  if (fragments !== undefined) {
    const merged = await mergeFragments(resolve(root, fragments.dir), bundle.locales, {
      ownTopLevel: fragments.ownTopLevel,
    }).catch((error: unknown) => ({
      files: new Map<string, string>(),
      errors: [`${fragments.dir}: ${error instanceof Error ? error.message : String(error)}`],
    }));
    for (const error of merged.errors) problem({ rule: "fragments", message: error });
    const out = fragments.out;
    // An app that merges at runtime commits no catalog, so there is nothing to compare.
    if (out !== undefined)
      for (const [locale, text] of merged.files) {
        const file = join(out, `${locale}.json`);
        const onDisk = await readFile(resolve(root, file), "utf8").catch(() => null);
        if (onDisk !== text)
          problem({
            rule: "fragments",
            locale,
            message: `${file} ${onDisk === null ? "is missing" : "differs from its fragments"}; merge them again`,
          });
      }
  }

  const loaded = new Map<string, Catalogs>();
  for (const locale of bundle.locales) {
    try {
      loaded.set(locale, await bundle.load(locale));
    } catch (error) {
      problem({
        rule: "load",
        locale,
        message: `could not load: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  // Every rule below compares languages, and a language that did not load reads as one with no keys.
  if (loaded.size < bundle.locales.length) return;

  const namespaces = new Set([...loaded.values()].flatMap((catalogs) => Object.keys(catalogs)));
  const flat = new Map<string, Map<string, Flat>>();
  for (const ns of namespaces) {
    flat.set(
      ns,
      new Map(bundle.locales.map((locale) => [locale, flatten(loaded.get(locale)?.[ns])])),
    );
  }
  const canonicalOf = (ns: string): Flat =>
    flat.get(ns)?.get(bundle.canonical) ?? { leaves: new Map(), nodes: new Set() };

  const brand = new Set(Object.keys(bundle.brandVars ?? {}));
  const canonicalForms = categories(bundle.canonical);
  // A `g` or `y` pattern keeps `lastIndex` between calls, so every other value would pass.
  const price =
    options.price && new RegExp(options.price.source, options.price.flags.replace(/[gy]/g, ""));
  for (const ns of [...namespaces].sort()) {
    const byLocale = flat.get(ns) ?? new Map<string, Flat>();
    const label = (key: string): string => (ns === defaultNs ? key : `${ns}:${key}`);

    // A key is a plural form only when its set has `_other`, which i18next always needs. That keeps
    // `step_two` a key of its own instead of the `two` form of `step`.
    const pluralBases = new Set<string>();
    for (const { leaves } of byLocale.values()) {
      for (const key of leaves.keys())
        if (key.endsWith("_other")) pluralBases.add(key.slice(0, -6));
    }
    const baseOf = (key: string): string => {
      const split = pluralSplit(key);
      return split !== null && pluralBases.has(split[0]) ? split[0] : key;
    };

    // Parity by base: each language carries the forms its own rules select, so English has no
    // `_many` to be missing.
    const keysOf = new Map(
      [...byLocale].map(([locale, { leaves }]) => [
        locale,
        new Set([...leaves.keys()].map(baseOf)),
      ]),
    );
    const union = new Set([...keysOf.values()].flatMap((keys) => [...keys]));
    for (const locale of bundle.locales) {
      const keys = keysOf.get(locale) ?? new Set<string>();
      for (const key of [...union].sort()) {
        if (!keys.has(key))
          problem({ rule: "parity", locale, key: label(key), message: "missing" });
      }
      for (const [key, value] of byLocale.get(locale)?.leaves ?? []) {
        if (typeof value !== "string")
          problem({ rule: "parity", locale, key: label(key), message: "is not a string" });
        else if (value.trim() === "")
          problem({ rule: "parity", locale, key: label(key), message: "is empty" });
      }
    }

    for (const locale of bundle.locales) {
      const { leaves } = byLocale.get(locale) ?? { leaves: new Map<string, unknown>() };
      const needed = categories(locale);
      const has = keysOf.get(locale) ?? new Set<string>();
      for (const base of [...pluralBases].sort()) {
        if (!has.has(base)) continue;
        for (const form of needed) {
          if (!leaves.has(`${base}_${form}`))
            problem({
              rule: "plural",
              locale,
              key: label(`${base}_${form}`),
              message: `missing: ${locale} uses the ${form} form, and without it the reader gets another language`,
            });
        }
        for (const key of leaves.keys()) {
          const split = pluralSplit(key);
          // `_zero` is i18next's own form for a count of 0, in every language.
          if (split === null || split[0] !== base || needed.has(split[1]) || split[1] === "zero")
            continue;
          problem({
            rule: "plural",
            level: "warning",
            locale,
            key: label(key),
            message: `${locale} never uses the ${split[1]} form, so nobody reads this`,
          });
        }
      }
    }

    const canonical = canonicalOf(ns).leaves;
    for (const locale of bundle.locales) {
      for (const [key, value] of byLocale.get(locale)?.leaves ?? []) {
        if (typeof value !== "string") continue;
        const split = pluralSplit(key);
        const plural = split !== null && pluralBases.has(split[0]) ? split : null;

        for (const name of placeholderNames(value)) {
          if (RESERVED.has(name) && !brand.has(name))
            problem({
              rule: "reserved",
              locale,
              key: label(key),
              message: `{{${name}}} is an option t() reads, not a value it fills`,
            });
        }
        const tagProblem = /<\/?\d/.test(value) ? tagIssue(value) : null;
        if (tagProblem !== null)
          problem({ rule: "tags", locale, key: label(key), message: tagProblem });
        if (price?.test(value))
          problem({
            rule: "price",
            locale,
            key: label(key),
            message: `a price is typed into the copy: ${value.slice(0, 60)}`,
          });

        if (locale === bundle.canonical) continue;
        // A form the canonical language never selects (`_many` in English) answers to its `_other`,
        // even when the canonical catalog carries a dead copy of it.
        const sameForm =
          plural === null || plural[1] === "zero" || canonicalForms.has(plural[1])
            ? canonical.get(key)
            : undefined;
        const source =
          sameForm ?? (plural === null ? undefined : canonical.get(`${plural[0]}_other`));
        if (typeof source !== "string") continue;
        // "One mailbox" and "{{count}} caixa" are both right for a single thing.
        const dropCount = plural?.[1] === "one" || plural?.[1] === "zero";
        const want = tokens(source, dropCount);
        const got = tokens(value, dropCount);
        if (want !== got)
          problem({
            rule: "placeholders",
            locale,
            key: label(key),
            message: `has [${got}] where ${bundle.canonical} has [${want}]`,
          });
      }
    }
  }

  const needsScan =
    (bundle.code?.length ?? 0) > 0 ||
    (bundle.serverCode?.length ?? 0) > 0 ||
    (bundle.serverKeys?.length ?? 0) > 0;
  if (!needsScan) return;

  const owners = new Map<string, string[]>();
  for (const ns of namespaces) {
    const catalog = loaded.get(bundle.canonical)?.[ns] ?? {};
    for (const area of Object.keys(catalog)) owners.set(area, [...(owners.get(area) ?? []), ns]);
  }
  const areas: Areas = { defaultNs, namespaces, owners };
  const scan: Scan = {
    references: [],
    prefixes: new Map(),
    keyPaths: new Set(),
    tails: new Set(),
    transChildren: [],
  };
  for (const file of await files(root, bundle.code ?? [])) {
    scanCode(await readFile(resolve(root, file), "utf8"), file, areas, scan);
  }
  const codeReferences = scan.references.length;
  for (const file of await files(root, bundle.serverCode ?? [])) {
    scanServer(
      await readFile(resolve(root, file), "utf8"),
      file,
      bundle.serverKeyPrefixes ?? [],
      areas,
      scan,
    );
  }

  const present = (f: Flat, key: string): boolean =>
    f.leaves.has(key) ||
    f.nodes.has(key) ||
    ["zero", "one", "two", "few", "many", "other"].some((form) => f.leaves.has(`${key}_${form}`));
  const label = (namespaces: string[], key: string): string =>
    namespaces.length === 1 && namespaces[0] === defaultNs ? key : `${namespaces.join("|")}:${key}`;

  const seen = new Set<string>();
  for (const [index, reference] of scan.references.entries()) {
    const id = `${reference.at}:${reference.namespaces.join("|")}:${reference.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const fromServer = index >= codeReferences;
    if (!reference.namespaces.some((ns) => present(canonicalOf(ns), reference.key))) {
      problem({
        rule: fromServer ? "server-key" : "missing-key",
        ...(reference.hasDefault ? { level: "warning" as const } : {}),
        key: label(reference.namespaces, reference.key),
        at: reference.at,
        message: `is not in ${bundle.canonical}${reference.hasDefault ? " (a defaultValue covers it)" : ""}`,
      });
      continue;
    }
    if (reference.viaT) {
      const value = reference.namespaces
        .map((ns) => canonicalOf(ns).leaves.get(reference.key))
        .find((v) => v !== undefined);
      // t() returns a string and React escapes it, so the reader sees the angle brackets — in
      // every language at once, since translations copy the tag. Five shipped before one was seen.
      if (typeof value === "string" && MARKUP.test(value))
        problem({
          rule: "markup",
          key: label(reference.namespaces, reference.key),
          at: reference.at,
          message: `carries markup, which t() prints as text; render it with <Trans i18nKey="${reference.key}" components={…} />`,
        });
    }
  }

  // A key the server sends is shown in whatever language the reader has, and fallback would hide
  // a hole in any one of them.
  for (const key of bundle.serverKeys ?? []) {
    for (const locale of bundle.locales) {
      const f = flat.get(defaultNs)?.get(locale);
      if (f === undefined || !present(f, key))
        problem({
          rule: "server-key",
          locale,
          key,
          message: `the server can send it, and ${locale} does not have it`,
        });
    }
  }

  for (const at of scan.transChildren)
    problem({
      rule: "trans-children",
      at,
      message:
        "<Trans> has children; they are indexed too and shift every <n>. Pass components={…} and self-close it",
    });

  const leavesOf = (ns: string): string[] => [...canonicalOf(ns).leaves.keys()];
  const prefixFound = (prefix: Prefix): boolean =>
    prefix.head === "" ||
    prefix.namespaces.some((ns) =>
      prefix.partial
        ? leavesOf(ns).some((key) => key.startsWith(prefix.head))
        : present(canonicalOf(ns), prefix.head),
    );
  for (const prefix of scan.prefixes.values()) {
    if (!prefixFound(prefix))
      problem({
        rule: "dynamic-key",
        key: label(prefix.namespaces, `${prefix.head}${prefix.partial ? "" : "."}*`),
        at: prefix.at,
        message: `no key in ${bundle.canonical} starts this way`,
      });
  }

  if ((bundle.code?.length ?? 0) === 0) return;
  for (const ns of [...namespaces].sort()) {
    const used = new Set(
      scan.references.filter((r) => r.namespaces.includes(ns)).map((r) => r.key),
    );
    const heads = [...scan.prefixes.values()].filter(
      (p) => p.namespaces.includes(ns) && p.head !== "",
    );
    const paths = [...scan.keyPaths].filter((path) => present(canonicalOf(ns), path));
    const reached = (key: string): boolean =>
      used.has(key) ||
      heads.some((p) =>
        p.partial ? key.startsWith(p.head) : key === p.head || key.startsWith(`${p.head}.`),
      ) ||
      paths.some((path) => key === path || key.startsWith(`${path}.`)) ||
      [...scan.tails].some((tail) => key.endsWith(tail));
    for (const key of leavesOf(ns).sort()) {
      // `t("x", { count })` reaches `x_one` and `x_other` through `x`.
      const split = pluralSplit(key);
      if (reached(key) || (split !== null && reached(split[0]))) continue;
      report.unused.push({ bundle: bundle.name, key: ns === defaultNs ? key : `${ns}:${key}` });
    }
  }
}

/**
 * Run every rule over every bundle. Returns what it found rather than printing or exiting, so a repo
 * can add checks of its own to the same report and decide how CI fails:
 *
 * ```ts
 * const report = await checkI18n([web, site]);
 * console.log(formatI18nReport(report));
 * process.exit(report.problems.some((p) => p.level === "error") ? 1 : 0);
 * ```
 */
export async function checkI18n(
  bundles: readonly I18nBundle[],
  options: CheckI18nOptions = {},
): Promise<I18nReport> {
  const report: I18nReport = { problems: [], unused: [] };
  for (const bundle of bundles) await checkBundle(bundle, options, report);
  return report;
}

/** The report as lines for a terminal: one per problem, grouped by bundle, and a last line that
 *  says whether the gate passed. Pass `showUnused` to list the advisory keys, not just count them. */
export function formatI18nReport(
  report: I18nReport,
  options: { showUnused?: boolean } = {},
): string {
  const lines: string[] = [];
  const bundles = [
    ...new Set([...report.problems.map((p) => p.bundle), ...report.unused.map((u) => u.bundle)]),
  ];
  for (const bundle of bundles) {
    lines.push(bundle);
    for (const p of report.problems.filter((q) => q.bundle === bundle)) {
      const where = [p.locale, p.key].filter((part) => part !== undefined).join(" ");
      const at = p.at === undefined ? "" : `  (${p.at})`;
      lines.push(
        `  ${p.level === "error" ? "✖" : "⚠"} ${p.rule}: ${where}${where === "" ? "" : " "}${p.message}${at}`,
      );
    }
    const unused = report.unused.filter((u) => u.bundle === bundle);
    if (unused.length > 0) {
      lines.push(`  · ${unused.length} key(s) no code reaches, as far as a scan can tell`);
      if (options.showUnused === true) for (const u of unused) lines.push(`      ${u.key}`);
    }
  }
  const errors = report.problems.filter((p) => p.level === "error").length;
  const warnings = report.problems.length - errors;
  lines.push(
    errors === 0
      ? `✔ i18n: no errors${warnings > 0 ? `, ${warnings} warning(s)` : ""}`
      : `✖ i18n: ${errors} error(s)${warnings > 0 ? `, ${warnings} warning(s)` : ""}`,
  );
  return lines.join("\n");
}
