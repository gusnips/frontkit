import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkContrast, formatContrastReport, type ContrastReport } from "./contrast.ts";

/**
 * These run the real Tailwind CLI over a committed fixture theme, the way an adopter's CI
 * would — a unit test with a mocked compiler would prove the assertions and nothing about the
 * compile they read. Two fixtures: one that keeps the whole contract, one that breaks every
 * rule once. Each rule below is watched firing, and the clean fixture is the positive control
 * that the gate can pass.
 */
const here = dirname(fileURLToPath(import.meta.url));
const ok = join(here, "fixtures/contrast/ok");
const bad = join(here, "fixtures/contrast/bad");

afterEach(async () => {
  // The compile workdir is removed on success and kept on failure for reading; in a test run
  // the assertion IS the reading, so both fixtures clean up after themselves.
  await rm(join(ok, ".contrast-check"), { recursive: true, force: true });
  await rm(join(bad, ".contrast-check"), { recursive: true, force: true });
});

function rules(report: ContrastReport): string[] {
  return report.problems.map((p) => `${p.level[0]}:${p.rule}`).sort();
}

describe("checkContrast", () => {
  it("passes a theme and classes that keep the contract", async () => {
    const report = await checkContrast([{ name: "ok", entry: "theme.css", sources: ["*.html"] }], {
      root: ok,
    });
    expect(report.problems).toEqual([]);
    expect(formatContrastReport(report)).toBe("✔ contrast: no errors");
  }, 120_000);

  it("fails every rule once on the bad fixture, and points at the source", async () => {
    const report = await checkContrast([{ name: "bad", entry: "theme.css", sources: ["*.html"] }], {
      root: bad,
    });
    expect(rules(report)).toEqual([
      "e:floor",
      "e:floor",
      "e:rebind",
      "e:retune",
      "e:untokened",
      "e:untokened",
      "e:untokened",
      "w:dead",
      "w:hover",
    ]);
    const untokened = report.problems.filter((p) => p.rule === "untokened");
    expect(untokened.map((p) => p.class).sort()).toEqual([
      "bg-black/40",
      "border-gray-300",
      "text-white",
    ]);
    for (const p of untokened) expect(p.at).toMatch(/^page\.html:\d+$/);
    expect(report.problems.find((p) => p.rule === "hover")?.class).toBe("hover:bg-primary");
    expect(report.problems.find((p) => p.rule === "dead")?.class).toBe("not-a-token-xyz");
    expect(report.problems.find((p) => p.rule === "retune")?.message).toContain("#7c3aed");
    expect(formatContrastReport(report)).toContain("✖ contrast: 7 error(s), 2 warning(s)");
  }, 120_000);

  it("an allow list silences the classes a repo means, and nothing else", async () => {
    const report = await checkContrast(
      [
        {
          name: "bad",
          entry: "theme.css",
          sources: ["*.html"],
          allow: [/^text-white$/, /^bg-black/],
        },
      ],
      { root: bad },
    );
    expect(report.problems.filter((p) => p.rule === "untokened").map((p) => p.class)).toEqual([
      "border-gray-300",
    ]);
    // The floors do not take an allow list: a measured ratio is not a judgement call.
    expect(report.problems.filter((p) => p.rule === "floor")).toHaveLength(2);
  }, 120_000);

  it("a theme that does not load fails the gate instead of passing it", async () => {
    const report = await checkContrast(
      [{ name: "missing", entry: "no-such-file.css", sources: ["*.html"] }],
      { root: ok },
    );
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]?.rule).toBe("load");
    expect(report.problems[0]?.level).toBe("error");
  });
});
