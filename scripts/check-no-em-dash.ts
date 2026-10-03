#!/usr/bin/env bun
/**
 * No em dash in the text a consumer reads. ESLint covers every string in the library source
 * (eslint.config.js, NO_EM_DASH); this covers what ESLint cannot parse: each README and each
 * package.json (npm shows both). An em dash gives away AI-written text.
 *
 * Run: bun run scripts/check-no-em-dash.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";

const EM_DASH = /—|\\u2014|\\u\{2014\}|&mdash;|&#(?:0*8212|x0*2014);/i;
const packages = readdirSync(".", { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules",
  )
  .map((entry) => entry.name);
const files = [
  "README.md",
  "package.json",
  ...packages.flatMap((dir) => [`${dir}/README.md`, `${dir}/package.json`]),
].filter((file) => existsSync(file));

const problems = files.flatMap((file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, i) => (EM_DASH.test(line) ? [`${file}:${String(i + 1)}: ${line.trim()}`] : [])),
);

if (problems.length > 0) {
  console.error(
    `Em dash found in ${String(problems.length)} user-facing line(s). Use a period, comma, colon or parentheses:\n` +
      problems.join("\n"),
  );
  process.exit(1);
}
console.log(`no em dash in ${String(files.length)} user-facing files`);
