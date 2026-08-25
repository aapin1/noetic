import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api";
import type { DbClient } from "@/server/db";

// Free-tier caps on the paths that actually cost money. Text/URL captures and
// the map itself are never metered — they cost ~$0.001 and are the product.
// PLUS lifts every cap.
//
// Caps are sized so a free user who maxes EVERY cap in a month costs at most
// ~20% more than the native-ad revenue that same heavy user throws off
// (~$0.35/mo at a $3 blended eCPM over ~100+ impressions). Working per-unit
// costs and the resulting monthly ceiling:
//   social_video_transcript  ~$0.06  (the paid Supadata backstop for TikTok/IG
//                                     — only metered when it actually ran; the
//                                     self-hosted captions/ASR ladder is
//                                     ~$0.002 and unmetered)
//   image_describe           ~$0.01  (gpt-4o vision)
//   voice_transcription      ~$0.008 (whisper-1)
//   companion_message        ~$0.0006 but PER DAY — 6/day = 180/mo = ~$0.11
//   → max-everything ≈ 3·.06 + 8·.01 + 5·.008 + 180·.0006 ≈ $0.41/mo (~1.2×).
// A user who wants more hits the cap message → upgrade to Plus (the only path
// that clears the money-losing social transcripts) or, once wired, watches a
// rewarded ad for cheap-path relief (image/voice/companion — see grantBonusUsage).
export type UsageKind =
  | "social_video_transcript"
  | "image_describe"
  | "companion_message"
  | "voice_transcription";

type CapDef = {
  free: number;
  period: "month" | "day";
  /** What ran out — shown to the user, followed by the reset date and the upsell. */
  message: string;
  upsell: string;
};

export const USAGE_CAPS: Record<UsageKind, CapDef> = {
  social_video_transcript: {
    free: 3,
    period: "month",
    message: "You've used this month's 3 deep reads of TikTok and Instagram videos, so this one was saved with its caption only.",
    upsell: "Mneme Plus makes them unlimited.",
  },
  image_describe: {
    free: 8,
    period: "month",
    message: "You've used this month's 8 image reads, so this image was saved with your caption only.",
    upsell: "Mneme Plus makes them unlimited.",
  },
  companion_message: {
    free: 6,
    period: "day",
    message: "The companion is resting — you've used today's 6 messages.",
    upsell: "Mneme Plus removes the daily limit.",
  },
  voice_transcription: {
    free: 5,
    period: "month",
    message: "You've used this month's 5 voice notes.",
    upsell: "Mneme Plus makes them unlimited.",
  },
};

export type UsageLimitNotice = {
  kind: UsageKind;
  /** Full user-facing sentence: what ran out, when it resets, the upsell. */
  message: string;
  limit: number;
  period: "month" | "day";
  /** ISO instant at which this user's current period rolls over. */
  resetsAt: string;
};

const MAX_OFFSET_MINUTES = 14 * 60;
const clampOffset = (minutes: number) => Math.max(-MAX_OFFSET_MINUTES, Math.min(MAX_OFFSET_MINUTES, Math.trunc(minutes)));

/** The user's wall clock: UTC shifted by the offset the app last reported
 * (0 — plain UTC — when it never has). Periods are keyed and reset on THIS
 * clock, so a month ends at the user's midnight, not at 5pm Pacific. */
const localNow = (now: Date, tzOffsetMinutes: number) => new Date(now.getTime() + tzOffsetMinutes * 60_000);

function periodKey(period: "month" | "day", tzOffsetMinutes = 0, now = new Date()): string {
  const iso = localNow(now, tzOffsetMinutes).toISOString();
  return period === "month" ? iso.slice(0, 7) : iso.slice(0, 10);
}

/** The UTC instant at which the user's current period rolls over. */
export function periodResetsAt(period: "month" | "day", tzOffsetMinutes = 0, now = new Date()): Date {
  const local = localNow(now, tzOffsetMinutes);
  const nextLocal =
    period === "month"
      ? Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1)
      : Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  return new Date(nextLocal - tzOffsetMinutes * 60_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function describeReset(period: "month" | "day", resetsAt: Date, tzOffsetMinutes: number): string {
  if (period === "day") return "Resets tomorrow.";
  const local = localNow(resetsAt, tzOffsetMinutes);
  return `Resets ${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}.`;
}

/** The user-facing "you've run out" notice for a kind, with the reset date on
 * the user's own clock. */
export function usageLimitNotice(kind: UsageKind, tzOffsetMinutes = 0, now = new Date()): UsageLimitNotice {
  const cap = USAGE_CAPS[kind];
  const resetsAt = periodResetsAt(cap.period, tzOffsetMinutes, now);
  return {
    kind,
    limit: cap.free,
    period: cap.period,
    resetsAt: resetsAt.toISOString(),
    message: `${cap.message} ${describeReset(cap.period, resetsAt, tzOffsetMinutes)} ${cap.upsell}`,
  };
}

async function loadUser(db: DbClient, userId: string): Promise<{ plus: boolean; tzOffsetMinutes: number }> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { plan: true } });
  let tzOffsetMinutes = 0;
  try {
    const pref = await db.userPreference.findUnique({ where: { userId }, select: { tzOffsetMinutes: true } });
    if (typeof pref?.tzOffsetMinutes === "number" && Number.isFinite(pref.tzOffsetMinutes)) {
      tzOffsetMinutes = clampOffset(pref.tzOffsetMinutes);
    }
  } catch {
    // No preference row / partial test doubles: UTC.
  }
  return { plus: user?.plan === "PLUS", tzOffsetMinutes };
}

