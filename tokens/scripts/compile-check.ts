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
 * It also pins the three things that rot silently: a colour added to `@theme` and forgotten
 * in `.dark`, the `dark:` variant itself, and the two contrast floors — a placeholder that
 * drifts under them looks completely fine on screen and is unusable for somebody.
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

/**
 * The two contrast floors, measured on the hex values that actually compile out.
 *
 * Deliberately two pairs and not a contrast suite: these are the ones a placeholder can
 * get wrong while looking completely fine. `input` is the sharp one — it is a control
 * boundary, so WCAG 1.4.11 asks 3:1, and one donor points it at the same rung it uses for
 * a passive divider: 1.6:1 in light, 2.2:1 in dark, every field border in two of its apps.
 * Nothing about that looks broken on screen, which is why it needs a build failure and not
 * a comment.
 */
const CONTRAST_FLOORS: Array<[token: string, against: string, floor: number]> = [
  ["--color-input", "--color-background", 3],
  ["--color-foreground", "--color-background", 4.5],
];

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/** What a token resolves to inside one region of the output. Six-digit hex only, on purpose. */
function hexValue(region: string, token: string): string | null {
  return new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(region)?.[1] ?? null;
}

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
    // The compile takes well under a second. The CLI has hung once with no output, and with no
    // deadline that held `bun run check` open for five minutes instead of failing it.
    timeout: 60_000,
  });
  if (run.error) throw new Error(`tailwindcss did not finish: ${run.error.message}`);
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

  //    The focus ring must reach text fields. A donor strips it from every input, textarea,
  //    select and combobox because its own fields draw their own; in a package that inverts
  //    into removing a focus indicator from an adopter who never asked us to touch it. A
  //    component with its own treatment opts out on itself instead.
  expect(
    !css.includes('[role="combobox"]'),
    "the text-field outline suppression is back — it takes the keyboard focus ring off " +
      "every adopter's plain <input> (WCAG 2.4.7). Opt out per component with " +
      "`focus-visible:outline-hidden`, which beats the base rule on layer order.",
  );

  // 7. The contrast floors, in both modes, on the values that actually shipped. The light
  //    region is everything before the `.dark` block, which is where @theme lands.
  const darkStart = css.indexOf("\n.dark {");
  const regions: Array<[mode: string, region: string]> = [
    ["light", darkStart === -1 ? css : css.slice(0, darkStart)],
    ["dark", dark ?? ""],
  ];
  for (const [mode, region] of regions) {
    for (const [token, against, floor] of CONTRAST_FLOORS) {
      const fg = hexValue(region, token);
      const bg = hexValue(region, against);
      if (fg === null || bg === null) {
        failures.push(
          `${mode}: cannot measure ${token} on ${against} — one of them is no longer a ` +
            "6-digit hex. Keep the placeholders hex, or teach this check the new notation; " +
            "do not let the floor go unmeasured.",
        );
        continue;
      }
      const ratio = contrast(fg, bg);
      expect(
        ratio >= floor,
        `${mode}: ${token} (${fg}) on ${against} (${bg}) is ${ratio.toFixed(2)}:1, ` +
          `under the ${floor}:1 floor`,
      );
    }
  }

  // 8. The base rules. Each is here because a product shipped without it.
  const baseRules: Array<[label: string, needle: string]> = [
    // Two needles rather than the whole selector: how Tailwind joins a multi-line selector
    // is its business, and a check that breaks on whitespace is a check people learn to skip.
    ["the button cursor", "cursor: pointer"],
    ["the aria-disabled guard on it", '[role="button"]:not([aria-disabled="true"])'],
    ["light color-scheme", "color-scheme: light"],
    ["dark color-scheme", "color-scheme: dark"],
    ["the focus ring", "outline: 2px solid var(--color-ring)"],
    // Forced colors draw no box-shadow, so without this a ring beside an `outline-none` leaves
    // a Windows High Contrast reader with no focus indicator anywhere.
    ["the forced-colors focus outline", "outline: 2px solid CanvasText !important"],
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
      `${UTILITIES.length} utilities compile, ${CONTRAST_FLOORS.length * 2} contrast floors ` +
      `clear, ${baseRules.length} base rules present.`,
  );
}

main();
