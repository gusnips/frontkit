import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createRequireAnonymous,
  createRequireAuth,
  createRequireProfile,
  type MeQuery,
} from "./guards.tsx";

// `react-router-dom` is mocked rather than wrapped in a real router. Every question here is only
// WHICH branch a guard picked, and a redirect is the one branch with no children to read — so
// `Navigate` never has to run, it only has to be identifiable as an element type. That is what
// lets the redirect cases assert a destination without rendering anything.
const router = vi.hoisted(() => ({
  Navigate: vi.fn(),
  useLocation: vi.fn(() => ({ pathname: "/posts", search: "?page=2", hash: "#comments" })),
}));
vi.mock("react-router-dom", () => router);

/**
 * One render, as plain data.
 *
 * A function component IS a function, so calling it returns the element it would have rendered —
 * no DOM, no renderer, nothing mounted, and no test-only dependency to install. The cast is this
 * file admitting it reads two fields off that element and nothing else.
 */
type Rendered = { type: unknown; props: Record<string, unknown> };
const render = (Guard: (p: { children: ReactNode }) => ReactNode): Rendered =>
  Guard({ children: "CONTENT" }) as unknown as Rendered;

/** Which branch came back: a redirect names its destination, every other branch names its child. */
const branch = (r: Rendered): unknown =>
  r.type === router.Navigate ? { to: r.props.to, state: r.props.state } : r.props.children;

const session =
  (isAuthenticated: boolean, isLoading = false) =>
  () => ({
    isAuthenticated,
    isLoading,
  });

const profile = (me: MeQuery<{ suspended: boolean }>) =>
  createRequireProfile(() => me, { loading: "LOADING" })(
    (m) => !m.suspended,
    "DENIED",
    (error) => `FAILED:${String(error)}`,
  );

describe("createRequireProfile", () => {
  it("waits while the profile is still being asked for", () => {
    expect(branch(render(profile({ status: "pending" })))).toBe("LOADING");
  });

  // Invariant 4, and the reason this module exists rather than being written a ninth time.
  // `!me?.isStaff` reads an undefined profile as a real "no", so an outage on /auth/me becomes a
  // refusal — the wrong cause, no retry, and no request id to quote. Three repos shipped that, and
  // in two of them the sibling guard failed the other way for the same reason: `me?.suspended` read
  // a failure as "not suspended" and let a suspended account straight through. One mistake, closed
  // on one screen and OPEN on the next, which is why a failure must reach neither answer.
  it("does not read a failed query as a refusal", () => {
    const failed = branch(render(profile({ status: "error", error: "boom" })));
    expect(failed).toBe("FAILED:boom");
    expect(failed).not.toBe("DENIED");
    expect(failed).not.toBe("CONTENT");
  });

  it("refuses only on a real no", () => {
    expect(branch(render(profile({ status: "success", data: { suspended: true } })))).toBe(
      "DENIED",
    );
  });

  it("lets an allowed profile through", () => {
    expect(branch(render(profile({ status: "success", data: { suspended: false } })))).toBe(
      "CONTENT",
    );
  });

  it("takes a refusal as a function, for one built only when it is used", () => {
    const Guard = createRequireProfile(() => ({ status: "success" as const, data: 1 }), {
      loading: "LOADING",
    })(
      () => false,
      () => "DENIED-LAZY",
      () => "FAILED",
    );
    expect(branch(render(Guard))).toBe("DENIED-LAZY");
  });
});

describe("createRequireAuth", () => {
  const guard = (isAuthenticated: boolean, isLoading = false) =>
    createRequireAuth(session(isAuthenticated, isLoading), "/login", { loading: "LOADING" });

  it("waits while the session is still resolving", () => {
    expect(branch(render(guard(false, true)))).toBe("LOADING");
  });

  // The URL carries the whole destination because router state is lost on reload, OAuth and email
  // links. The sign-in screen reads `next`, validates it, and replaces this history entry.
  it("remembers the whole address it turned away", () => {
    expect(branch(render(guard(false)))).toEqual({
      to: "/login?next=%2Fposts%3Fpage%3D2%23comments",
      state: undefined,
    });
  });

  // Point an OAuth `redirectTo` at a guarded route and this is the first render after the provider
  // returns: no session yet, and the implicit flow's tokens still sitting in the address bar. The
  // page is worth remembering; the fragment would be a refresh token written into a query string.
  it("refuses to carry a callback's tokens into the sign-in URL", () => {
    router.useLocation.mockReturnValueOnce({
      pathname: "/dashboard",
      search: "?tab=usage",
      hash: "#access_token=eyJhbG.p.s&refresh_token=v1_abc&token_type=bearer",
    });
    expect(branch(render(guard(false)))).toEqual({
      to: "/login?next=%2Fdashboard%3Ftab%3Dusage",
      state: undefined,
    });
  });

  it("lets a signed-in visitor through", () => {
    expect(branch(render(guard(true)))).toBe("CONTENT");
  });
});

describe("createRequireAnonymous", () => {
  const guard = (isAuthenticated: boolean, isLoading = false) =>
    createRequireAnonymous(session(isAuthenticated, isLoading), "/", { loading: "LOADING" });

  it("waits while the session is still resolving", () => {
    expect(branch(render(guard(true, true)))).toBe("LOADING");
  });

  it("sends a signed-in visitor home", () => {
    expect(branch(render(guard(true)))).toEqual({ to: "/", state: undefined });
  });

  it("resumes a carried internal route", () => {
    router.useLocation.mockReturnValueOnce({
      pathname: "/login",
      search: "?next=%2Fposts%3Fpage%3D2%23comments",
      hash: "",
    });
    expect(branch(render(guard(true)))).toEqual({
      to: "/posts?page=2#comments",
      state: undefined,
    });
  });

  it("falls home instead of following an external target", () => {
    router.useLocation.mockReturnValueOnce({
      pathname: "/login",
      search: "?next=%2F%2Fevil.test",
      hash: "",
    });
    expect(branch(render(guard(true)))).toEqual({ to: "/", state: undefined });
  });

  it("lets an anonymous visitor through", () => {
    expect(branch(render(guard(false)))).toBe("CONTENT");
  });
});
