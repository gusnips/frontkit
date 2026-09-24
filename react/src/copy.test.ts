import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copy.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyText", () => {
  it("answers true once the clipboard has the text", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("sk_live_1")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("sk_live_1");
  });

  it("answers false when the browser refuses the write", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) },
    });
    await expect(copyText("sk_live_1")).resolves.toBe(false);
  });

  // Over plain http there is no `navigator.clipboard`, so `writeText` is read off `undefined` and
  // throws before any promise exists. Two copies in the fleet let that escape the click handler.
  it("answers false, and does not throw, where there is no clipboard API", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyText("sk_live_1")).resolves.toBe(false);
  });
});
