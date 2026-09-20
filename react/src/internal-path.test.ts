import { describe, expect, it } from "vitest";
import { returnPathFromLocation, safeInternalPath } from "./internal-path.ts";

describe("safeInternalPath", () => {
  it.each([
    ["/", "/"],
    ["/posts?page=2#comments", "/posts?page=2#comments"],
    ["/safe\\child", "/safe/child"],
    ["/%252f%252fevil.test", "/%252f%252fevil.test"],
  ])("keeps %s on this origin", (value, expected) => {
    expect(safeInternalPath(value)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    7,
    "",
    "posts",
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    `/\t/evil.test`,
    `/\n/evil.test`,
  ])("refuses an external or malformed target: %s", (value) => {
    expect(safeInternalPath(value)).toBeNull();
  });
});

describe("returnPathFromLocation", () => {
  it("keeps the whole address, fragment included", () => {
    expect(
      returnPathFromLocation({
        pathname: "/w/acme/products/api/changes",
        search: "?feature=f1",
        hash: "#change-8f3",
      }),
    ).toBe("/w/acme/products/api/changes?feature=f1#change-8f3");
  });

  it.each([
    "access_token",
    "refresh_token",
    "id_token",
    "provider_token",
    "provider_refresh_token",
  ])("drops a fragment carrying %s, and keeps the page", (key) => {
    expect(
      returnPathFromLocation({
        pathname: "/app",
        search: "?tab=repos",
        hash: `#${key}=ey.J.h&expires_in=3600&token_type=bearer`,
      }),
    ).toBe("/app?tab=repos");
  });

  it("drops the whole implicit response, not only its credential keys", () => {
    // Verbatim shape of what a Supabase client with no `flowType` puts back in the address bar.
    const hash =
      "#access_token=eyJhbG.payload.sig&expires_at=1790000000&expires_in=3600" +
      "&provider_token=gho_x&refresh_token=v1_abc&token_type=bearer&type=magiclink";
    expect(returnPathFromLocation({ pathname: "/app", search: "", hash })).toBe("/app");
  });

  it("keeps a fragment that only looks like parameters", () => {
    const at = { pathname: "/docs", search: "", hash: "#tab=repos&expires_in=3600" };
    expect(returnPathFromLocation(at)).toBe("/docs#tab=repos&expires_in=3600");
  });

  it("handles an address with no fragment at all", () => {
    expect(returnPathFromLocation({ pathname: "/", search: "", hash: "" })).toBe("/");
  });
});
