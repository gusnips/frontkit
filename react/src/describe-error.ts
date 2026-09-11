import { ApiError, retryAfterSecs } from "./api-error.ts";

/**
 * Turning anything thrown into copy a person can act on.
 *
 * The API already answers with a message written for a developer, a stable `messageKey` for the
 * domain refusals, and `details` carrying the parts that make a refusal actionable. This is the
 * one place that decides what the SCREEN says — which is not always the same sentence.
 * "Monthly quota spent, upgrade or buy a pack" is right in a JSON body and wrong under a button
 * that could just say what to do next.
 *
 * `cause` is what happened. `hint` is what to do about it. **A surface that shows only the first
 * half is the dead end this exists to prevent** — which is why the type has two fields and not
 * one, and why `hint` being absent should be a deliberate choice at each call site rather than
 * the default nobody noticed.
 *
 * The per-code switch stays in the product: two donors' switches shared their SHAPE and almost
 * no arms, because the arms are that API's vocabulary. What ships is the scaffolding around it,
 * which is the part that was written twice and got subtly different both times.
 */

export interface DescribedError {
  /** What happened, in the reader's words. */
  cause: string;
  /** What to do about it. Its absence should be a decision, not an oversight. */
  hint?: string;
}

/**
 * The subset of i18next's `t` this module needs — typed here so `i18next` stays optional.
 *
 * `Key` is a parameter and not plain `string` for a reason the first migration found. Every app
 * on this stack declares `CustomTypeOptions.resources`, which types `t` to accept ONLY the keys
 * its catalog has — so a `t` is not assignable to anything asking for `(key: string) => string`,
 * and the adopter is left with a cast. Naming the keys instead turns that around: each function
 * below asks for exactly the keys it looks up, a typed `t` accepts a superset of them and goes
 * in directly, and a catalog missing one is a compile error rather than a raw key on screen.
 */
export type Translate<Key extends string = string> = (
  key: Key,
  params?: Record<string, unknown>,
) => string;

/** The three names {@link humanizeWait} looks up, under whatever prefix you pass it. */
type WaitName = "waitSeconds" | "waitMinutes" | "waitHours";

/** Every name {@link createErrorDescriber} looks up itself. Your catalog carries all of them. */
type CopyName = WaitName | "network" | "networkHint" | "unexpected" | "retrySoon";

/**
 * The paragraph above, pinned so it cannot quietly stop being true.
 *
 * `ClosedCatalog` is what an app's `t` looks like once it declares `CustomTypeOptions.resources`:
 * a closed union, nothing else accepted. It must go straight into the options below. Widen `Key`
 * back to `string` and this stops compiling HERE, rather than at the eleventh adopter reaching
 * for the cast the house rules forbid.
 */
type Satisfied<T extends true> = T;
type ClosedCatalog = (
  key:
    | "errors.network"
    | "errors.networkHint"
    | "errors.unexpected"
    | "errors.retrySoon"
    | "errors.waitSeconds"
    | "errors.waitMinutes"
    | "errors.waitHours"
    | "serverErrors.quotaDay"
    | "billing.plan",
  params?: Record<string, unknown>,
) => string;
type _TypedCatalogNeedsNoCast = Satisfied<
  ClosedCatalog extends ErrorDescriberOptions<"errors.", "serverErrors.", "quotaDay">["t"]
    ? true
    : false
>;

/**
 * "in 4 minutes" / "in 2 hours" — a wait nobody has to convert from seconds.
 *
 * The thresholds are deliberately not round: 90 seconds rather than 60, so "in 75 seconds" does
 * not become the less precise "in 1 minute", and 90 minutes rather than 60 for the same reason
 * one rung up. Needs `waitSeconds` / `waitMinutes` / `waitHours` under `prefix`, each with a
 * `count` plural.
 */
export function humanizeWait<Prefix extends string>(
  t: Translate<`${Prefix}${WaitName}`>,
  secs: number,
  prefix: Prefix,
): string {
  if (secs < 90) return t(`${prefix}waitSeconds`, { count: Math.max(1, Math.round(secs)) });
  if (secs < 90 * 60) return t(`${prefix}waitMinutes`, { count: Math.round(secs / 60) });
  return t(`${prefix}waitHours`, { count: Math.round(secs / 3600) });
}

export interface ErrorContext {
  error: ApiError;
  /** The server's own localized sentence, when `messageKey` named one this build carries. */
  says: string | null;
  /** Seconds until it clears, already humanized. Null when the envelope did not say. */
  wait: string | null;
  waitSecs: number | null;
}

export interface ErrorDescriberOptions<
  Prefix extends string,
  ServerPrefix extends string,
  ServerName extends string,
