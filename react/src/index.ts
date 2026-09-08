// @gusnips/react — the headless runtime under a Vite + React SPA.
//
// No styling, no brand, no Node built-ins. The Base UI wrappers live behind `@gusnips/react/ui`
// so an app on a different primitive library (or none) never resolves `@base-ui/react`.

export { cn } from "./cn.ts";

export { ApiError, isAbortError } from "./api-error.ts";
export {
  createApiClient,
  type ApiClient,
  type ApiClientOptions,
  type RefreshResult,
  type RequestOptions,
  type SessionAdapter,
} from "./api-client.ts";
export { createSseParser, readSseStream, type SseFrame } from "./sse.ts";

export { createAuthStore, type AuthState } from "./auth-store.ts";
export { queryDefaults, shouldRetry, type QueryDefaultsOptions } from "./query.ts";

export {
  createRequireAnonymous,
  createRequireAuth,
  createRequireProfile,
  type GuardOptions,
  type MeQuery,
  type SessionState,
} from "./guards.tsx";

export {
  ErrorBoundary,
  type ErrorBoundaryFallbackProps,
  type ErrorBoundaryProps,
} from "./error-boundary.tsx";
export {
  createErrorDescriber,
  humanizeWait,
  retryAfterSecs,
  type DescribedError,
  type ErrorContext,
  type ErrorDescriberOptions,
  type Translate,
} from "./describe-error.ts";

export {
  installPreloadErrorHandler,
  isChunkLoadError,
  isPreloadHintFailure,
  reloadOnceForChunkError,
} from "./chunk-reload.ts";

export { hydrateOrMount, PRERENDERED_ROUTE_ATTR, SHELL_ROUTE } from "./hydrate.ts";

export { applyBrandVars, i18nInitOptions, type I18nInitOptions } from "./i18n.ts";

export type { EmptyStateProps, ErrorStateProps } from "./states.ts";
