import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compose class names, letting later Tailwind utilities win over earlier ones
 * (`p-2 p-4` → `p-4`).
 *
 * That precedence is the whole point, and it is why this is not `clsx` alone: a caller's
 * `className` has to be able to OVERRIDE a component's defaults rather than fight them at
 * equal specificity, where the winner would be whichever rule Tailwind happened to emit last.
 *
 * Ten repos wrote this function. All ten wrote it identically.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
