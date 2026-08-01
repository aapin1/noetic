# Mobile product analytics + crash reporting

**Date:** 2026-07-31
**Branch:** `analytics-and-crash-reporting` (worktree at `../mneme-analytics`)
**Status:** approved, implementing

## Problem

Mneme emits no telemetry. There is no product analytics vendor and no crash
reporting. Every product decision — which tab earns return visits, where
onboarding sheds people, whether captures are failing, whether a crash is
quietly eating sessions — is currently a guess, and every roadmap item that
depends on those answers is unfalsifiable.

## Goal

Two numbers, computable from the emitted events:

1. **Weekly captures per active user** — `count(capture_succeeded)` in a week
   divided by distinct identified users with any event that week.
2. **Activation: 5 captures in the first 7 days** — requires a per-user anchor
   date, which event counts alone cannot supply. Solved with a `signup_date`
   person property (see "Identity").

Everything else in this spec exists to serve those two numbers plus the funnel
that explains them.

## Vendor selection

**PostHog** for product analytics, **Sentry** for crashes.

PostHog is a YC company (W20) and runs a startup program worth $50K of credit
for 12 months (eligibility: under 2 years old, under $5M raised). Sentry runs a
separate startup program worth up to $5K on the same eligibility test. Neither
appears in the $25K YC AI Student Starter Pack, which is cloud and model credits
(AWS $10K, Azure $10K, OpenAI $1K, Anthropic $500) plus ~14 YC AI-infra tools;
its only observability entry is Langfuse, which is LLM tracing, not product
analytics. Sentry's richer YC deal routes through Bookface and requires being
YC-funded, which Startup School does not confer.

Both programs are applications with approval lag, so the implementation targets
the free tiers (PostHog 1M events/month, Sentry 5K errors/month). Credits change
nothing in the code when they land.

PostHog also ships error tracking, which would consolidate to one vendor, but
its React Native implementation catches JavaScript exceptions only. Sentry
catches native iOS crashes, symbolicates via source maps, and binds a crash to a
release and build number — which is what "a crash eating sessions" actually
requires. Both SDKs stay, hidden behind one wrapper.

## Architecture

### The wrapper

`mobile/lib/analytics.ts` is the only module in the app that imports
`posthog-react-native` or `@sentry/react-native`.

```ts
initAnalytics(): void                                  // once, from _layout.tsx
track(event: AnalyticsEvent, props?): void             // fire-and-forget
identifyUser(userId: string, props: PersonProps): void
resetIdentity(): void                                  // on sign-out
captureError(error: unknown, context?): void
```

Event names are a TypeScript union declared alongside `track`, so a typo is a
compile error and the entire schema is legible in one screen. Swapping PostHog
for another vendor is a rewrite of this one file; no call site changes.

Both SDKs are native modules. Following the established pattern in
`lib/purchases.ts` and `components/ui/SponsoredCard.tsx`, each is loaded through
`require` inside a try/catch and degrades to a no-op when absent, so a dev client
built before this landed still boots.

### Failure containment

`track()` is synchronous, fire-and-forget, and internally try/catch'd. It never
returns a promise, is never awaited at a call site, and cannot reject. A dead
PostHog is indistinguishable from a healthy one from the caller's side. No
analytics failure can reach the UI.

### Cost and latency

- PostHog batches at `flushAt: 20`, `flushInterval: 30s`, with the queue
  persisted through AsyncStorage so a backgrounded app does not drop it.
- On the capture path, `capture_started` fires after the optimistic UI update,
  and `capture_succeeded` / `capture_failed` hang off the existing promise chain.
  The network call is never awaited on the analytics side. Capture latency
  (currently ~2.5s average) is unaffected.
- Sentry initializes early via `Sentry.wrap(RootLayout)` because it must be
  live to catch startup crashes. PostHog initializes after cache hydration so
  it never delays first paint.
- Both are inert unless their env key is present, so CI and unconfigured dev
  clients emit nothing.

## Event schema

Deliberately closed. A bloated schema is worse than none.

| Event | Properties |
|---|---|
| `session_start` | `is_first_session` |
| `signup` | `method: 'email'` |
| `onboarding_step` | `step: 'identity' \| 'notifications' \| 'walkthrough'`, `action: 'completed' \| 'skipped'` |
| `capture_started` | `kind`, `source: 'composer' \| 'share_extension'` |
| `capture_succeeded` | `kind`, `source`, `duration_ms` |
| `capture_failed` | `kind`, `source`, `duration_ms`, `reason` |
| `first_capture` | `kind`, `source`, `ms_since_signup` |
| `tab_view` | `tab` |
| `insight_opened` | `source: 'map' \| 'archive' \| 'mind' \| 'share' \| 'unknown'` |
| `companion_message` | `turn_index` |
| `paywall_view` | `source: 'settings' \| 'ad_card' \| 'unknown'` |
| `purchase` | `product_id`, `period` |

`kind` is re-exported from `types/api.ts` rather than redeclared, so it tracks
the API's union (`LINK | TEXT | QUOTE | IMAGE`) and client events join against
server data with no translation. A hand-copied duplicate had already drifted —
it omitted `QUOTE` — which would have surfaced as missing data rather than a
compile error.

