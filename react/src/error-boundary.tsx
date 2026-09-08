import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * The last stop before a white screen.
 *
 * React unmounts the whole tree when a render throws, and an app with no boundary anywhere
 * answers that with a blank page: no words, no navigation, no reload — the most complete dead
 * end a product can produce, and the one the never-dead-end rule cannot reach, because by then
 * there is no component left to render a state from.
 *
 * It is deliberately dumb. No retry loop, no error reporting, no reset on a timer: it catches,
 * it hands the error to a `fallback` the app draws in its own words, and it offers `reset`.
 * Every donor that baked its own UI in here had to keep a second copy for its second surface;
 * a render prop has no such problem, and the brand stays in the product where it belongs.
 *
 * A class, because `getDerivedStateFromError` has no hook equivalent — this is the one thing in
 * the kit React still has no other way to express.
 */

export interface ErrorBoundaryFallbackProps {
  error: Error;
  /** Put the children back. */
  reset: () => void;
  /**
   * True when the throw was a failed lazy-chunk import — a deploy landed while this tab was
   * open, so the fix is a reload and NOT a retry (a rejected dynamic import rethrows on
   * re-render forever). Draw the "updating" screen, not the crash screen.
   */
  isChunkError: boolean;
}

export interface ErrorBoundaryProps {
  /** Drawn instead of the children once something has thrown. */
  fallback: (props: ErrorBoundaryFallbackProps) => ReactNode;
  /**
   * Changing this value clears the error and remounts the children — pass the route, so
   * navigating away from a screen that broke actually leaves it rather than carrying its
   * wreckage to every page after it.
   */
  resetKey?: string;
  /** Called once per catch. Report to whatever the app reports to. */
  onError?: (error: Error, info: ErrorInfo) => void;
  /**
   * Classify a chunk-load failure. Pass `isChunkLoadError` from this package; it is a
   * parameter rather than a hard import so an app that does not lazy-load pays nothing.
   */
  isChunkError?: (error: unknown) => boolean;
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** Which `resetKey` the current error belongs to. */
  key: string | undefined;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null, key: undefined };

  static getDerivedStateFromError(error: Error): Pick<State, "error"> {
    return { error };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: State): State | null {
    if (state.error === null) return { error: null, key: props.resetKey };
    // The error belongs to the screen it happened on. Somewhere else is a fresh start, and
    // staying broken there would strand somebody who already did the sensible thing and
    // navigated away.
    return state.key === props.resetKey ? null : { error: null, key: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
    if (!this.props.onError) console.error("Unhandled render error", error, info.componentStack);
  }

  private readonly reset = (): void => this.setState({ error: null, key: undefined });

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return this.props.fallback({
      error,
      reset: this.reset,
      isChunkError: this.props.isChunkError?.(error) ?? false,
    });
  }
}