> {
  t: Translate<`${Prefix}${CopyName}` | `${ServerPrefix}${ServerName}`>;
  /** Catalog namespace for this module's own copy, e.g. `"errors."`. */
  copyPrefix: Prefix;
  /**
   * The server's own catalog namespace, e.g. `"serverErrors."`. A `messageKey` outside it is
   * ignored — the server names a sentence, it does not get to name any key in the app.
   *
   * The `code` is read under this prefix too, for an API that has no `messageKey` field and
   * lets the code name the sentence — one repo in the fleet has 98 of those, `errors.NOT_FOUND`
   * and its siblings, against another repo's `messageKey`. Both are the same claim ("the server
   * named a sentence this app carries"), both pass the same gate below, and an app that uses
   * neither is unaffected because nothing matches.
   */
  messageKeyPrefix: ServerPrefix;
  /**
   * The keys this build actually carries, usually the `serverErrors` object out of the English
   * catalog. Passing the catalog itself is both the membership test and the proof the compiler
   * wants: a name that is in it IS a key, so the lookup below needs no cast.
   *
   * It is required because leaving it out is not a smaller version of this — it is the bug the
   * option exists to prevent. i18next answers a key it does not have with the key itself, so a
   * deploy landing ahead of the bundle a tab is still running would render `serverErrors.foo` at
   * somebody. A name that is absent falls back to the server's English `message` instead.
   */
  knownMessageKeys: Record<ServerName, unknown>;
  /**
   * Per-code copy. Everything not listed falls through to the default arm.
   *
   * The arms look up the app's own keys, so they close over the app's `t` rather than being
   * handed one — this module has no names for that copy and no business typing it.
   *
   * Annotate your object `Partial<Record<YourErrorCode, ErrorArm>>` where you write it, and a
   * code that does not exist is a compile error at the arm rather than a branch that never runs.
   */
  codes?: Partial<Record<string, ErrorArm>>;
}

export type ErrorArm = (ctx: ErrorContext) => DescribedError;

/** Build the describer. */
export function createErrorDescriber<
  Prefix extends string,
  ServerPrefix extends string,
  ServerName extends string,
>({
  t,
  copyPrefix,
  messageKeyPrefix,
  knownMessageKeys,
  codes = {},
}: ErrorDescriberOptions<Prefix, ServerPrefix, ServerName>): (error: unknown) => DescribedError {
  const known = new Set<string>(Object.keys(knownMessageKeys));

  // Sound, and the reason nothing here needs a cast: the set was built from the keys of
  // `knownMessageKeys`, so membership really does establish the claim. `Object.keys` and not
  // `in`, which would have accepted "toString".
  const has = (name: string): name is ServerName => known.has(name);

  function serverSentence(error: ApiError): string | null {
    const lookup = (named: string | undefined): string | null => {
      if (named === undefined || !named.startsWith(messageKeyPrefix)) return null;
      const name = named.slice(messageKeyPrefix.length);
      return has(name) ? t(`${messageKeyPrefix}${name}`, error.params) : null;
    };
    // `messageKey` first: an API that sends both means the key, and the code is what the UI
    // switches on. The code is only consulted when there is no key to prefer, and it is spelled
    // under the same prefix so the gate is identical.
    return (
      lookup(error.messageKey) ??
      (error.code === undefined ? null : lookup(`${messageKeyPrefix}${error.code}`))
    );
  }

  return function describeError(error: unknown): DescribedError {
    if (!(error instanceof ApiError)) {
      // Not a response at all — the request never landed. Almost always the network, and almost
      // never worth showing a stack trace for.
      return { cause: t(`${copyPrefix}network`), hint: t(`${copyPrefix}networkHint`) };
    }

    const waitSecs = retryAfterSecs(error);
    const ctx: ErrorContext = {
      error,
      says: serverSentence(error),
      wait: waitSecs === null ? null : humanizeWait(t, waitSecs, copyPrefix),
      waitSecs,
    };

    const arm = error.code === undefined ? undefined : codes[error.code];
    if (arm) return arm(ctx);

    // Anything unmapped: the server's own sentence is still the most specific thing we have,
    // and support can act on it. A 5xx additionally gets "try again shortly", because that one
    // genuinely does clear on its own — a 4xx does not, and saying so would be a lie that costs
    // the reader another attempt.
    //
    // No `code` means no envelope, and then `message` is not the server's: it is the client's
    // own `Request failed (502)`, written for a log. A gateway answering with HTML while the API
    // restarts is exactly when that happens, so it reached screens — until the second migration,
    // whose three apps each guarded against that one string by hand.
    const serverWords = error.code === undefined ? "" : error.message;
    return {
      cause: ctx.says ?? (serverWords || t(`${copyPrefix}unexpected`)),
      hint: error.status >= 500 ? t(`${copyPrefix}retrySoon`) : undefined,
    };
  };
}
