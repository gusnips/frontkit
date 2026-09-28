/**
 * PWA icons and the manifest that names them, driven the way `writeOgCards` is.
 *
 * The artwork is the product's — one SVG master — and so are the two operations this package
 * cannot do without dragging image tooling into every adopter: rasterizing (resvg, sharp,
 * satori, …) and ICO packing. Both arrive as callbacks, so this file stays dependency-free and
 * a repo that only wants a sitemap installs neither. What ships is the part every copy got
 * subtly wrong: which sizes exist, what they are named, and the manifest agreeing with the
 * files on disk.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** One SVG master at one pixel size. The renderer is the caller's; this only drives it. */
export type RenderIcon = (svg: string, size: number) => Uint8Array | Promise<Uint8Array>;

/** Several same-size PNGs into one multi-image `favicon.ico`. */
export type PackIco = (pngs: readonly Uint8Array[]) => Uint8Array | Promise<Uint8Array>;

export interface WriteIconSetOptions {
  /** Where the files land — `public/` in every donor, so they are served as static files. */
  outDir: string;
  /** The one master artwork. A single path with no variants is what keeps every size in step. */
  svg: string;
  /** PNG sizes to write, e.g. `[180, 192, 512]`. Each is rendered once even when named twice. */
  pngSizes: readonly number[];
  /** The file name for one PNG size. Default `` `icon-${size}.png` ``. */
  file?: (size: number) => string;
  /**
   * The size written as `apple-touch-icon.png`. Default 180 — what the reader's home screen
   * asks for. Reuses the PNG render when it is already in `pngSizes`, so the common case costs
   * no extra raster.
   */
  appleTouchSize?: number;
  /** Sizes re-rendered and packed into `favicon.ico`, e.g. `[16, 32, 48]`. */
  icoSizes: readonly number[];
  /** Lay every icon out and report, without writing anything. */
  check?: boolean;
  render: RenderIcon;
  packIco: PackIco;
}

/**
 * Render one icon set and write it, plus the multi-size `favicon.ico`.
 *
 * Every size is rendered BEFORE anything is written, so a renderer that throws leaves no
 * half-written set behind — the same order `writeOgCards` keeps for the same reason.
 */
export async function writeIconSet({
  outDir,
  svg,
  pngSizes,
  file = (size) => `icon-${size}.png`,
  appleTouchSize = 180,
  icoSizes,
  check = false,
  render,
  packIco,
}: WriteIconSetOptions): Promise<string[]> {
  const sizes = [...new Set([...pngSizes, appleTouchSize, ...icoSizes])].sort((a, b) => a - b);
  const rendered = new Map<number, Uint8Array>();
  for (const size of sizes) rendered.set(size, await render(svg, size));

  const written: Array<{ file: string; png: Uint8Array }> = [];
  for (const size of pngSizes)
    written.push({ file: file(size), png: rendered.get(size) ?? new Uint8Array() });
  written.push({
    file: "apple-touch-icon.png",
    png: rendered.get(appleTouchSize) ?? new Uint8Array(),
  });
  written.push({
    file: "favicon.ico",
    png: await packIco(icoSizes.map((size) => rendered.get(size) ?? new Uint8Array())),
  });

  if (check) return written.map((entry) => entry.file);

  await mkdir(outDir, { recursive: true });
  for (const entry of written) await writeFile(join(outDir, entry.file), entry.png);
  return written.map((entry) => entry.file);
}

/** One icon as the manifest names it. `src` is the path `writeIconSet` wrote, from the root. */
export interface ManifestIcon {
  src: string;
  /** `"192x192"`, `"48x48"`, or several space-separated when one file serves several. */
  sizes: string;
  type: string;
  purpose?: string;
}

export interface WebManifestOptions {
  name: string;
  shortName?: string;
  description?: string;
  /** Default `"."`: the manifest travels with the app, so a relative start stays correct. */
  startUrl?: string;
  scope?: string;
  /** Default `"standalone"`: a PWA that opens in a tab is a bookmark, not an app. */
  display?: string;
  backgroundColor?: string;
  themeColor?: string;
  /** At least one — a manifest with no icons fails installability with no error anywhere. */
  icons: readonly ManifestIcon[];
}

/**
 * `site.webmanifest`, as text with a trailing newline. Keys in install order, so two runs over
 * the same options write the same bytes.
 */
export function webManifest({
  name,
  shortName,
  description,
  startUrl = ".",
  scope,
  display = "standalone",
  backgroundColor,
  themeColor,
  icons,
}: WebManifestOptions): string {
  if (name.trim() === "") throw new Error("manifest: `name` is empty");
  if (icons.length === 0)
    throw new Error("manifest: `icons` is empty — name what writeIconSet wrote");
  const manifest: Record<string, unknown> = { name };
  if (shortName !== undefined) manifest["short_name"] = shortName;
  if (description !== undefined) manifest["description"] = description;
  manifest["start_url"] = startUrl;
  if (scope !== undefined) manifest["scope"] = scope;
  manifest["display"] = display;
  if (backgroundColor !== undefined) manifest["background_color"] = backgroundColor;
  if (themeColor !== undefined) manifest["theme_color"] = themeColor;
  manifest["icons"] = icons.map((icon) => ({
    src: icon.src,
    sizes: icon.sizes,
    type: icon.type,
    ...(icon.purpose !== undefined && { purpose: icon.purpose }),
  }));
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
