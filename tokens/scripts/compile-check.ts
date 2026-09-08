#!/usr/bin/env bun
/**
 * Does every name this package ships actually resolve?
 *
 * Tailwind 4 answers a missing token by emitting nothing. `bg-card` with no `--color-card`
 * is not an error and not a warning — it is an absent rule and an unstyled div, found by a
 * human three screens later. So the only check worth running is a real compile: write a
 * fixture that uses every name, run the Tailwind CLI over it, and read the CSS that comes
 * back. The exit code proves nothing; the assertions below are the test.
 *
 * It also pins the two things that rot silently: a colour added to `@theme` and forgotten
 * in `.dark`, and the `dark:` variant itself.
 *
 * Run: bun run scripts/compile-check.ts
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The contract. Every one of these must resolve in light mode AND be rebound in `.dark`. */
const COLORS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "scrim",
];

/** Utility → the token its declaration must point at. */
const UTILITIES: Array<[utility: string, token: string]> = [
  ...COLORS.map((c): [string, string] => [`bg-${c}`, `--color-${c}`]),
  ...COLORS.map((c): [string, string] => [`text-${c}`, `--color-${c}`]),
  ["border-border", "--color-border"],
  ["ring-ring", "--color-ring"],
  ["outline-ring", "--color-ring"],
];

/** A name we deliberately do NOT ship, so the fixture proves the check can fail. */
const ABSENT = "bg-not-a-token";

/**
 * `--duration-*` is not a Tailwind namespace, so `duration-standard` compiles to nothing
 * at all — no rule, no warning, and the transition quietly runs at the default 150ms. One
 * donor theme defines the three names and 61 class usages across its app read them; every
 * one is dead. Asserting the absence is how that stays found: if a future Tailwind adds
 * the namespace, this fails and we can ship the names for real.
 */
const NOT_A_NAMESPACE = "duration-standard";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workDir = join(pkgRoot, ".compile-check");

