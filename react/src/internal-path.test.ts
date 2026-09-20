import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./internal-path.ts";

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
