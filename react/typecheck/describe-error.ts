import { createErrorDescriber, type ErrorArm, type Translate } from "../src/describe-error.ts";

// The calls adopters write, as they write them. Compiled, never run.
//
// Every form a `t` and the arms arrive in: `t` named or inline, arms inline, in a variable, or
// absent. An inline `t` beside inline arms failed overload resolution while `t` was one of the
// places the type parameters were inferred from, and only an adopter writing both inline saw it.

declare const t: Translate;
const serverErrors = { NOT_FOUND: "That was not found." };
const codes: Partial<Record<string, ErrorArm>> = {
  RATE_LIMIT_EXCEEDED: ({ error, says }) => ({ cause: says ?? error.message }),
};
const copy = { network: "", networkHint: "", unexpected: "", retrySoon: "" };
const translated = {
  copyPrefix: "errors.",
  formatWait: String,
  messageKeyPrefix: "serverErrors.",
  knownMessageKeys: serverErrors,
} as const;

// Translated, inline `t`.
createErrorDescriber({
  ...translated,
  t: (key, params) => t(key, params),
  codes: { RATE_LIMIT_EXCEEDED: ({ error, says }) => ({ cause: says ?? error.message }) },
});
createErrorDescriber({ ...translated, t: (key, params) => t(key, params), codes });
createErrorDescriber({ ...translated, t: (key, params) => t(key, params) });

// Translated, named `t`.
createErrorDescriber({
  ...translated,
  t,
  codes: { RATE_LIMIT_EXCEEDED: ({ error, says }) => ({ cause: says ?? error.message }) },
});
createErrorDescriber({ ...translated, t, codes });
createErrorDescriber({ ...translated, t });

// One language.
createErrorDescriber({
  copy,
  formatWait: String,
  codes: { RATE_LIMIT_EXCEEDED: ({ error, says }) => ({ cause: says ?? error.message }) },
});
createErrorDescriber({ copy, formatWait: String, codes });
createErrorDescriber({ copy, formatWait: String });

// A catalog without one of the describer's own sentences is refused, rather than showing a raw key.
createErrorDescriber({
  ...translated,
  // @ts-expect-error -- this `t` has no `errors.retrySoon`.
  t: (
    key: "errors.network" | "errors.networkHint" | "errors.unexpected" | "serverErrors.NOT_FOUND",
  ) => key,
});

// A sentence missing from `copy` is refused: a 5xx would show `undefined` without `retrySoon`.
createErrorDescriber({
  // @ts-expect-error -- no `retrySoon`.
  copy: { network: "", networkHint: "", unexpected: "" },
  formatWait: String,
});
