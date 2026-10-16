import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

/**
 * The two pages behind an agent's sign-in: the consent page, where Claude or ChatGPT sends a
 * person to connect, and the device page, where a script's short code is typed and approved.
 * `@gusnips/server/oauth` is the server half. Logic only: the pages are the product's.
 *
 * Each hook takes your two API calls, so your client, your session and your envelope stay yours,
 * and returns one state to draw. What they settle once:
 *
 * - A refusal (an unknown app, a return address it never registered) is a STATE, never a
 *   redirect: sending the browser anywhere on a bad request is how an open redirect is built.
 * - Approve stays busy from the press until the browser has left. The page is going away, so the
 *   button must never come back and invite a second press.
 * - A device code is read however it is typed (`wdjb mjht`, `WDJB-MJHT`), and once decided the
 *   page stays decided. Asked again, the server no longer knows the code, and a page that asked on
 *   the next focus would tell someone who just approved that their code is wrong.
 */

export type OAuthRefusalReason =
  "unknown-client" | "redirect-mismatch" | "invalid-request" | "wrong-resource" | "unknown-code";

/** What the server sends instead of a view. Word your own page for `reason`. */
export interface OAuthRefusal {
  ok: false;
  reason: OAuthRefusalReason;
  /** An English fallback a person can read. */
  message: string;
}

export interface ConsentView {
  ok: true;
  /** What the app calls itself. Anyone may pick any name, so show `redirectHost` beside it. */
  clientName: string;
  /** Where the browser goes after the yes: a host, or an app's own scheme (`cursor:`). */
  redirectHost: string;
  /** The key's name on your keys page. */
  keyName: string;
  /** Where "Cancel" goes: back to the app, which is told the person said no. */
  cancelUrl: string;
}

export interface DeviceView {
  ok: true;
  clientName: string;
  /** As the script printed it: `WDJB-MJHT`. */
  userCode: string;
  keyName: string;
  /** ISO time: JSON carries the server's `Date` as a string. */
  expiresAt: string;
}

export interface ConsentApi<Choice> {
  /** Your API's call to the server's `describe`, with the query string as it came. */
  describe(query: string): Promise<ConsentView | OAuthRefusal>;
  /** Your API's call to `approve`. `choice` is anything your page adds, such as a workspace. */
  approve(query: string, choice: Choice): Promise<{ ok: true; redirectTo: string } | OAuthRefusal>;
}

export type ConsentState =
  | { status: "loading" }
  /** Show `refusal` and a way home. Never a link back to the app. */
  | { status: "refused"; refusal: OAuthRefusal }
  /** The request failed to arrive or answer. Show what failed, and `retry`. */
  | { status: "failed"; error: unknown; retry: () => void }
  | { status: "ready"; view: ConsentView };

export interface ConsentRequest<Choice> {
  state: ConsentState;
  approve(choice: Choice): void;
  /** From the press until the browser has left. Keep the button busy the whole time. */
  leaving: boolean;
  /** Approve did not answer. Show it beside the button; pressing again retries. */
  approveError: unknown;
}

/**
 *     const consent = useConsentRequest(api.oauth, useLocation().search);
 *     if (consent.state.status === "ready") ... consent.approve(workspaceId)
 */
export function useConsentRequest<Choice = void>(
  api: ConsentApi<Choice>,
  search: string,
): ConsentRequest<Choice> {
  const query = search.replace(/^\?/, "");
  const request = useQuery({
    queryKey: ["@gusnips/react/oauth", "consent", query],
    queryFn: () => api.describe(query),
  });
  const approval = useMutation({
    mutationFn: (choice: Choice) => api.approve(query, choice),
    onSuccess: (answer) => {
      if (answer.ok) window.location.assign(answer.redirectTo);
    },
  });

  // A refusal from approve (the request went stale between the two calls) outranks the view.
  const answer = request.data;
  const refusal =
    approval.data?.ok === false ? approval.data : answer?.ok === false ? answer : null;
  let state: ConsentState;
  if (refusal) state = { status: "refused", refusal };
  else if (answer?.ok === true) state = { status: "ready", view: answer };
  else if (request.isError)
    state = { status: "failed", error: request.error, retry: () => void request.refetch() };
  else state = { status: "loading" };

  return {
    state,
    approve: (choice) => approval.mutate(choice),
    leaving: approval.isPending || approval.data?.ok === true,
    approveError: approval.error,
  };
}

