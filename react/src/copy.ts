import { useCallback, useEffect, useState } from "react";

// Eight products wrote a copy button, and five of them failed silently, one under a comment
// saying it must not. Silent is worse than it looks: the reader pastes whatever was already on
// the clipboard, and for a key shown once that is pasting something else over the only copy.
// Two more called `writeText` outside a `try`, and on a page not served over https there is no
// `navigator.clipboard` at all, so the click threw a TypeError instead of rejecting.
//
// No `execCommand` fallback, and none of the eight had one: it is deprecated, the async API is
// there in every browser over https, and a copy that says it failed beats a shim that pretends.

/** Write `text` to the clipboard. `false` when the browser refused or has no clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type CopyState = "idle" | "copied" | "failed";

export interface CopyOptions {
  /** How long `"copied"` shows. Default 2000 ms. */
  copiedMs?: number;
  /** How long `"failed"` shows. Default 6000 ms: a failure is a sentence the reader has to act on. */
  failedMs?: number;
}

/**
 * A copy with an outcome the reader can see. What it says stays yours — "Copied", or "Select it
 * and copy it yourself", in a label or a toast — and so does announcing it: a label that changes
 * needs `aria-live="polite"` to be heard.
 *
 * The outcome goes back to `"idle"` on its own. A "Copied" that never clears makes the second copy
 * look like it did not take.
 */
export function useCopy({ copiedMs = 2000, failedMs = 6000 }: CopyOptions = {}): {
  state: CopyState;
  /** Resolves `false` instead of throwing, so a caller can toast without a `catch`. */
  copy: (text: string) => Promise<boolean>;
} {
  // A new object on every copy, so copying again restarts the clock even when the state is the
  // same: two copies a second apart read "Copied" for two seconds after the second one.
  const [outcome, setOutcome] = useState<{ state: CopyState }>({ state: "idle" });

  useEffect(() => {
    if (outcome.state === "idle") return;
    const ms = outcome.state === "copied" ? copiedMs : failedMs;
    const timer = setTimeout(() => setOutcome({ state: "idle" }), ms);
    return () => clearTimeout(timer);
  }, [outcome, copiedMs, failedMs]);

  const copy = useCallback(async (text: string) => {
    const copied = await copyText(text);
    setOutcome({ state: copied ? "copied" : "failed" });
    return copied;
  }, []);

  return { state: outcome.state, copy };
}
