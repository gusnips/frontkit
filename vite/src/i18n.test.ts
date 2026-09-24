import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Catalogs,
  checkI18n,
  formatI18nReport,
  type I18nBundle,
  type I18nProblem,
  mergeFragments,
  writeFragments,
} from "./i18n.ts";

const dirs: string[] = [];

async function tempRoot(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "frontkit-i18n-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, "utf8");
  }
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs.length = 0;
});

/** A bundle over in-memory catalogs, English canonical. */
function bundle(catalogs: Record<string, object>, extra: Partial<I18nBundle> = {}): I18nBundle {
  return {
    name: "web",
    locales: Object.keys(catalogs),
    canonical: "en",
    load: (locale): Catalogs => ({ translation: catalogs[locale] ?? {} }),
    ...extra,
  };
}

async function problems(
  b: I18nBundle,
  options: Parameters<typeof checkI18n>[1] = {},
): Promise<I18nProblem[]> {
  return (await checkI18n([b], options)).problems;
}

const errors = (list: I18nProblem[]): string[] =>
  list
    .filter((p) => p.level === "error")
    .map((p) => `${p.rule} ${p.locale ?? "-"} ${p.key ?? "-"}`);

describe("loading", () => {
  /**
   * Six of the nine gates this replaces printed "skipped" and returned zero when a catalog failed
   * to load, so a broken JSON file turned the gate green — the one moment it had something to say.
   */
  it("fails when a language does not load, and runs no rule that would read it as empty", async () => {
    const found = await problems({
      name: "web",
      locales: ["en", "pt-BR"],
      canonical: "en",
      load: (locale) => {
        if (locale === "pt-BR") throw new Error("Unexpected token } in JSON at position 812");
        return { translation: { a: "A" } };
      },
    });
    expect(errors(found)).toEqual(["load pt-BR -"]);
    expect(found[0]?.message).toContain("position 812");
  });

  it("refuses a canonical language that is not in the list", async () => {
    const found = await problems(bundle({ "pt-BR": { a: "A" } }));
    expect(errors(found)).toEqual(["load - -"]);
  });
});

describe("parity", () => {
  it("names a key one language lacks, and a blank or non-string value", async () => {
    const found = await problems(
      bundle({
        en: { nav: { home: "Home", about: "About" }, n: 3 },
        "pt-BR": { nav: { home: "Início", about: "  " }, n: "3" },
      }),
    );
    expect(errors(found).sort()).toEqual(["parity en n", "parity pt-BR nav.about"]);
  });

  it("reads a missing key in the canonical language too", async () => {
    const found = await problems(bundle({ en: {}, "pt-BR": { extra: "Extra" } }));
    expect(errors(found)).toEqual(["parity en extra"]);
  });

  it("keeps a key whose own name holds a dot as one key", async () => {
    const found = await problems(
      bundle({ en: { "message.created": "Created" }, "pt-BR": { "message.created": "Criado" } }),
    );
    expect(found).toEqual([]);
  });
});

describe("plural", () => {
  /**
   * Portuguese and Spanish have a `many` form for exact millions that English does not. Without
   * it i18next falls back to the English catalog, so a Portuguese page read "104 mi followers"
   * for exactly 104,000,000 while 15.1M on the same screen read correctly.
   */
  it("requires every form the language selects, and not one more", async () => {
    const found = await problems(
      bundle({
        en: { items_one: "{{count}} item", items_other: "{{count}} items" },
        "pt-BR": { items_one: "{{count}} item", items_other: "{{count}} itens" },
      }),
    );
    expect(errors(found)).toEqual(["plural pt-BR items_many"]);
  });

  it("does not ask English for a form it never uses, and warns when it has one", async () => {
    const found = await problems(
      bundle({
        en: { items_one: "{{count}} item", items_other: "{{count}} items", items_many: "lots" },
        "pt-BR": {
          items_one: "{{count}} item",
          items_many: "{{count}} de itens",
          items_other: "{{count}} itens",
        },
      }),
    );
    expect(errors(found)).toEqual([]);
    expect(found.map((p) => `${p.level} ${p.locale} ${p.key}`)).toEqual(["warning en items_many"]);
  });

  it("accepts _zero in any language, because i18next reads it for a count of 0 in all of them", async () => {
    const found = await problems(
      bundle({
        en: { items_zero: "No items", items_one: "One item", items_other: "{{count}} items" },
        es: {
          items_zero: "Nada",
          items_one: "Un elemento",
          items_many: "{{count}} de elementos",
          items_other: "{{count}} elementos",
        },
      }),
    );
    expect(found).toEqual([]);
  });

  it("reads step_two as a key of its own when nothing named step_other exists", async () => {
    const found = await problems(
      bundle({
        en: { step_one: "First", step_two: "Second" },
        "pt-BR": { step_one: "Primeiro", step_two: "Segundo" },
      }),
    );
    expect(found).toEqual([]);
  });
});

