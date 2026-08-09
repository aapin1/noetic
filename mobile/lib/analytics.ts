import AsyncStorage from '@react-native-async-storage/async-storage';

import type PostHogClient from 'posthog-react-native';
import type * as SentryModule from '@sentry/react-native';
import type { CaptureKind } from '@/types/api';

/**
 * The single seam between this app and its telemetry vendors.
 *
 * Nothing outside this file imports `posthog-react-native` or
 * `@sentry/react-native`. Call sites see `track`, `identifyUser`,
 * `resetIdentity` and `captureError` — swapping either vendor is a rewrite of
 * this module and nothing else.
 *
 * Three rules hold everywhere below:
 *
 *   1. Nothing here can throw into a caller. Every entry point is wrapped, and
 *      a failed analytics call is invisible to the user by construction.
 *   2. Nothing here blocks. `track` is synchronous and fire-and-forget; the
 *      SDK batches and flushes on its own schedule.
 *   3. Nothing here runs without a key. Absent env config the whole module is
 *      an inert no-op, so CI and unconfigured dev clients stay silent.
 */

const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** Stamped on every event so a device verification run can be filtered out of
 *  the production dashboards instead of permanently skewing them. */
const ENVIRONMENT: 'dev' | 'prod' = __DEV__ ? 'dev' : 'prod';

// Both SDKs are native modules. A dev client built before they were added
// throws on require — same defence as lib/purchases.ts and SponsoredCard.tsx.
// The app must stay bootable on an older binary.
type PostHogModule = typeof import('posthog-react-native');
let PostHog: PostHogModule['default'] | null = null;
try {
  PostHog = (require('posthog-react-native') as PostHogModule).default;
} catch {
  PostHog = null;
}

let Sentry: typeof SentryModule | null = null;
try {
  Sentry = require('@sentry/react-native') as typeof SentryModule;
} catch {
  Sentry = null;
}

/** Mirrors the ad path's `[ads]` convention: silent in production, traceable
 *  in dev, because "no events anywhere" is otherwise undiagnosable. */
const log = (...args: unknown[]) => {
  if (__DEV__) console.log('[analytics]', ...args);
};

// ---------------------------------------------------------------------------
// Event schema
// ---------------------------------------------------------------------------

/**
 * Re-exported, not redeclared. A second hand-maintained copy of this union
 * silently drifts from the API's — the first draft here omitted `QUOTE` — and
 * the drift shows up as a hole in the data, not a compile error.
 */
export type { CaptureKind } from '@/types/api';
/** Captures arrive from three places and the difference matters: the share
 *  extension and the first-session ritual are different funnels with
 *  different failure profiles. */
export type CaptureSource = 'composer' | 'share_extension' | 'ritual';
/** identity/notifications/walkthrough are the retired 2026-07 flow — kept so
 *  historical dashboards still parse. New accounts only emit `ritual`. */
export type OnboardingStep = 'identity' | 'notifications' | 'walkthrough' | 'ritual';
export type TabName = 'atlas' | 'mind' | 'archive' | 'pulse' | 'you';
/**
 * Where an insight was opened from. `unknown` is reachable and intentional:
 * notification deep links route through NotificationContext, which is under
 * active development elsewhere and deliberately untouched by this change.
 */
export type InsightSource = 'map' | 'archive' | 'mind' | 'share' | 'today' | 'unknown';

/** Narrows an untrusted route param to the enum, so a hand-typed or stale
 *  deep link can't invent a new breakdown value in the dashboard. */
export function asInsightSource(value: unknown): InsightSource {
  return value === 'map' || value === 'archive' || value === 'mind' || value === 'share' || value === 'today'
    ? value
    : 'unknown';
}

/**
 * The closed schema. A bloated event list is worse than none, so this is
 * exactly the funnel needed to compute activation and weekly captures per
 * active user — nothing speculative.
 *
 * Declaring it as a map rather than loose strings makes a typo a compile
 * error, and makes the whole of what Mneme knows about its users readable in
 * one screen.
 */
