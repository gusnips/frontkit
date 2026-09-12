import { ApiError, retryAfterSecs } from "./api-error.ts";
import { shouldRetry } from "./query.ts";

/**
 * Turning anything thrown into copy a person can act on.
 *
 * The API already answers with a message written for a developer, a stable `messageKey` for the
 * domain refusals, and `details` carrying the parts that make a refusal actionable. This is the
 * one place that decides what the SCREEN says — which is not always the same sentence.
 * "Monthly quota spent, upgrade or buy a pack" is right in a JSON body and wrong under a button
 * that could just say what to do next.
 *
 * `cause` is what happened. `fix` is what to do about it. **A surface that shows only the first
 * half is the dead end this exists to prevent** — which is why the type has two fields and not
 * one, and why `fix` being absent should be a deliberate choice at each call site rather than
 * the default nobody noticed.
 *
 * `fix`, and not the `hint` this returned until 0.6.0. `ErrorStateProps` — the contract this same
 * package ships for the component that renders this — has always called it `fix`, so every
 * adopter wrote `fix={hint}` at every error surface: a rename adapter, which is the shape of an
 * API we got wrong. It also clears a collision, because in at least one adopter a form field's
 * `hint` is the requirement text under the input, which is a different thing entirely.
 *
 * The per-code switch stays in the product: two donors' switches shared their SHAPE and almost
 * no arms, because the arms are that API's vocabulary. What ships is the scaffolding around it,
 * which is the part that was written twice and got subtly different both times.
 */

/**
 * Which control to offer beside the words.
 *
 * The fourth adopter had this and the package did not, which left every adopter re-deriving
 * "can a second attempt fix this" from its own switch — beside a `shouldRetry` already deciding
 * exactly that for react-query. Two answers to one question drift, and the drift is visible: a
 * screen offering "try again" for a refusal the query layer refuses to retry, so the button does
 * nothing and the reader presses it twice.
 *
 * So this is DERIVED from `shouldRetry`, not switched on separately. One rule, two consumers.
 */
export type RecoveryKind =
  /** A second attempt can work. Offer the button. */
  | "retry"
  /** Auth said no. Offer a way back to sign-in, never a retry. */
  | "signin"
  /** It stated its own expiry. Offer the button, disabled, with the countdown. */
  | "wait"
  /** Waiting cannot fix it and neither can pressing anything. Offer no control. */
  | "none";

/** The copy an arm writes. Everything it leaves out, {@link createErrorDescriber} fills in. */
export interface ErrorCopy {
  /** What happened, in the reader's words. */
  cause: string;
  /** What to do about it. Its absence should be a decision, not an oversight. */
  fix?: string;
  /** Override the derived kind — a 429 whose code means a spent quota is `"none"`, not `"wait"`. */
  recover?: RecoveryKind;
  /** Override the request id. Rarely wanted; the envelope's is used by default. */
  reference?: string;
}

export interface DescribedError extends ErrorCopy {
  /** Always present on the way out, whether an arm set it or the rule derived it. */
  recover: RecoveryKind;
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

/**
 * Every name {@link createErrorDescriber} looks up itself. Your catalog carries all of them.
 *
 * The three wait names are deliberately NOT here, which is the other half of 0.6.0. This module
 * used to humanize a stated wait itself, so `waitSeconds`/`waitMinutes`/`waitHours` — each with
 * an ICU plural — landed in the key union of every adopter's `t` whether or not a wait was ever
 * rendered. An app that formats waits with `Intl.RelativeTimeFormat` needs none of them and was
 * left adding six entries per language to satisfy a compiler. `formatWait` owns that now.
 */
type CopyName = "network" | "networkHint" | "unexpected" | "retrySoon";

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
 *
 * This is what you pass as `formatWait` when your catalog carries those three:
 * `formatWait: (secs) => humanizeWait(t, secs, "errors.")`. An app that formats a wait with
 * `Intl.RelativeTimeFormat` passes its own one-liner instead and needs no wait keys at all —
 * which also gets it correct plurals in languages with more than two forms, for free.
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
  /**
   * What the rule decided before this arm ran. Read it to agree, return your own to override.
   *
   * Exposed so an arm can narrow rather than restate: a quota arm that already knows the limit is
   * durable returns `"none"`, and every other arm can leave it alone and stay right by default.
   */
  recover: RecoveryKind;
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
   * How a stated wait becomes words, for the `wait` an arm reads off its context.
   *
   * Required rather than defaulted, because there is no answer that is right for everyone and a
   * default hid the cost: {@link humanizeWait} reads three ICU plural keys out of your catalog,
   * and an app that already formats relative time with `Intl` would have had to add them to
   * compile. Say which you want — `(secs) => humanizeWait(t, secs, "errors.")`, or your own
   * `(secs) => formatIn(secs, locale)` — and the catalog you need is the one you can see.
   */
  formatWait: (secs: number) => string;
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
   * Transform `params` before they fill the server's sentence.
   *
   * The envelope carries what the SERVER knows, which is not always a word anyone should read: a
   * role id (`admin`), an action verb (`approve_content`). The sentence needs whatever the app's
   * own screens call those things, and the substitution happens here — inside the one lookup that
   * reads `params` — so there is nowhere else an adopter could intervene. Without this seam the
   * choice is to ship the raw id into `{{role}}`, or to stop using the server's sentence at all
   * and re-resolve every key by hand, which is how i18n ended up inside a transport once already.
   *
   * Optional, and identity by default: an API whose params are already words passes nothing. It
   * deliberately takes only the params — an arm that needs the error has `ctx` for that.
   */
  localizeParams?: (
    params: Record<string, string | number> | undefined,
  ) => Record<string, unknown> | undefined;
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
  /**
   * The codes that mean "this limit does not clear by waiting" — **the same list you hand
   * `queryDefaults`**, because it answers the same question and a second copy is a second
   * chance to disagree with the retry rule. Declare it once in the app and pass it twice.
   */
  durableLimitCodes?: readonly string[];
  /** Longest stated wait still worth a retry rather than a countdown. Matches `queryDefaults`. */
  maxRetryWaitSecs?: number;
}

