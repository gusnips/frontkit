import type { ClassValue } from "clsx";
import { cn } from "../cn.ts";

/**
 * A Base UI part's `className`: a plain string, or a function of that part's own state
 * (`open`, `transitionStatus`, `highlighted`, …).
 */
export type StateClassName<State> = string | ((state: State) => string | undefined) | undefined;

/**
 * Merge a wrapper's own classes with the caller's, keeping BOTH forms working.
 *
 * `cn()` on its own silently DROPS the function form — clsx walks strings, arrays and plain
 * objects, and a function is none of the three — so a caller styling by `open` or
 * `transitionStatus` would get an empty class and no warning. Always returning a function
 * keeps one code path for both.
 */
export function mergeClassName<State>(
  base: ClassValue,
  extra: StateClassName<State>,
): (state: State) => string {
  return (state) => cn(base, typeof extra === "function" ? extra(state) : extra);
}
