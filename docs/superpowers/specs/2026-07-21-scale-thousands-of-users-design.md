# Scaling the Mneme backend to thousands of users

Date: 2026-07-21
Status: approved, ready for implementation

## Problem

The backend is a single always-on Render `starter` instance (0.5 CPU / 512MB) fronting
Neon Postgres. It serves a mobile client. Today it works, but several properties only
hold because user count is small:

1. **`handleRoute` leaks internals.** `src/lib/api.ts` returns `error.message` verbatim
   on any unhandled 500 — Prisma messages, upstream URLs, filesystem paths.
2. **The rate limiter leaks memory.** `enforceRateLimit` (`src/server/services/usage.ts`)
   keeps a module-level `Map` keyed `route:userId` that is never swept. Entries are pruned
   only when that same key is hit again, so the map grows with total distinct users forever.
3. **Only 2 of 54 routes are rate limited** — `captures POST` and `companion/reply`.
4. **The auth routes have no limiting at all**, and `bcrypt` cost 12 is ~250ms of *blocking*
   CPU per attempt. On 0.5 CPU, a few dozen concurrent `POST /api/auth/token` requests
   saturate the event loop and degrade every other user. This is a denial-of-service vector
   as much as a credential-stuffing one.
5. **Body size is checked after buffering.** `request.json()` reads the entire body before
   Zod's `.max()` rejects it. A large POST to `/api/captures/upload` is an OOM vector.
6. **No admission control on LLM work.** A burst of captures queues unbounded async work
   against one event loop and one OpenAI quota.
7. **One DB round-trip per authenticated request** in `getRequestUserId`.
8. **No security headers**; RevenueCat webhook uses non-constant-time secret comparison.

## Non-goals

- Rewriting the capture pipeline to be asynchronous. Capture returns the fully enriched
  item and mobile renders it directly; changing that contract is the single most likely way
  to break working functionality. Explicitly out of scope.
- Per-user node-count scaling (the `embedding`-column work). That is the *next* piece of
  work and is tracked separately.
- Changing the Render plan. That is a billing decision; this spec only makes multi-instance
  operation *correct*, and recommends the change.

## Design principle

Every change is either a **guard placed in front of existing code** or a **fix inside an
existing helper**. No service rewrites. No changed response shapes. No mobile changes.
The regression gate is that `npm run test:unit` and `npm run test:integration` pass
unchanged, plus new tests for each new unit.

---

## §1 — Error boundary and request correlation

`src/lib/api.ts`.

- `AppError` and `ZodError` branches are **unchanged, byte for byte**. Mobile matches on
  those codes and displays those messages.
- The unhandled branch returns a fixed generic message and a `requestId` (a short random
  token) in the error body, and logs the real error server-side as one structured JSON line
  including that `requestId`, following the existing convention
  (`console.log(JSON.stringify({ event: ... }))` — see `src/server/transcribe.ts:133`).

Rationale: an operator can still trace any 500 to its stack trace via the id the user
reports, without the client ever seeing internals.

## §2 — Rate limiting

New module `src/server/services/ratelimit.ts`. The existing `enforceRateLimit` moves here
out of `usage.ts` — `usage.ts` is about monetization caps, a different concern, and the two
have no shared state. The two existing call sites are updated to the new import.

Two backends behind one shape:

### In-memory sliding window (high-volume, per-user routes)

Same semantics as the current implementation, with two fixes:

- Key generalized from `userId` to an arbitrary string, so IP-keyed use is possible.
- **Bounded**: a periodic sweep drops windows whose newest hit is older than the window,
  and a hard cap on map size evicts the oldest-touched keys if the sweep can't keep up.
  This is the fix for the unbounded growth described above.

### Durable fixed-window counters (auth routes)

A new Prisma model storing `(key, window, count)` with the window as a truncated timestamp
bucket. Used only on the low-volume security-critical paths, so the extra write per attempt
is irrelevant. Survives restarts and holds correctly across multiple instances.

Expired rows are deleted opportunistically on write, so no external cleanup job is needed.

### Shared behavior

- 429 responses carry a `Retry-After` header.
- The existing `RATE_LIMIT` error code and user-facing copy are preserved exactly.
- `clientIp(request)` reads `x-forwarded-for` as Render sets it (leftmost entry is the
  client), falling back to `x-real-ip`. Never trusts a client-supplied header when no proxy
  header is present.

### Coverage

Limits are sized so ordinary use never reaches them; they are abuse ceilings, not quotas.
The monetization caps in `usage.ts` remain the user-visible limits and are untouched.

Applied to the expensive/abusable routes: capture (existing), companion reply (existing),
upload, avatar, transcribe, preflight, search, terrain, intelligence, trends, graph,
compare, socratic reply, content ingest, notifications send, and the social write routes.

## §3 — Auth hardening