describe("placeholders", () => {
  it("catches a renamed placeholder, a dropped format and a lost tag", async () => {
    const found = await problems(
      bundle({
        en: { hi: "Hi {{name}}", total: "{{amount, number}} left", link: "Read <0>the terms</0>" },
        "pt-BR": { hi: "Oi {{nome}}", total: "{{amount}} restantes", link: "Leia os termos" },
      }),
    );
    expect(errors(found).sort()).toEqual([
      "placeholders pt-BR hi",
      "placeholders pt-BR link",
      "placeholders pt-BR total",
    ]);
  });

  it("reads spacing inside a placeholder the way i18next does", async () => {
    const found = await problems(
      bundle({
        en: { total: "{{amount, number}} left" },
        "pt-BR": { total: "{{ amount ,number }} restantes" },
      }),
    );
    expect(found).toEqual([]);
  });

  it("compares a form the canonical language lacks against its _other", async () => {
    const found = await problems(
      bundle({
        en: { n_one: "{{count}} follower", n_other: "{{count}} followers" },
        "pt-BR": {
          n_one: "{{count}} seguidor",
          n_many: "de seguidores",
          n_other: "{{count}} seguidores",
        },
      }),
    );
    expect(errors(found)).toEqual(["placeholders pt-BR n_many"]);
  });

  it("lets _one drop {{count}} where it names the single thing", async () => {
    const found = await problems(
      bundle({
        en: { mail_one: "One mailbox", mail_other: "{{count}} mailboxes" },
        es: {
          mail_one: "{{count}} buzón",
          mail_many: "{{count}} de buzones",
          mail_other: "{{count}} buzones",
        },
      }),
    );
    expect(found).toEqual([]);
  });
});

describe("reserved and tags", () => {
  it("refuses a placeholder t() reads as an option, unless the app fills it first", async () => {
    const catalogs = {
      en: { a: "Pick {{lng}}", b: "{{ns}} ok" },
      "pt-BR": { a: "Escolha {{lng}}", b: "{{ns}} ok" },
    };
    expect(errors(await problems(bundle(catalogs))).sort()).toEqual([
      "reserved en a",
      "reserved en b",
      "reserved pt-BR a",
      "reserved pt-BR b",
    ]);
    const filled = await problems(bundle(catalogs, { brandVars: { ns: "Acme" } }));
    expect(errors(filled).sort()).toEqual(["reserved en a", "reserved pt-BR a"]);
  });

  it("requires <n> tags in order and closed once, self-closing included", async () => {
    const found = await problems(
      bundle({
        en: {
          ok: "<0>a</0> <1/> <2>b</2>",
          skip: "<1>a</1>",
          open: "<0>a",
          cross: "<0><1>a</0></1>",
        },
      }),
    );
    expect(errors(found).sort()).toEqual(["tags en cross", "tags en open", "tags en skip"]);
  });

  it("refuses a typed price only when asked", async () => {
    const catalogs = { en: { plan: "Pro is $29 a month" } };
    expect(await problems(bundle(catalogs))).toEqual([]);
    const found = await problems(bundle(catalogs), { price: /\$\s?\d/ });
    expect(errors(found)).toEqual(["price en plan"]);
    const twice = { en: { a: "$29", b: "$49" } };
    expect(errors(await problems(bundle(twice), { price: /\$\s?\d/g }))).toEqual([
      "price en a",
      "price en b",
    ]);
  });
});

