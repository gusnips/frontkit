import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "./error-boundary.tsx";

/**
 * The two statics are pure, which is why the reset rule lives in them: it can be checked with no
 * DOM, no renderer and no thrown error.
 *
 * What is worth pinning is that a caught error belongs to the screen it happened on. Wrong one way,
 * navigating away carries the wreckage to every page after it. Wrong the other way, the fallback
 * clears itself at once and re-renders the component that just threw, which throws again: a
 * flicker instead of a state. Lifted from an adopter's copy of this class, deleted when it moved
 * onto the kit's.
 */
const props = (resetKey: string | undefined) => ({
  resetKey,
  fallback: () => null,
  children: null,
});

describe("ErrorBoundary", () => {
  it("records the error that was thrown", () => {
    const error = new TypeError("outcome is not a key of TONE");
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  it("keeps the error while the route stays put", () => {
    const state = { error: new Error("boom"), key: "/jobs/abc" };
    expect(ErrorBoundary.getDerivedStateFromProps(props("/jobs/abc"), state)).toBeNull();
  });

  it("clears the error when the route changes", () => {
    const state = { error: new Error("boom"), key: "/jobs/abc" };
    expect(ErrorBoundary.getDerivedStateFromProps(props("/keys"), state)).toEqual({
      error: null,
      key: "/keys",
    });
  });

  it("tracks the route while nothing has thrown, so the first error is scoped to it", () => {
    // Without this the key would still hold the route the boundary mounted on, and the first
    // error on any later route would clear itself on the next re-render.
    const state = { error: null, key: "/" };
    expect(ErrorBoundary.getDerivedStateFromProps(props("/usage"), state)).toEqual({
      error: null,
      key: "/usage",
    });
  });
});