type EventProps = {
  session_start: { is_first_session: boolean };
  signup: { method: 'email' | 'apple' };
  onboarding_step: { step: OnboardingStep; action: 'completed' | 'skipped' };
  capture_started: { kind: CaptureKind; source: CaptureSource };
  capture_succeeded: { kind: CaptureKind; source: CaptureSource; duration_ms: number };
  capture_failed: {
    kind: CaptureKind;
    source: CaptureSource;
    duration_ms: number;
    reason: string;
  };
  first_capture: {
    kind: CaptureKind;
    source: CaptureSource;
    ms_since_signup: number | null;
  };
  tab_view: { tab: TabName };
  insight_opened: { source: InsightSource };
  companion_message: { turn_index: number };
  paywall_view: { source: string };
  purchase: { product_id: string; period: string };
};

export type AnalyticsEvent = keyof EventProps;

// ---------------------------------------------------------------------------
// Client lifecycle
// ---------------------------------------------------------------------------

let client: PostHogClient | null = null;
let started = false;

/**
 * Starts crash reporting. Separate from `initAnalytics` and called earlier —
 * at module scope in the root layout — because a crash during startup is
 * exactly the crash worth catching, and anything deferred to an effect misses
 * it.
 */
export function initCrashReporting(): void {
  try {
    if (!Sentry || !SENTRY_DSN) {
      log('crash reporting off', Sentry ? '(no DSN)' : '(native module missing)');
      return;
    }
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: ENVIRONMENT,
      // Off deliberately: no request bodies, headers, or user IP. The only
      // user data attached is the id set by `identifyUser`.
      sendDefaultPii: false,
      // Crashes are the product here, not performance. A 10% trace sample in
      // production keeps this inside the free tier; full sampling in dev makes
      // the verification run legible.
      tracesSampleRate: ENVIRONMENT === 'prod' ? 0.1 : 1.0,
      // Session tracking is what makes "a crash is eating sessions" a
      // measurable claim rather than a hunch — it yields crash-free session
      // rate.
      enableAutoSessionTracking: true,
    });
    log('crash reporting ready');
  } catch (e) {
    log('crash reporting init FAILED (continuing):', e);
  }
}

/**
 * Starts product analytics. Called after cache hydration so it never sits in
 * front of first paint.
 */
export function initAnalytics(): void {
  try {
    if (started) return;
    if (!PostHog || !POSTHOG_KEY) {
      log('analytics off', PostHog ? '(no key)' : '(native module missing)');
      return;
    }
    started = true;
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      // Batch. 20 events or 30s, whichever comes first, and the queue is
      // persisted so backgrounding the app doesn't drop it.
      flushAt: 20,
      flushInterval: 30_000,
      // Off on purpose. The SDK's own lifecycle events (Application Opened,
      // Became Active, Installed, Updated) are outside the agreed schema and
      // would double-count against `session_start`, which is emitted here.
      captureAppLifecycleEvents: false,
      // Session replay is a separate cost and a separate privacy decision.
      enableSessionReplay: false,
    });
    log('analytics ready');
  } catch (e) {
    started = false;
    client = null;
    log('analytics init FAILED (continuing):', e);
  }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

type Identity = { userId: string; signupDate: string | null };
let identity: Identity | null = null;

const firstCaptureKey = (userId: string) => `mneme_analytics_first_capture:${userId}`;
const FIRST_SESSION_KEY = 'mneme_analytics_first_session';

/**
 * Binds subsequent events to a person.
 *
 * `signupDate` is not decoration. Activation is defined as five captures in
 * the first seven days, and "first seven days" has no meaning without a
 * per-user anchor — event counts alone cannot express it. Passing the profile's
 * `createdAt` here also backfills users who predate analytics, so the metric
 * covers the existing base rather than only new signups.
 */
export function identifyUser(userId: string, signupDate?: string | null): void {
  try {
    // A different account on this device is a different person's first
    // capture. Without this the in-memory guard below stays latched and the
    // second user never emits `first_capture` at all.
    if (identity?.userId !== userId) firstCaptureEmitted = false;
    identity = { userId, signupDate: signupDate ?? null };
    Sentry?.setUser({ id: userId });
    if (!client) return;
    client.identify(userId, signupDate ? { signup_date: signupDate } : undefined);
    log('identified', userId);
  } catch (e) {
    log('identify failed (ignored):', e);
  }
}