describe("code", () => {
  const catalogs = {
    en: {
      nav: { home: "Home", terms: "Read <strong>the terms</strong>" },
      plan: { free: { title: "Free" }, pro: { title: "Pro" } },
      items_one: "{{count}} item",
      items_other: "{{count}} items",
      stale: "Nobody reads this",
      field: { email: "Email" },
    },
  };
  const requests = { en: { title: "Requests" } };
  const withCode = (code: Record<string, string>, extra: Partial<I18nBundle> = {}) =>
    tempRoot(code).then((root): [I18nBundle, string] => [
      {
        name: "web",
        locales: ["en"],
        canonical: "en",
        load: () => ({ translation: catalogs.en, requests: requests.en }),
        code: ["src/**/*.{ts,tsx}"],
        ...extra,
      },
      root,
    ]);

  it("finds a static key the canonical language does not have, through any binding of t", async () => {
    const [b, root] = await withCode({
      "src/App.tsx": [
        "const { t } = useTranslation();",
        't("nav.home"); t("nav.gone");',
        'const { t: tr } = useTranslation("requests");',
        'tr("title"); tr("missing");',
        't("requests:title");',
        'console.log("nav.nope");',
      ].join("\n"),
    });
    const found = await problems(b, { root });
    expect(errors(found).sort()).toEqual([
      "missing-key - nav.gone",
      "missing-key - requests:missing",
    ]);
    expect(found.find((p) => p.key === "nav.gone")?.at).toBe("src/App.tsx:2");
  });

  it("downgrades a miss to a warning when a defaultValue covers it", async () => {
    const [b, root] = await withCode({
      "src/a.tsx": 't("nav.soon", { defaultValue: "Soon" });',
    });
    const found = await problems(b, { root });
    expect(found.map((p) => `${p.level} ${p.rule} ${p.key}`)).toContain(
      "warning missing-key nav.soon",
    );
    expect(errors(found)).toEqual([]);
  });

  it("reads a plural base as present, and a template key by its prefix", async () => {
    const [b, root] = await withCode({
      "src/a.tsx": [
        't("items", { count });',
        "t(`plan.${id}.title`);",
        "t(`plans.${id}.title`);",
        "t(`field.${name}`);",
      ].join("\n"),
    });
    expect(errors(await problems(b, { root }))).toEqual(["dynamic-key - plans.*"]);
  });

  it("refuses <Trans> children and markup reached through t()", async () => {
    const [b, root] = await withCode({
      "src/a.tsx": [
        '<Trans i18nKey="nav.terms" values={{ n: a > b ? 1 : 2 }} components={[<strong key="s" />]} />',
        '<Trans i18nKey="nav.terms" components={[<strong key="s" />]} />',
        '<Trans i18nKey="nav.terms">Read <strong>the terms</strong></Trans>',
        't("nav.terms");',
      ].join("\n"),
    });
    const found = await problems(b, { root });
    expect(errors(found).sort()).toEqual(["markup - nav.terms", "trans-children - -"]);
    expect(found.find((p) => p.rule === "trans-children")?.at).toBe("src/a.tsx:3");
  });

  it("skips tests and i18n folders, and counts a key built in data as a reference", async () => {
    const [b, root] = await withCode({
      "src/a.test.tsx": 't("nav.fromTest");',
      "src/i18n/setup.ts": 't("nav.fromSetup");',
      "src/menu.ts":
        'const items = [{ labelKey: "nav.home" }, { apiKey: "sk_live" }, { labelKey: "nav.away" }];',
    });
    expect(errors(await problems(b, { root }))).toEqual(["missing-key - nav.away"]);
  });

  it("lists canonical keys nothing reaches, and keeps what a key-path literal or a template tail names", async () => {
    const [b, root] = await withCode({
      "src/a.tsx": [
        't("nav.home"); t("nav.terms"); t("items", { count });',
        'const section = "plan.free";',
        "t(`field.${name}`);",
        "t(`${area}.pro.title`);",
      ].join("\n"),
    });
    const report = await checkI18n([b], { root });
    expect(report.unused.map((u) => u.key)).toEqual(["requests:title", "stale"]);
  });
});

describe("server keys", () => {
  it("requires every key the server can send, in every language", async () => {
    const found = await problems(
      bundle(
        {
          en: { errors: { QUOTA: "Out of quota", GONE: "Gone" } },
          "pt-BR": { errors: { QUOTA: "Sem cota", GONE: "" } },
        },
        { serverKeys: ["errors.QUOTA", "errors.GONE", "errors.NEW"] },
      ),
    );
    expect(errors(found).sort()).toEqual([
      "parity pt-BR errors.GONE",
      "server-key en errors.NEW",
      "server-key pt-BR errors.NEW",
    ]);
  });

  it("scans server source for messageKey and prefixed literals when there is no list", async () => {
    const root = await tempRoot({
      "api/routes.ts": [
        'throw new ApiError({ code: "Q", messageKey: "errors.QUOTA" });',
        'throw new ApiError({ code: "N", messageKey: "errors.NOPE" });',
        'throw new ApiError({ messageKey: "emails.subject" });',
        'const key = "serverErrors.late";',
      ].join("\n"),
    });
    const found = await problems(
      bundle(
        { en: { errors: { QUOTA: "Out of quota" }, serverErrors: { early: "Early" } } },
        { serverCode: ["api/**/*.ts"], serverKeyPrefixes: ["serverErrors."] },
      ),
      { root },
    );
    expect(errors(found).sort()).toEqual([
      "server-key - errors.NOPE",
      "server-key - serverErrors.late",
    ]);
  });
});

