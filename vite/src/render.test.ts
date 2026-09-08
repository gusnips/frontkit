import { createElement, lazy, Suspense, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderTree } from "./render.ts";

/** A route that arrives one tick late, like every `lazy()` route in a real app. */
const Late = lazy(() =>
  Promise.resolve({ default: () => createElement("main", null, "the real page") }),
);

const behindSuspense = (): ReactNode =>
  createElement(
    Suspense,
    { fallback: createElement("div", { role: "status" }, "Loading…") },
    createElement(Late),
  );

describe("renderTree", () => {
  /**
   * Invariant 1, and the reason this helper exists at all. `renderToString` renders the
   * FALLBACK here — it would write a loading screen into every file and pass every gate that
   * only asks whether the root has children.
   */
  it("waits for a lazy route instead of rendering the fallback", async () => {
    const html = await renderTree(behindSuspense());
    expect(html).toContain("the real page");
    expect(html).not.toContain('role="status"');
  });

  /**
   * React 19 hoists in-tree `<title>`/`<meta>`/`<link>` to the FRONT of the server stream, for
   * a caller assembling a whole document. We are filling one `<div>`, so they would land inside
   * the body — invalid there, and a duplicate of the head the prerender bakes.
   */
  it("drops the head tags React hoists to the front of the stream", async () => {
    const html = await renderTree(
      createElement(
        "main",
        null,
        createElement("title", null, "hoisted"),
        createElement("meta", { name: "description", content: "hoisted" }),
        "body copy",
      ),
    );
    expect(html.startsWith("<main")).toBe(true);
    expect(html).toContain("body copy");
  });

  it("keeps a script the page itself carries", async () => {
    const html = await renderTree(
      createElement("main", null, createElement("script", { type: "application/ld+json" }, "{}")),
    );
    expect(html).toContain("application/ld+json");
  });

  // `renderToString` answers "" for a router whose basename does not match its location — no
  // error, no warning. A build must not be allowed to write that file.
  it("refuses a tree that rendered to nothing", async () => {
    await expect(renderTree(null)).rejects.toThrow(/rendered to nothing/);
  });

  it("fails the build when a component throws", async () => {
    const Boom = (): ReactNode => {
      throw new Error("boom");
    };
    await expect(renderTree(createElement(Boom))).rejects.toThrow(/boom/);
  });
});
