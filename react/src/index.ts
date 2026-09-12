// @gusnips/react — the headless runtime under a Vite + React SPA.
//
// No styling, no brand, no Node built-ins.
//
// Three things live behind their own subpath, and the rule picking them is invariant 15 stated
// as a test rather than a judgement: **a peer marked `optional` must not be reachable from this
// barrel.** An optional peer the barrel imports anyway is not optional — it is a required peer
// with the error moved from install time to the adopter's first build, which is the worse of the
// two places to find out.
//
//   @gusnips/react/ui       the Base UI wrappers   → @base-ui/react
//   @gusnips/react/store    createAuthStore        → zustand
//   @gusnips/react/guards   the route guards       → react-router-dom
//   @gusnips/react/hydrate  hydrateOrMount         → react-dom
//
// `react-dom` is the one the second migration added, and it is the sharpest case yet: that
// adopter ships a REACT NATIVE app beside its two web apps, and React Native has no react-dom to
// give. A required peer nobody can satisfy is not a strict contract, it is a closed door — the
// whole package was unusable there, for one function no phone would ever call. The rule did not
// need changing to catch it; `react-dom` simply had to stop being required.
//
// So what is left here imports `react` and `@gusnips/http` and nothing else, and an app on
// TanStack Router, on Redux, or on a phone takes the fetch client without installing a router, a
// store or a DOM renderer it will never call. `@tanstack/react-query`, `i18next` and
// `react-i18next` stay optional AND stay here, because `query.ts`, `i18n.ts` and `states.ts`
// import only their TYPES — which erase, so the built barrel does not reference them at runtime.
// Check that claim against `dist/`, never against this file: a type-only re-export looks
// identical in source.

export { cn } from "./cn.ts";

export { ApiError, isAbortError, retryAfterSecs } from "./api-error.ts";
export {
  createApiClient,
  type ApiClient,
  type ApiClientOptions,
  type RefreshResult,
  type RequestOptions,
  type SessionAdapter,
} from "./api-client.ts";
export { createSseParser, readSseStream, type SseFrame } from "./sse.ts";

export { queryDefaults, retryDelayMs, shouldRetry, type QueryDefaultsOptions } from "./query.ts";

export {
  ErrorBoundary,
  type ErrorBoundaryFallbackProps,
  type ErrorBoundaryProps,
} from "./error-boundary.tsx";
export {
  createErrorDescriber,
  humanizeWait,
  type DescribedError,
  type ErrorArm,
  type ErrorContext,
  type ErrorDescriberOptions,
  type Translate,
} from "./describe-error.ts";

export {
  installPreloadErrorHandler,
  isChunkLoadError,
  isPreloadHintFailure,
  isStaleBuild,
  RELOAD_GUARD_KEY,
  reloadOnce,
} from "./deploy-recovery.ts";

// The two constants, but NOT `hydrateOrMount` — that one is at `@gusnips/react/hydrate`, because
// it is the package's only `react-dom` import. These come from the contract module, which imports
// nothing at all, so they are free to everyone: a build script, a browser entry, or a phone.
export { PRERENDERED_ROUTE_ATTR, SHELL_ROUTE } from "./prerender-contract.ts";

export { applyBrandVars, i18nInitOptions, type I18nInitOptions } from "./i18n.ts";

export type { EmptyStateProps, ErrorStateProps } from "./states.ts";