- Durable limits on `POST /api/auth/register` and `POST /api/auth/token`, keyed by **both**
  client IP and submitted identifier. The identifier key stops one account being targeted
  from many IPs; the IP key stops one host spraying many accounts. This is also what
  contains the bcrypt CPU-DoS.
- Failed-login responses keep the existing generic `INVALID_CREDENTIALS` message — no
  change, it is already non-enumerating.
- RevenueCat webhook: constant-time comparison of the shared secret.

## §3b — Server-side request forgery (found during implementation)

`POST /api/content/ingest` was **unauthenticated** and made the server fetch a URL of
the caller's choosing. `z.string().url()` validates syntax, not destination, so
`http://169.254.169.254/` (cloud metadata) and `http://127.0.0.1:5432/` were both accepted.
This is also an open scraping proxy that spends our Supadata credits.

Two fixes:

- The route now requires a signed-in user and is rate limited. The mobile client has always
  sent its token here, so this is not a client-visible change.
- New `src/server/ssrf.ts`: `assertPublicHttpUrl` enforces an http(s) allow-list, rejects
  private/loopback/link-local IP literals, and **resolves the hostname** and rejects if any
  resolved address is private — checking hostname text alone is defeated by an
  attacker-controlled domain with an A record pointing inside our network. Applied at the
  top of `ingestUrl`, the single point where a user-supplied URL becomes a fetch.

Residual risk, accepted and recorded: a *public* host that HTTP-redirects to a private
address is still followed, because `fetch` resolves redirects internally. Closing that means
`redirect: "manual"` and a re-check per hop, which changes fetch behaviour for every
legitimate site that redirects — too much risk for this pass.

`/api/search` stays unauthenticated (it backs public discovery) and is rate limited by
source address instead.

## §4 — Body-size admission

`assertBodyWithinLimit(request, maxBytes)` in `src/lib/api.ts`, checking `Content-Length`
**before** `parseJson`. Applied to `captures/upload`, `captures/transcribe`, and
`profile/avatar`. Existing Zod `.max()` caps stay as the second line of defence for the
case where `Content-Length` is absent.

## §5 — Concurrency admission control

New `src/server/services/admission.ts`: a counting semaphore with a bounded wait.

- Wraps the LLM-heavy work: capture, transcribe, companion reply, vision describe.
- When all slots are busy, a caller waits up to a short timeout, then fails with 503 +
  `Retry-After` rather than queueing unbounded.
- Slot counts are sized above expected steady-state concurrency, so normal traffic never
  blocks. The purpose is to convert "everyone's request stalls" into "a few requests get a
  clean retryable error".

## §6 — Per-request auth cost

`getRequestUserId` (`src/lib/auth.ts`) currently issues a `user.findUnique` on every
authenticated request to prove the account still exists.

Add a bounded LRU with a 60s TTL, **plus explicit invalidation in `deleteAccount`**
(`src/server/services/accounts.ts`). Because the only in-app path that deletes a user
invalidates the entry directly, the guarantee described in the comment at `src/lib/auth.ts`
is preserved for the real case. The 60s window applies only to out-of-band deletion
(manual DB surgery, a database reset) — which is exactly the case the original comment
mentions, and where a 60s stale window is harmless.

## §7 — Security headers and multi-instance readiness

`next.config.mjs` gains `headers()`: `Strict-Transport-Security`,
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`. No CSP —
the service is a JSON API with no rendered UI surface worth constraining.

Multi-instance audit: confirm the only remaining process-local state is the in-memory rate
limiter (acceptable — the security-critical counters are durable) and the Prisma singleton
(correct as-is). `render.yaml` gets a comment recording the recommended scaling step; the
plan value is not changed.

---

## Testing

New unit tests, colocated per existing convention (`src/server/**/*.test.ts`):

- **ratelimit**: window boundary behavior, that a key over the limit throws, that the sweep
  actually evicts, that the map stays bounded under many distinct keys, durable counter
  increments and expiry.
- **clientIp**: proxy header parsing, absent-header fallback, no trust of client-supplied
  values.
- **admission**: slots are released on both success and throw, saturation produces the
  retryable error rather than hanging.
- **api**: unhandled errors are redacted and carry a requestId; `AppError` and `ZodError`
  responses are unchanged.
- **auth cache**: hit/miss/TTL behavior, and that deletion invalidates.

Regression gate: `npm run test:unit` (193 tests green at baseline) and
`npm run test:integration` both pass.

## Deployment

`RateLimitCounter` is a new model, so **`npm run db:push` must run against production before
(or with) the deploy**. The durable limiter fails open if the table is missing, so deploying
the code first degrades to "auth routes unlimited" rather than erroring — but that is the
window the limiter exists to close, so keep it short.

## Rollout risk

The highest-risk item is §2's coverage expansion: a limit set too low would surface to users
as spurious 429s. Mitigation is that every limit is set well above realistic use, and the
two pre-existing limits keep their current values exactly.

§6 is the only change that trades a (small, bounded, mitigated) correctness property for
performance, and is documented above.
