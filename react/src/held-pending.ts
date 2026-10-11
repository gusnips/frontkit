import { useEffect, useRef, useState } from "react";

// A refresh that answers in 80 ms flips its `pending` flag on and off inside a frame or two. The
// reader pressed the button, nothing on screen changed, and the page looks like it ignored them.
// A louder spinner does not fix that, because the spinner is never painted. The flag itself has
// to stay on long enough to be seen.

/**
 * `pending`, kept on for at least `minMs` once it turns on.
 *
 * It answers `true` on the very render `pending` turns true, with no wait for an effect, so the
 * busy state shows on the press and not a frame later. A slow request is not made slower: the
 * hold only fills the gap when the request ended early, and ends within one timer tick of it
 * otherwise.
 *
 * 400 ms is the floor for a busy state a person can read as "it ran". Use it for a button's busy
 * look, a refresh icon, a save that returns at once. Do not use it to gate real work: it changes
 * what is shown, never what the request does.
 */
export function useHeldPending(pending: boolean, minMs = 400): boolean {
  const [held, setHeld] = useState(false);
  const startedAt = useRef(0);

  // Raised while rendering, not in an effect, so there is no frame where `pending` is true and the
  // hold is not. It only ever turns on here. The timer below is the one place it turns off.
  if (pending && !held) setHeld(true);

  useEffect(() => {
    if (pending) {
      startedAt.current = Date.now();
      return;
    }
    const remaining = Math.max(0, startedAt.current + minMs - Date.now());
    const timer = setTimeout(() => setHeld(false), remaining);
    return () => clearTimeout(timer);
  }, [pending, minMs]);

  return pending || held;
}
