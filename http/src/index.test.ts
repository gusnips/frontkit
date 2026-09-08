import { describe, expect, it } from "vitest";
import { asErrorCode, isApiError } from "./index.ts";

const CODES = ["NOT_FOUND", "RATE_LIMIT_EXCEEDED", "INTERNAL_ERROR"] as const;
type Code = (typeof CODES)[number];

describe("asErrorCode", () => {
  it("passes a known code through", () => {
    expect(asErrorCode<Code>(CODES, "NOT_FOUND", "INTERNAL_ERROR")).toBe("NOT_FOUND");
  });

  // The invariant: a server deployed ahead of the bundle a tab is still running sends a code
  // this build has never heard of. That must degrade, not throw — an exception here would
  // turn a refusal the server explained into a crash the client cannot report.
  it("falls back rather than throwing on a code from a newer server", () => {
    expect(asErrorCode<Code>(CODES, "SOME_CODE_SHIPPED_LAST_TUESDAY", "INTERNAL_ERROR")).toBe(
      "INTERNAL_ERROR",
    );
  });
});

describe("isApiError", () => {
  it("recognises the error half of the envelope", () => {
    expect(isApiError({ error: { code: "NOT_FOUND", message: "no" } })).toBe(true);
  });

  it("rejects the success half, and anything that is not an object", () => {
    expect(isApiError({ data: { id: 1 } })).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError("error")).toBe(false);
    // `{error: null}` is the one that a bare `"error" in body` check gets wrong — a route
    // that serialises a null error field would be read as a refusal with no code.
    expect(isApiError({ error: null })).toBe(false);
  });
});