`insight_opened.source` is threaded through the route as a `from` query param
and narrowed by `asInsightSource`, so a stale or hand-typed deep link cannot
invent a breakdown value. `unknown` is reachable by design: notification deep
links route through `NotificationContext`, which is under active development
elsewhere and deliberately untouched here.

Every event additionally carries `environment: 'dev' | 'prod'`, so the on-device
verification run is filterable rather than permanently polluting production
dashboards.

## Identity

`identifyUser` is called on sign-up and on every successful session restore. It
sets one person property that the activation metric cannot be computed without:

- **`signup_date`** — written at registration, and backfilled from
  `profile.createdAt` on first login for users who predate analytics.

Activation then reduces to a single PostHog cohort: users whose
`capture_succeeded` count reaches 5 within 7 days of `signup_date`.

`resetIdentity()` is called on sign-out so the next account on the device does
not inherit the previous person.

## Consent

Analytics is **not** gated on App Tracking Transparency, and no second consent
prompt is added.

ATT governs the IDFA and cross-app tracking. First-party product analytics uses
neither; PostHog's React Native SDK collects no advertising identifier and the
option stays off. The existing ATT prompt in `components/ui/SponsoredCard.tsx`
remains owned by the ads path and fires unchanged.

Consequence to action outside the codebase: the App Store privacy questionnaire
must declare "Analytics" as a data use. Data for advertising is already
declared, so this is an edit to an existing disclosure rather than a new
category.

## Files touched

New:
- `mobile/lib/analytics.ts`

Modified:
- `mobile/app/_layout.tsx` — init, `Sentry.wrap`
- `mobile/contexts/AuthContext.tsx` — identify / reset
- `mobile/app/(auth)/sign-up.tsx` — `signup`
- `mobile/app/(onboarding)/{identity,notifications,walkthrough}.tsx` — steps
- `mobile/app/(tabs)/_layout.tsx` — `tab_view`
- `mobile/app/(tabs)/index.tsx` — composer capture events
- `mobile/app/shareintent.tsx` — share-extension capture events
- `mobile/app/insight/[id].tsx` — `insight_opened`
- `mobile/app/companion/index.tsx` — `companion_message`
- `mobile/components/ui/ErrorBoundary.tsx` — reports caught render errors
- `mobile/app/(tabs)/{mind,memory}.tsx`, `mobile/components/archive/{DiaryList,FileList}.tsx`,
  `mobile/components/ui/SponsoredCard.tsx` — `from` params on navigation only
- `mobile/app/plus.tsx` — `paywall_view`, `purchase`
- `mobile/app/settings.tsx` — `__DEV__`-only crash trigger
- `mobile/app.json`, `mobile/package.json`, `mobile/.env.example`

Dependencies added: `posthog-react-native`, `@sentry/react-native`, and
PostHog's peers `expo-application`, `expo-device`, `expo-localization`.

Explicitly **not** touched: anything under `src/`, `prisma/`, or
`notifications/`; and `mobile/lib/api.ts` / `mobile/types/api.ts`. Capture
duration is timed at the call site, not in the API layer, specifically to keep
those two files clean.

## Conflict containment

Concurrent work on the notifications and API surface is in progress on `main`
with a dirty working tree. This work happens in a separate worktree on its own
branch, so that tree is untouched.

Exactly one file overlaps: `mobile/app/(tabs)/index.tsx`. The edit there is an
import plus three `track()` calls in the capture handler — small enough to
resolve by hand. `mobile/lib/api.ts` and `mobile/types/api.ts` are modified on
`main` and are not touched here at all.

## Verification

A cold start on a physical device must produce, in order, in PostHog Live
Events: `session_start`, `signup`, three `onboarding_step` events,
`first_capture` with `capture_succeeded`, `tab_view` for each tab visited,
`insight_opened`, `paywall_view`. A deliberate crash from the `__DEV__`-only
trigger in settings must appear in Sentry with a symbolicated stack trace.

The Sentry Expo config plugin changes native configuration, so a native rebuild
is required before this run — Expo Go and any previously built dev client will
not carry it.

Static checks that did run: `tsc --noEmit` passes clean, and `expo lint` reports
151 problems both before and after the change (identical to the untouched
baseline), so nothing here adds a finding.

Outstanding before the device run, all outside the codebase:

1. Create the PostHog and Sentry projects; put `EXPO_PUBLIC_POSTHOG_KEY` and
   `EXPO_PUBLIC_SENTRY_DSN` in `mobile/.env.local` and in EAS build secrets.
2. Add `organization` and `project` to the `@sentry/react-native` entry in
   `app.json`, plus `SENTRY_AUTH_TOKEN` as an EAS secret. Left unset here on
   purpose: guessed slugs fail the build loudly. Without them crashes still
   report, but stacks are unsymbolicated.
3. Apply to both startup programs (PostHog $50K, Sentry $5K). Neither changes
   any code.
4. Declare "Analytics" as a data use in the App Store privacy questionnaire.
