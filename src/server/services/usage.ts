import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/api";
import type { DbClient } from "@/server/db";

// Free-tier caps on the paths that actually cost money (Supadata credits,
// gpt-4o vision, per-message companion calls, Whisper). Text/URL captures and
// the map itself are never metered — they cost ~$0.001 and are the product.
// PLUS lifts every cap. Caps are deliberately generous: <10% of users should
// ever see one.
export type UsageKind =
  | "social_video_transcript"
  | "image_describe"
  | "companion_message"
  | "voice_transcription";

type CapDef = {
  free: number;
  period: "month" | "day";
  message: string;
};

export const USAGE_CAPS: Record<UsageKind, CapDef> = {
  social_video_transcript: {
    free: 8,
    period: "month",
    message:
      "You've reached this month's limit for TikTok and Instagram captures. Upgrade to Mneme Plus for unlimited social captures.",
  },
  image_describe: {
    free: 15,
    period: "month",
    message:
      "You've reached this month's limit for image understanding. The image was still saved with your caption. Mneme Plus lifts this limit.",
  },
  companion_message: {
    free: 10,
    period: "day",
    message:
      "The companion is resting until tomorrow — you've used today's messages. Mneme Plus removes the daily limit.",
  },
  voice_transcription: {
    free: 10,
    period: "month",
    message:
      "You've reached this month's voice note limit. Mneme Plus removes it.",
  },
};

function periodKey(period: "month" | "day", now = new Date()): string {
  const iso = now.toISOString();
  return period === "month" ? iso.slice(0, 7) : iso.slice(0, 10);
}

async function isPlus(db: DbClient, userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { plan: true } });
  return user?.plan === "PLUS";
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
  const period = periodKey(cap.period);
  const plus = await isPlus(db, userId);

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
}

/** Read-only check — used by preflight so peeking never burns quota. */
export async function hasUsageRemaining(
  userId: string,
  kind: UsageKind,
  db: DbClient = prisma,
): Promise<boolean> {
  const cap = USAGE_CAPS[kind];
  if (await isPlus(db, userId)) return true;
  const counter = await db.usageCounter.findUnique({
    where: { userId_kind_period: { userId, kind, period: periodKey(cap.period) } },
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
    throw new AppError("USAGE_LIMIT", USAGE_CAPS[kind].message, 429);
  }
}

/** Current-period usage snapshot for the mobile app (settings / paywall). */
export async function getUsageSummary(userId: string, db: DbClient = prisma) {
  const kinds = Object.keys(USAGE_CAPS) as UsageKind[];
  const rows = await db.usageCounter.findMany({
    where: {
      userId,
      OR: kinds.map((kind) => ({ kind, period: periodKey(USAGE_CAPS[kind].period) })),
    },
  });
  const byKind = new Map(rows.map((row) => [row.kind, row.count]));
  return kinds.map((kind) => ({
    kind,
    used: byKind.get(kind) ?? 0,
    limit: USAGE_CAPS[kind].free,
    period: USAGE_CAPS[kind].period,
  }));
}

// Request rate limiting moved to `./ratelimit` — it is an abuse ceiling, not a
// monetization cap, and it now has a durable backend for the auth routes.
// Re-exported so existing importers keep working.
export { enforceRateLimit } from "./ratelimit";
