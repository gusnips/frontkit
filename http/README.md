# @gusnips/http

The two shapes your API answers with, written down once as types. No dependencies, and nothing
tied to a framework or a platform — your server, your browser client and your SDK all compile
this same file.

```bash
bun add @gusnips/http
```

```ts
import type { ApiSuccess } from "@gusnips/http";

type Me = ApiSuccess<{ id: string; name: string }>;
// → { data: { id: string; name: string }; meta?: PaginationMeta }
```

## The envelope

Every route answers one of two things, and never anything else:

```jsonc
// 2xx
{ "data": { "id": "u_1" }, "meta": { "total": 40, "limit": 20, "offset": 0, "hasMore": true } }

// anything else
{ "error": { "code": "NOT_FOUND", "message": "No such user" } }
```

Which means unwrapping and error-shaping happen in one place instead of in every hook.

## The error half has four fields, and each does a different job

```ts
{
  code: "RATE_LIMITED",              // what your code switches on. Stable, machine-facing.
  message: "Too many requests",      // English, for logs and curl. Never your primary copy.
  messageKey: "errors.rateLimited",  // names the SENTENCE, so the client localizes it
  params: { limit: 100 },            // fills that sentence's blanks
  details: { resetAt: "2026-01-01T00:00:00Z" }  // what makes the refusal actionable
}
```

The split that matters is `message` versus `messageKey`. The server owns the _condition_; the
client owns the _prose_. That is what lets an API refuse something without knowing what language
the person reads, and `details` is what lets the client offer a way forward instead of a dead
end.

When a request fails validation, `details` is a `ValidationIssue[]`:

```ts
[{ path: ["items", 0, "qty"], code: "too_big", maximum: 200 }];
```

The field, the rule, and the bound, so a form can say "at most 200" next to the right input. Never
the value that was sent, the validator's own sentence, or the list of allowed values.

## The codes are yours

Everything is generic over your own code union. Two codebases this came from had 30 codes and 16
codes, overlapping on nine — a code list is an API's vocabulary and belongs to it.

```ts
import { asErrorCode, isApiError, type ApiError } from "@gusnips/http";

type Code = "NOT_FOUND" | "RATE_LIMITED" | "UNKNOWN";
const CODES = ["NOT_FOUND", "RATE_LIMITED", "UNKNOWN"] as const;

if (isApiError<Code>(body)) {
  switch (asErrorCode(CODES, body.error.code, "UNKNOWN")) {
    case "RATE_LIMITED": /* … */
  }
}
```

`asErrorCode` exists for one reason: **a code you do not recognise means the server is newer than
the tab.** A deploy landed ahead of the bundle someone is still running. That is not a parse
failure and must not throw, so it falls back instead.

## Status codes

Write the map at the call site and let `satisfies` do the work:

```ts
export const ERROR_STATUS = {
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
} as const satisfies Record<Code, number>;
```

That one line is the point: adding a code to the union without giving it a status becomes a build
error, instead of a route answering 500 for a refusal it knew how to explain.

MIT · part of [frontkit](https://github.com/gusnips/frontkit)