export interface DeviceApi {
  /** Your API's call to the server's `describeDevice`. */
  describe(code: string): Promise<DeviceView | OAuthRefusal>;
  /** Your API's call to `decideDevice`. */
  decide(code: string, decision: "approve" | "deny"): Promise<{ ok: true } | OAuthRefusal>;
}

export type DeviceState =
  /** Fewer than 8 letters so far, or one a code never uses (see `invalidLetter`). */
  | { status: "typing" }
  | { status: "loading" }
  /** Unknown, expired or already decided: ask them to start again from the app. */
  | { status: "refused"; refusal: OAuthRefusal }
  | { status: "failed"; error: unknown; retry: () => void }
  /**
   * Show `view.userCode` and say: go on only if you started this sign-in yourself, just now, and
   * this is the code on your screen. Somebody can run the real script and send a stranger the
   * link, and that sentence is the only guard against it (RFC 8628 §5.4).
   */
  | { status: "ready"; view: DeviceView }
  /** Done. Tell them to go back to the app, which carries on by itself. */
  | { status: "approved" }
  | { status: "denied" };

export interface DeviceApproval {
  state: DeviceState;
  /** What the field shows, formatted as they type: `WDJB-MJ`. */
  code: string;
  setCode(input: string): void;
  /** A typed letter no code uses: a vowel. Say so now, not after eight letters. */
  invalidLetter: boolean;
  approve(): void;
  deny(): void;
  deciding: boolean;
  /** The decision did not answer. Show it beside the buttons; pressing again retries. */
  decideError: unknown;
}

/** The server's alphabet: no vowels, so a code never spells a word. */
const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const LENGTH = 8;

/** Upper case, letters only, at most 8, with the dash after the fourth: what the field shows. */
export function formatUserCode(input: string): string {
  const letters = input
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, LENGTH);
  return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}

/**
 *     const device = useDeviceApproval(api.device, useLocation().search);
 *     <input value={device.code} onChange={(e) => device.setCode(e.target.value)} />
 *
 * The link the script prints carries `?code=`, so the field usually starts full.
 */
export function useDeviceApproval(api: DeviceApi, search: string): DeviceApproval {
  const [code, setTyped] = useState(() =>
    formatUserCode(new URLSearchParams(search).get("code") ?? ""),
  );
  const letters = code.replace("-", "");
  const invalidLetter = [...letters].some((letter) => !ALPHABET.includes(letter));
  const complete = letters.length === LENGTH && !invalidLetter;

  const decision = useMutation({
    mutationFn: (choice: "approve" | "deny") => api.decide(letters, choice),
  });
  const decided = decision.data?.ok === true ? decision.variables : undefined;
  const request = useQuery({
    queryKey: ["@gusnips/react/oauth", "device", letters],
    queryFn: () => api.describe(letters),
    enabled: complete && decided === undefined,
  });

  const answer = request.data;
  const refusal =
    decision.data?.ok === false ? decision.data : answer?.ok === false ? answer : null;
  let state: DeviceState;
  if (decided !== undefined) state = { status: decided === "approve" ? "approved" : "denied" };
  else if (!complete) state = { status: "typing" };
  else if (refusal) state = { status: "refused", refusal };
  else if (answer?.ok === true) state = { status: "ready", view: answer };
  else if (request.isError)
    state = { status: "failed", error: request.error, retry: () => void request.refetch() };
  else state = { status: "loading" };

  return {
    state,
    code,
    setCode: (input) => {
      decision.reset();
      setTyped(formatUserCode(input));
    },
    invalidLetter,
    approve: () => decision.mutate("approve"),
    deny: () => decision.mutate("deny"),
    deciding: decision.isPending,
    decideError: decision.error,
  };
}
