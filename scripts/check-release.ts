#!/usr/bin/env bun
/**
 * What the registry will actually receive — checked against the tarball, not the source.
 *
 * `@gusnips/vite` depends on `@gusnips/react` at `workspace:*`, which is not a range npm can
 * resolve. Something has to rewrite it to a real version at pack time, and BOTH ways of getting
 * that wrong have already shipped:
 *
 * - **`npm publish` does not rewrite it at all.** npm does not implement bun's workspace
 *   protocol, so the literal string `workspace:*` went onto the registry. Every install of that
 *   version fails to resolve.
 * - **`bun publish` rewrites it from the LOCKFILE, not from the sibling's package.json.** Bump a
 *   version and publish without re-running `bun install`, and the tarball pins whatever the lock
 *   still remembers. `@gusnips/vite@0.3.0` pins `@gusnips/react@0.2.0` for exactly this reason —
 *   an adopter on the current react gets a second, older copy of it nested under vite, holding a
 *   second `PRERENDERED_ROUTE_ATTR`.
 *
 * Neither is visible without unpacking a tarball, and neither breaks anything in this repo,
 * where the workspace link makes every version correct. So this packs each package the way a
 * release does and reads the manifest that comes out.
 *
 * Run: bun run release:check   (and `bun run release`, which runs it first)
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const PACKAGES = ["tokens", "http", "react", "vite"];

interface Manifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

async function manifestOf(dir: string): Promise<Manifest> {
  return JSON.parse(await readFile(join(ROOT, dir, "package.json"), "utf8")) as Manifest;
}

/** Pack the package and hand back both the manifest the registry sees and the tarball itself. */
async function packedManifest(
  dir: string,
  into: string,
): Promise<{ manifest: Manifest; tarball: string }> {
  const pack = Bun.spawn(["bun", "pm", "pack", "--destination", into], {
    cwd: join(ROOT, dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await pack.exited) !== 0)
    throw new Error(`pack failed for ${dir}: ${await new Response(pack.stderr).text()}`);

  const { name, version } = await manifestOf(dir);
  const tarball = join(into, `${name.replace("@", "").replace("/", "-")}-${version}.tgz`);
  // `tar -xzO` to stdout: no second temp directory, and nothing left behind to clean up.
  const read = Bun.spawn(["tar", "-xzOf", tarball, "package/package.json"], { stdout: "pipe" });
  return { manifest: JSON.parse(await new Response(read.stdout).text()) as Manifest, tarball };
}

/**
 * Files in the tarball's `dist/` with no source file behind them any more.
 *
 * `tsc` never removes output it did not just write, so renaming a source file leaves its old
 * compiled twin sitting in `dist/` — and `files: ["dist"]` ships it. That is how
 * `@gusnips/react@0.5.0` reached the registry carrying both `deploy-recovery.js` and the
 * `chunk-reload.js` it replaced, the dead one still declaring the sessionStorage key that same
 * release had just renamed. The exports map made it unreachable so nothing broke, and that is
 * the trap: a published artifact that quietly contradicts itself is one somebody greps a year
 * from now and believes.
 *
 * The build scripts clean `dist/` now. This checks the TARBALL rather than the script, because
 * a stale build directory is exactly what a clean script cannot prove it prevented — and
 * `release:check` is the only thing here that ever looks inside what the registry receives.
 */
async function staleDistFiles(dir: string, tarball: string): Promise<string[]> {
  const list = Bun.spawn(["tar", "-tzf", tarball], { stdout: "pipe" });
  const entries = (await new Response(list.stdout).text()).split("\n");
  const emitted = entries
    .filter((entry) => /^package\/dist\/.+\.(js|d\.ts)(\.map)?$/.test(entry))
    .map((entry) => entry.slice("package/dist/".length).replace(/\.(js|d\.ts)(\.map)?$/, ""));
  return [...new Set(emitted)].filter(
    (base) => !["ts", "tsx"].some((ext) => existsSync(join(ROOT, dir, "src", `${base}.${ext}`))),
  );
}

const current = new Map<string, string>();
for (const dir of PACKAGES) {
  const { name, version } = await manifestOf(dir);
  current.set(name, version);
}

const problems: string[] = [];
const workdir = await mkdtemp(join(tmpdir(), "frontkit-release-"));

try {
  for (const dir of PACKAGES) {
    const { manifest: packed, tarball } = await packedManifest(dir, workdir);
    const ranges = { ...packed.dependencies, ...packed.peerDependencies };

    for (const stale of await staleDistFiles(dir, tarball))
      problems.push(
        `${packed.name} would publish dist/${stale}.* with no src/${stale}.ts behind it — ` +
          `stale output from a rename. Run \`bun run build\` (it cleans dist/ now) and pack again.`,
      );

    for (const [dep, range] of Object.entries(ranges)) {
      if (range.startsWith("workspace:"))
        problems.push(
          `${packed.name} would publish "${dep}": "${range}" — npm cannot resolve that. ` +
            `Release with \`bun publish\`, never \`npm publish\`.`,
        );

      const sibling = current.get(dep);
      if (sibling !== undefined && !range.startsWith("workspace:") && range !== sibling)
        problems.push(
          `${packed.name} would pin "${dep}": "${range}", but ${dep} is at ${sibling}. ` +
            `The lockfile is stale — run \`bun install\` and pack again.`,
        );
    }

    const pins = Object.entries(ranges)
      .filter(([dep]) => current.has(dep))
      .map(([dep, range]) => `${dep}@${range}`);
    console.log(`  ${packed.name}@${packed.version}${pins.length ? ` → ${pins.join(", ")}` : ""}`);
  }
} finally {
  await rm(workdir, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`\n✗ release: ${String(problems.length)} problem(s) in what would be published\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`\n✓ release: ${String(PACKAGES.length)} tarballs pin their siblings correctly.`);
