import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { webManifest, writeIconSet } from "./icons.ts";

/**
 * The callbacks are the product's (resvg, sharp, an ICO packer), so the tests stub them with
 * deterministic bytes and assert the driving: each size rendered once, files named and placed,
 * the ICO packed from the right renders in order.
 */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>`;
const render = (svg: string, size: number): Uint8Array =>
  new TextEncoder().encode(`${svg.length}:${size}`);
const packIco = (pngs: readonly Uint8Array[]): Uint8Array =>
  new TextEncoder().encode(`ico[${pngs.map((png) => new TextDecoder().decode(png)).join(",")}]`);

async function dir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "frontkit-icons-"));
}

describe("writeIconSet", () => {
  it("writes one PNG per size, the touch icon, and a packed favicon.ico", async () => {
    const outDir = await dir();
    const files = await writeIconSet({
      outDir,
      svg: SVG,
      pngSizes: [192, 512],
      icoSizes: [16, 32],
      render,
      packIco,
    });
    expect(files).toEqual(["icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon.ico"]);
    expect(await readdir(outDir)).toEqual([...files].sort());
    expect(await readFile(join(outDir, "icon-192.png"), "utf8")).toBe(`${SVG.length}:192`);
    expect(await readFile(join(outDir, "apple-touch-icon.png"), "utf8")).toBe(`${SVG.length}:180`);
    expect(await readFile(join(outDir, "favicon.ico"), "utf8")).toBe(
      `ico[${SVG.length}:16,${SVG.length}:32]`,
    );
  });

  // The touch icon at a size the set already renders costs no extra raster: same bytes, one
  // render. A renderer that bills per call makes the difference visible.
  it("renders each size once even when the touch icon shares it", async () => {
    const seen: number[] = [];
    await writeIconSet({
      outDir: await dir(),
      svg: SVG,
      pngSizes: [180, 512],
      icoSizes: [180],
      render: (svg, size) => {
        seen.push(size);
        return render(svg, size);
      },
      packIco,
    });
    expect(seen).toEqual([180, 512]);
  });

  // A renderer that throws leaves no half-written set behind: every size renders first.
  it("writes nothing when a render fails, and reports without writing on check", async () => {
    const failing = async (_svg: string, size: number): Promise<Uint8Array> => {
      if (size === 512) throw new Error("rasterizer down");
      return render(_svg, size);
    };
    const outDir = await dir();
    await expect(
      writeIconSet({
        outDir,
        svg: SVG,
        pngSizes: [192, 512],
        icoSizes: [16],
        render: failing,
        packIco,
      }),
    ).rejects.toThrow("rasterizer down");
    expect(await readdir(outDir)).toEqual([]);

    const checkDir = await dir();
    const files = await writeIconSet({
      outDir: checkDir,
      svg: SVG,
      pngSizes: [192],
      icoSizes: [16],
      check: true,
      render,
      packIco,
    });
    expect(files).toEqual(["icon-192.png", "apple-touch-icon.png", "favicon.ico"]);
    expect(await readdir(checkDir)).toEqual([]);
  });
});

describe("webManifest", () => {
  it("writes keys in install order with the travelled defaults", () => {
    expect(
      webManifest({
        name: "Acme",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      }),
    ).toBe(
      `{\n  "name": "Acme",\n  "start_url": ".",\n  "display": "standalone",\n` +
        `  "icons": [\n    {\n      "src": "/icon-192.png",\n      "sizes": "192x192",\n` +
        `      "type": "image/png"\n    }\n  ]\n}\n`,
    );
  });

  it("keeps the optional fields and a maskable purpose", () => {
    const txt = webManifest({
      name: "Acme",
      shortName: "Acme",
      description: "Do things.",
      scope: "/app/",
      backgroundColor: "#ffffff",
      themeColor: "#7c3aed",
      icons: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
    });
    const parsed = JSON.parse(txt) as Record<string, unknown>;
    expect(parsed["short_name"]).toBe("Acme");
    expect(parsed["scope"]).toBe("/app/");
    expect(parsed["background_color"]).toBe("#ffffff");
    expect(parsed["theme_color"]).toBe("#7c3aed");
    expect(parsed["icons"]).toEqual([
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  // A manifest with no name installs as nothing, and one with no icons fails installability
  // with no error anywhere. Both fail here instead.
  it("refuses an empty name and an empty icon list", () => {
    const icon = { src: "/icon-192.png", sizes: "192x192", type: "image/png" };
    expect(() => webManifest({ name: "  ", icons: [icon] })).toThrow(/name/);
    expect(() => webManifest({ name: "Acme", icons: [] })).toThrow(/icons/);
  });
});