const failures: string[] = [];
function expect(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/**
 * The body of the first rule whose selector uses `cls` as a whole class name.
 *
 * `exact` demands the class be the entire selector — needed for `.dark`, which also occurs
 * inside every `dark:` variant's `:where(.dark, .dark *)` and would otherwise match there.
 */
function ruleBody(css: string, cls: string, exact = false): string | null {
  const selector = `.${cls.replace(/:/g, "\\:")}`;
  let from = 0;
  for (;;) {
    const at = css.indexOf(selector, from);
    if (at === -1) return null;
    from = at + selector.length;
    const rest = css.slice(from);
    // `.text-card` must not match `.text-card-foreground`, nor `.dark` match `.dark\:bg-card`.
    if (/^[-\w\\]/.test(rest)) continue;
    if (exact && !/^\s*\{/.test(rest)) continue;
    const open = css.indexOf("{", at);
    if (open === -1) return null;
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
    }
    return null;
  }
}

function compile(): string {
  // `@tailwindcss/cli` exports only its package.json, so resolve that and walk to the bin
  // the same way the shell would. Never `import.meta.dir` — it is bun-only.
  const cliPkg = fileURLToPath(import.meta.resolve("@tailwindcss/cli/package.json"));
  const cli = join(dirname(cliPkg), "dist", "index.mjs");

  // The entry must live inside the package: Tailwind resolves `@import "tailwindcss"` and
  // `@source` relative to the file it is reading, not to the cwd.
  mkdirSync(workDir, { recursive: true });
  const classes = [
    ...UTILITIES.map(([u]) => u),
    "dark:bg-card",
    ABSENT,
    NOT_A_NAMESPACE,
    "rounded-full",
  ].join(" ");
  writeFileSync(join(workDir, "fixture.html"), `<div class="${classes}"></div>\n`);
  writeFileSync(
    join(workDir, "entry.css"),
    ['@import "tailwindcss";', '@import "../src/index.css";', '@source "./fixture.html";', ""].join(
      "\n",
    ),
  );

  const out = join(workDir, "out.css");
  const run = spawnSync(process.execPath, [cli, "-i", join(workDir, "entry.css"), "-o", out], {
    cwd: workDir,
    encoding: "utf-8",
  });
  if (run.status !== 0) {
    console.error(run.stderr || run.stdout);
    throw new Error("tailwindcss failed to compile the fixture");
  }
  return readFileSync(out, "utf-8");
}

function main(): void {
  const css = compile();

  // 1. Every utility exists and points at its token. A missing token means no rule at all.
  for (const [utility, token] of UTILITIES) {
    const body = ruleBody(css, utility);
    if (body === null) {
      failures.push(`\`${utility}\` produced no rule — \`${token}\` is missing from @theme`);
      continue;
    }
    expect(body.includes(`var(${token})`), `\`${utility}\` does not read \`var(${token})\``);
  }

  // 2. The control: an unknown name must produce nothing, or assertion 1 passes by accident.
  expect(
    ruleBody(css, ABSENT) === null,
    `\`${ABSENT}\` resolved to something — this check cannot detect a missing token`,
  );

  // 3. Every colour is rebound in `.dark`. This is the one that rots: a name lands in
  //    @theme, the dark block is not touched, and one colour stays light on one screen.
  const dark = ruleBody(css, "dark", true);
  if (dark === null) failures.push("no `.dark` block in the output");
  else {
    for (const c of COLORS) {
      expect(dark.includes(`--color-${c}:`), `\`--color-${c}\` is missing from the .dark block`);
    }
  }

  // 4. The variant itself: `dark:bg-card` must compile through `@custom-variant`, so an app
  //    never has to declare it. Zero specificity (`:where`) is the point — see theme.css.
  const variant = ruleBody(css, "dark:bg-card");
  expect(variant !== null, "`dark:bg-card` produced no rule — @custom-variant did not ship");
  expect(
    css.includes(":where(.dark, .dark *)"),
    "the dark variant is not zero-specificity `:where(.dark, .dark *)`",
  );

  // 5. Radii stay Tailwind's. `rounded-sm/md/lg/xl` are already stock names and
  //    `rounded-full` is a built-in static utility, so we ship no `--radius-*` at all.
  //    This fails the day someone adds `--radius-full` or `--radius-pill` back.
  const full = ruleBody(css, "rounded-full");
  expect(full !== null, "`rounded-full` produced no rule");
  expect(
    full !== null && !full.includes("var(--radius-full)"),
    "`rounded-full` now reads `--radius-full`; the built-in `calc(infinity * 1px)` was better",
  );
  expect(!css.includes("--radius-pill"), "`--radius-pill` is back; `rounded-full` already exists");

  // 6. The dead-name pin. See NOT_A_NAMESPACE.
  expect(
    ruleBody(css, NOT_A_NAMESPACE) === null,
    `\`${NOT_A_NAMESPACE}\` now compiles — Tailwind grew a --duration-* namespace, so the ` +
      "named duration scale can ship after all",
  );

  // 7. The base rules. Each is here because a product shipped without it.
  const baseRules: Array<[label: string, needle: string]> = [
    // Two needles rather than the whole selector: how Tailwind joins a multi-line selector
    // is its business, and a check that breaks on whitespace is a check people learn to skip.
    ["the button cursor", "cursor: pointer"],
    ["the aria-disabled guard on it", '[role="button"]:not([aria-disabled="true"])'],
    ["light color-scheme", "color-scheme: light"],
    ["dark color-scheme", "color-scheme: dark"],
    ["the focus ring", "outline: 2px solid var(--color-ring)"],
    ["the text-field outline suppression", '[role="combobox"]:focus-visible'],
    ["the scrollbar thumb", "background: var(--color-input)"],
    ["`.scrollbar-none`", "scrollbar-width: none"],
    ["the reduced-motion clamp", "@media (prefers-reduced-motion: reduce)"],
    ["the animation-delay clamp", "animation-delay: 0.01ms"],
    ["the transition-delay clamp", "transition-delay: 0.01ms"],
  ];
  for (const [label, needle] of baseRules) {
    expect(css.includes(needle), `${label} is missing from the compiled output`);
  }

  if (failures.length > 0) {
    console.error("✗ tokens: the compiled CSS does not match the contract.\n");
    for (const f of failures) console.error(`    ${f}`);
    // Left on disk on purpose: the compiled CSS is the first thing you want to read.
    console.error(`\n  Compiled output kept at ${workDir}/out.css`);
    process.exit(1);
  }

  rmSync(workDir, { recursive: true, force: true });
  console.log(
    `✓ tokens: ${COLORS.length} colours resolve in both modes, ` +
      `${UTILITIES.length} utilities compile, ${baseRules.length} base rules present.`,
  );
}

main();