describe("fragments", () => {
  const fragments = {
    "i18n/fragments/a-nav.json": JSON.stringify({
      en: { nav: { home: "Home" } },
      "pt-BR": { nav: { home: "Início" } },
    }),
    "i18n/fragments/b-auth.json": JSON.stringify({
      en: { auth: { in: "Sign in" } },
      "pt-BR": { auth: { in: "Entrar" } },
    }),
  };

  it("merges area files into one sorted catalog per language, the same bytes every run", async () => {
    const root = await tempRoot(fragments);
    const merged = await mergeFragments(join(root, "i18n/fragments"), ["en", "pt-BR"]);
    expect(merged.errors).toEqual([]);
    expect(merged.files.get("en")).toBe(
      `${JSON.stringify({ auth: { in: "Sign in" }, nav: { home: "Home" } }, null, 2)}\n`,
    );
  });

  it("refuses two fragments that disagree, and writes nothing", async () => {
    const root = await tempRoot({
      ...fragments,
      "i18n/fragments/c.json": JSON.stringify({ en: { nav: { home: "Start" } }, fr: {} }),
      "i18n/fragments/d.json": "{ broken",
    });
    const written = await writeFragments(join(root, "i18n/fragments"), join(root, "out"), [
      "en",
      "pt-BR",
    ]);
    expect(written.join("\n")).toMatch(/nav\.home is defined twice/);
    expect(written.join("\n")).toMatch(/"fr" is not one of the languages/);
    expect(written.join("\n")).toMatch(/^d\.json:/m);
    await expect(readFile(join(root, "out/en.json"), "utf8")).rejects.toThrow();
  });

  it("fails the check when a derived catalog was edited by hand or never re-merged", async () => {
    const root = await tempRoot(fragments);
    await writeFragments(join(root, "i18n/fragments"), join(root, "i18n/locales"), ["en", "pt-BR"]);
    const b: I18nBundle = {
      name: "web",
      locales: ["en", "pt-BR"],
      canonical: "en",
      fragments: { dir: "i18n/fragments", out: "i18n/locales" },
      load: async (locale) => ({
        translation: JSON.parse(
          await readFile(join(root, `i18n/locales/${locale}.json`), "utf8"),
        ) as object,
      }),
    };
    expect(await problems(b, { root })).toEqual([]);
    await writeFile(join(root, "i18n/locales/pt-BR.json"), '{ "nav": { "home": "Casa" } }\n');
    const found = await problems(b, { root });
    expect(errors(found)).toContain("fragments pt-BR -");
  });
  /**
   * An app that merges at runtime with a spread — `{ ...a.en, ...b.en }` — keeps only the second
   * of two fragments that share a top-level key. A deep merge would hide that from the gate.
   */
  it("refuses a shared top-level key when the app spreads its fragments", async () => {
    const root = await tempRoot({
      "f/a.json": JSON.stringify({ en: { nav: { home: "Home" } } }),
      "f/b.json": JSON.stringify({ en: { nav: { about: "About" } } }),
    });
    expect((await mergeFragments(join(root, "f"), ["en"])).errors).toEqual([]);
    const spread = await mergeFragments(join(root, "f"), ["en"], { ownTopLevel: true });
    expect(spread.errors).toEqual([
      'b.json: "nav" is already a key of a.json, and a spread keeps only one of them',
    ]);
    const found = await problems(
      bundle({ en: { nav: { about: "About" } } }, { fragments: { dir: "f", ownTopLevel: true } }),
      { root },
    );
    expect(errors(found)).toEqual(["fragments - -"]);
  });
});

describe("formatI18nReport", () => {
  it("prints each problem and a last line that says whether the gate passed", async () => {
    const report = await checkI18n([bundle({ en: { a: "A", b: "B" }, "pt-BR": { a: "A" } })]);
    const text = formatI18nReport(report);
    expect(text).toContain("✖ parity: pt-BR b missing");
    expect(text.split("\n").at(-1)).toBe("✖ i18n: 1 error(s)");
    expect(formatI18nReport({ problems: [], unused: [] })).toBe("✔ i18n: no errors");
  });
});