/** Called on sign-out so the next account on this device is not merged into
 *  the previous person. */
export function resetIdentity(): void {
  try {
    identity = null;
    firstCaptureEmitted = false;
    Sentry?.setUser(null);
    client?.reset();
  } catch (e) {
    log('reset failed (ignored):', e);
  }
}

// ---------------------------------------------------------------------------
// Emitting
// ---------------------------------------------------------------------------

/**
 * Records an event. Synchronous, fire-and-forget, and incapable of throwing —
 * call it anywhere, including inside a catch block, without a guard.
 */
export function track<E extends AnalyticsEvent>(event: E, props: EventProps[E]): void {
  try {
    if (!client) return;
    client.capture(event, { ...props, environment: ENVIRONMENT });
    log(event, props);

    // First capture is derived here rather than at the call sites. There are
    // two capture paths and both would have to remember it; deriving it from
    // the success event makes it impossible to miss and impossible to
    // double-count.
    if (event === 'capture_succeeded') {
      void noteFirstCapture(props as EventProps['capture_succeeded']);
    }
  } catch (e) {
    log('track failed (ignored):', e);
  }
}

// Guards the read-then-write below against two captures landing in the same
// tick, which storage alone cannot do. Cleared by `resetIdentity` and by
// `identifyUser` on a change of user, so each account gets its own first
// capture.
let firstCaptureEmitted = false;

async function noteFirstCapture(props: EventProps['capture_succeeded']): Promise<void> {
  try {
    const current = identity;
    if (!current || firstCaptureEmitted) return;
    const key = firstCaptureKey(current.userId);
    if (await AsyncStorage.getItem(key)) {
      firstCaptureEmitted = true;
      return;
    }
    firstCaptureEmitted = true;
    await AsyncStorage.setItem(key, '1');

    const signupMs = current.signupDate ? Date.parse(current.signupDate) : NaN;
    client?.capture('first_capture', {
      kind: props.kind,
      source: props.source,
      ms_since_signup: Number.isNaN(signupMs) ? null : Date.now() - signupMs,
      environment: ENVIRONMENT,
    });
    log('first_capture', props.kind);
  } catch (e) {
    log('first_capture bookkeeping failed (ignored):', e);
  }
}

/**
 * Emits `session_start`, resolving `is_first_session` from local storage.
 * Async internally so the caller never waits on the storage read.
 */
export function trackSessionStart(): void {
  void (async () => {
    try {
      const seen = await AsyncStorage.getItem(FIRST_SESSION_KEY);
      if (!seen) await AsyncStorage.setItem(FIRST_SESSION_KEY, '1');
      track('session_start', { is_first_session: !seen });
    } catch (e) {
      log('session_start failed (ignored):', e);
    }
  })();
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Normalises a thrown value into a groupable `reason`.
 *
 * The API layer attaches a `code` to its errors, and that is the signal worth
 * segmenting on. Raw messages are the fallback and are truncated: a chart
 * broken down by unbounded free text is a chart with one row per user.
 */
export function failureReason(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (typeof code === 'string' && code) return code;
  if (error instanceof Error && error.message) return error.message.slice(0, 80);
  return 'unknown';
}

/** Reports a handled error. Unhandled ones are caught by Sentry directly. */
export function captureError(error: unknown, context?: Record<string, unknown>): void {
  try {
    Sentry?.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // A failure to report a failure is not worth escalating.
  }
}

/**
 * Wraps the root component for Sentry's navigation and startup instrumentation,
 * keeping the SDK import inside this module. A pass-through when Sentry is
 * unavailable.
 */
export function wrapRoot<T>(component: T): T {
  try {
    return Sentry && SENTRY_DSN ? (Sentry.wrap(component as never) as T) : component;
  } catch {
    return component;
  }
}

/** Dev-only, for verifying that symbolication works end to end. */
export function throwTestCrash(): void {
  throw new Error('Mneme test crash — analytics verification');
}
