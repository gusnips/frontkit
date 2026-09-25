import type { ReactNode } from "react";

/**
 * The two contracts that make "never dead-end the user" a compile error instead of a rule
 * somebody remembers.
 *
 * **No component ships here, on purpose.** Seven repos have an `EmptyState.tsx` and an
 * `ErrorState.tsx`, and read side by side they overlap 9–37%: one draws a tinted icon badge,
 * one a branded illustration set, one a mascot. What they genuinely share is the PROP SHAPE —
 * which is the rule itself, and the only part a package can hold without deciding how eight
 * brands look. Same reasoning as the styled Button: share behaviour, skin per product.
 *
 * Import the type, write your own component against it, and the compiler enforces the rest.
 */

/**
 * A panel with nothing in it yet.
 *
 * The prop shape IS the rule: somebody who lands here must learn what this panel is FOR
 * (`title`), what belongs IN it (`description`), and how to FILL it (`action`). The first two
 * are required because two of the three are what make it an orientation rather than a shrug.
 * `action` is optional only because some panels fill themselves once a job upstream finishes.
 */
export interface EmptyStateProps {
  /** What this panel is for. "No lookups yet" — not "No results". */
  title: string;
  /** What belongs here, and what it will show once it does. */
  description: ReactNode;
  /** The way forward, as a control. Usually one button. */
  action?: ReactNode;
  /**
   * `3` inside a panel that already sits under a page heading — the default and the common
   * case. `1` when this composer IS the page (a 404, a suspended account), which otherwise
   * ships a document with no `h1` in it at all.
   *
   * Only one donor had this, and it is the difference between a screen reader announcing a
   * page and announcing nothing.
   *
   * **The type cannot make your panel read it.** A panel that always renders an `<h3>` accepts
   * `headingLevel={1}` and ignores it, and the page ships with no `h1`. The guide's own example
   * app did exactly that on its 404 until a browser check found it. Render the heading from the
   * prop: `` const Heading = `h${headingLevel}` as const ``.
   */
  headingLevel?: 1 | 2 | 3;
  className?: string;
}

/**
 * Something did not work.
 *
 * `problem` names what failed, `cause` says why it most likely happened, `fix` says what to do
 * about it, and `action` is that fix as a control. **`fix` and `action` are both required** — a
 * required prop is the only version of "never dead-end" that a caller in a hurry cannot skip,
 * and the donor that made them required is the one whose error screens all have a way out.
 *
 * Not a place for a stack trace. `cause` is what a person can act on ("the site answered too
 * slowly"), with the request id, if there is one, alongside it in `reference`.
 *
 * {@link DescribedError} from `describe-error.ts` produces `cause` and `fix` from a thrown
 * `ApiError`, which is the seam these two were designed against.
 */
export interface ErrorStateProps {
  /** What failed, in the reader's words. "Couldn't load your numbers". */
  problem: string;
  /** Why it most likely happened. */
  cause?: ReactNode;
  /** The way forward, in words. */
  fix: ReactNode;
  /** The way forward, as a control — usually a retry button. */
  action: ReactNode;
  /** A request id or code, for a support thread. Set in mono, never shouted. */
  reference?: ReactNode;
  /** See {@link EmptyStateProps.headingLevel}. */
  headingLevel?: 1 | 2 | 3;
  className?: string;
}
