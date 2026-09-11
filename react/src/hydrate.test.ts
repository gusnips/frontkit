import { beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateOrMount, SHELL_ROUTE } from "./hydrate.ts";

// Both roots are mocked: the question is only WHICH one the entry picks, and either choice is
// silent in a real browser — a wrong mount looks like a hydrate and a wrong hydrate recovers.
const roots = vi.hoisted(() => ({
  hydrateRoot: vi.fn(),
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}));
vi.mock("react-dom/client", () => roots);

/** A root whose file names `route` — or names nothing, for `null`. */
const rootFor = (route: string | null): Element =>
  ({ getAttribute: () => route }) as unknown as Element; // Only `getAttribute` is read.

const picked = (): "hydrate" | "mount" => {
  const hydrated = roots.hydrateRoot.mock.calls.length > 0;
  const mounted = roots.createRoot.mock.calls.length > 0;
  expect(hydrated !== mounted).toBe(true);
  return hydrated ? "hydrate" : "mount";
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hydrateOrMount", () => {
  it("hydrates the render this file is", () => {
    hydrateOrMount(rootFor("/precos"), null, "/precos");
    expect(picked()).toBe("hydrate");
  });

  it.each([
    ["the address has one", "/precos", "/precos/"],
    ["the file has one", "/precos/", "/precos"],
  ])("ignores a trailing slash when %s", (_case, rendered, route) => {
    hydrateOrMount(rootFor(rendered), null, route);
    expect(picked()).toBe("hydrate");
  });

  it("keeps the front page's slash — it is the whole path", () => {
    hydrateOrMount(rootFor("/"), null, "/");
    expect(picked()).toBe("hydrate");
  });

  it("mounts fresh over a different page", () => {
    hydrateOrMount(rootFor("/precos"), null, "/faq");
    expect(picked()).toBe("mount");
  });

  it("mounts fresh over a shell, whatever the address", () => {
    hydrateOrMount(rootFor(SHELL_ROUTE), null, "/nao-existe");
    expect(picked()).toBe("mount");
  });

  it("mounts fresh over a file that names no route", () => {
    hydrateOrMount(rootFor(null), null, "/precos");
    expect(picked()).toBe("mount");
  });

  it("mounts fresh when the reader cannot be shown this file at all", () => {
    hydrateOrMount(rootFor("/precos"), null, null);
    expect(picked()).toBe("mount");
  });
});