export type ErrorArm = (ctx: ErrorContext) => ErrorCopy;

/** Build the describer. */
export function createErrorDescriber<
  Prefix extends string,
  ServerPrefix extends string,
  ServerName extends string,
>({
  t,
  copyPrefix,
  formatWait,
  messageKeyPrefix,
  knownMessageKeys,
  localizeParams = (params) => params,
  codes = {},
  durableLimitCodes = [],
  maxRetryWaitSecs,
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
      return has(name) ? t(`${messageKeyPrefix}${name}`, localizeParams(error.params)) : null;
    };
    // `messageKey` first: an API that sends both means the key, and the code is what the UI
    // switches on. The code is only consulted when there is no key to prefer, and it is spelled
    // under the same prefix so the gate is identical.
    return (
      lookup(error.messageKey) ??
      (error.code === undefined ? null : lookup(`${messageKeyPrefix}${error.code}`))
    );
  }

  /**
   * Which control to offer, decided once and never switched on separately.
   *
   * Everything below the last line defers to `shouldRetry` — the rule invariant 8 already owns —
   * so the button a reader sees and the retry react-query performs cannot disagree.
   */
  function recoveryFor(error: ApiError, waitSecs: number | null): RecoveryKind {
    // The client raised this one itself, to stop a caller while a dead session was already being
    // handled. Nothing is broken and the person is already on their way to sign-in, so asking
    // them to try again would be the surface contradicting the thing it is reporting.
    if (error.expected) return "none";
    // 401 is "we do not know who you are", which no number of attempts answers. 403 is NOT this:
    // the session is fine and it is a different account that would help, so it falls through.
    if (error.status === 401) return "signin";
    // It named its own expiry, so there is a real number to count down beside a disabled button.
    if (waitSecs !== null) return "wait";
    return shouldRetry(error, durableLimitCodes, maxRetryWaitSecs) ? "retry" : "none";
  }

  return function describeError(error: unknown): DescribedError {
    if (!(error instanceof ApiError)) {
      // Not a response at all — the request never landed. Almost always the network, and almost
      // never worth showing a stack trace for. `shouldRetry` answers a non-response the same way,
      // so these two agree here without either being told about the other.
      return {
        cause: t(`${copyPrefix}network`),
        // The catalog KEY keeps its name while the field becomes `fix`: renaming it would cost
        // every adopter a JSON edit in every language, for a string no caller ever types.
        fix: t(`${copyPrefix}networkHint`),
        recover: "retry",
      };
    }

    const waitSecs = retryAfterSecs(error);
    const ctx: ErrorContext = {
      error,
      says: serverSentence(error),
      wait: waitSecs === null ? null : formatWait(waitSecs),
      waitSecs,
      recover: recoveryFor(error, waitSecs),
    };

    // Anything unmapped: the server's own sentence is still the most specific thing we have,
    // and support can act on it. A 5xx additionally gets "try again shortly", because that one
    // genuinely does clear on its own — a 4xx does not, and saying so would be a lie that costs
    // the reader another attempt.
    //
    // No `code` means no envelope, and then `message` is not the server's: it is the client's
    // own `Request failed (502)`, written for a log. A gateway answering with HTML while the API
    // restarts is exactly when that happens, so it reached screens — until the second migration,
    // whose three apps each guarded against that one string by hand.
    const arm = error.code === undefined ? undefined : codes[error.code];
    const copy: ErrorCopy = arm
      ? arm(ctx)
      : {
          cause:
            ctx.says ??
            ((error.code === undefined ? "" : error.message) || t(`${copyPrefix}unexpected`)),
          fix: error.status >= 500 ? t(`${copyPrefix}retrySoon`) : undefined,
        };

    // The arm wins where it spoke, the rule fills the rest. `requestId` is the one thing every
    // error surface asks for and nothing was producing — `ErrorStateProps` has reserved a
    // `reference` slot for it since the contract was written.
    const reference = copy.reference ?? error.requestId;
    return {
      ...copy,
      recover: copy.recover ?? ctx.recover,
      ...(reference !== undefined && { reference }),
    };
  };
}