/** The notice for a user, on their clock. */
export async function usageLimitNoticeFor(userId: string, kind: UsageKind, db: DbClient = prisma): Promise<UsageLimitNotice> {
  const { tzOffsetMinutes } = await loadUser(db, userId);
  return usageLimitNotice(kind, tzOffsetMinutes);
}

/**
 * Returns true when the user may perform the action, false when the free-tier
 * cap is exhausted. Increments the counter only when allowed, so a blocked
 * attempt never consumes quota. PLUS users always pass (still counted, for
 * cost telemetry).
 */
export async function tryConsumeUsage(
  userId: string,
  kind: UsageKind,
  db: DbClient = prisma,
): Promise<boolean> {
  const cap = USAGE_CAPS[kind];

  // A metering failure must not fail the caller. Both capture call sites treat
  // `false` as "skip the paid step" and still complete via their own fallback
  // (caption/reaction for images, non-paid scrape for links), so denying on a
  // DB error degrades the capture instead of 500ing it — and refuses to spend
  // money we've just proven we can't account for. Failing open would do the
  // opposite of both.
  try {
    const { plus, tzOffsetMinutes } = await loadUser(db, userId);
    const period = periodKey(cap.period, tzOffsetMinutes);

    const counter = await db.usageCounter.upsert({
      where: { userId_kind_period: { userId, kind, period } },
      create: { userId, kind, period, count: 0 },
      update: {},
    });

    if (!plus && counter.count >= cap.free) return false;

    await db.usageCounter.update({
      where: { userId_kind_period: { userId, kind, period } },
      data: { count: { increment: 1 } },
    });
    return true;
  } catch (err) {
    console.error(
      JSON.stringify({ event: "usage_meter_failed", kind, userId, message: String(err) }),
    );
    return false;
  }
}

/** Read-only check — used by preflight so peeking never burns quota. */
export async function hasUsageRemaining(
  userId: string,
  kind: UsageKind,
  db: DbClient = prisma,
): Promise<boolean> {
  const cap = USAGE_CAPS[kind];
  const { plus, tzOffsetMinutes } = await loadUser(db, userId);
  if (plus) return true;
  const counter = await db.usageCounter.findUnique({
    where: { userId_kind_period: { userId, kind, period: periodKey(cap.period, tzOffsetMinutes) } },
  });
  return (counter?.count ?? 0) < cap.free;
}

/** Like tryConsumeUsage but throws the user-facing cap message (HTTP 429). */
export async function consumeUsageOrThrow(
  userId: string,
  kind: UsageKind,
  db: DbClient = prisma,
): Promise<void> {
  const allowed = await tryConsumeUsage(userId, kind, db);
  if (!allowed) {
    const notice = await usageLimitNoticeFor(userId, kind, db);
    throw new AppError("USAGE_LIMIT", notice.message, 429, notice);
  }
}

/** Current-period usage snapshot for the mobile app (settings / paywall). */
export async function getUsageSummary(userId: string, db: DbClient = prisma) {
  const kinds = Object.keys(USAGE_CAPS) as UsageKind[];
  const { tzOffsetMinutes } = await loadUser(db, userId);
  const rows = await db.usageCounter.findMany({
    where: {
      userId,
      OR: kinds.map((kind) => ({ kind, period: periodKey(USAGE_CAPS[kind].period, tzOffsetMinutes) })),
    },
  });
  const byKind = new Map(rows.map((row) => [row.kind, row.count]));
  return kinds.map((kind) => ({
    kind,
    used: byKind.get(kind) ?? 0,
    limit: USAGE_CAPS[kind].free,
    period: USAGE_CAPS[kind].period,
    resetsAt: periodResetsAt(USAGE_CAPS[kind].period, tzOffsetMinutes).toISOString(),
  }));
}

// Request rate limiting moved to `./ratelimit` — it is an abuse ceiling, not a
// monetization cap, and it now has a durable backend for the auth routes.
// Re-exported so existing importers keep working.
export { enforceRateLimit } from "./ratelimit";
