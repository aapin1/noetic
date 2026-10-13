import { createHmac, timingSafeEqual } from "node:crypto";
import { NotificationStatus, NotificationType } from "@prisma/client";
import { getEnv } from "@/lib/env";
import type { DbClient } from "@/server/db";
import { emailIsConfigured, sendEmail, type EmailMessage } from "@/server/services/email";
import { GROWTH_TARGET } from "@/server/services/resurface";

/**
 * The first-capture email: the one channel that reaches someone who signed up
 * and never saved anything.
 *
 * Push cannot. The app asks for notification permission only after a capture,
 * because before one it has nothing to promise, so an account with no captures
 * has no token and every push nudge written for exactly these people (the
 * inactivity ladder, the growth prompts) silently skips them. They did give us
 * an email address, so that is where the nudge goes.
 *
 * Deliberately small: two emails at most, ever, and only while the account has
 * no captures and no push token. A capture, a token, or an unsubscribe ends it.
 * Sent from the hourly job at the user's local morning send hour, like the
 * pushes it stands in for.
 */

/** Days after signup each email may go. The second is the last word. */
export const FIRST_CAPTURE_EMAIL_RUNGS = [1, 5] as const;

const DAY_MS = 86_400_000;

export type FirstCaptureEmail = {
  /** Ledger key, kept in Notification.payload.resurfaceKey like every nudge. */
  key: string;
  subject: string;
  text: string;
};

/** First name if the account has a plausible one, else nothing. */
function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first && first.length <= 30 ? first : null;
}

/**
 * The email this account is due, or null. Pure: the caller resolves who is
 * eligible (no captures, no token, not unsubscribed).
 *
 * Only the latest rung reached is ever considered, so an account first seen
 * on day six (a late deploy, a missed hour) gets the last email alone rather
 * than both at once.
 */
export function firstCaptureEmailFor(args: {
  signupAt: Date;
  now: Date;
  name: string | null;
  seenKeys: Set<string>;
  openUrl: string;
  unsubscribeUrl: string;
}): FirstCaptureEmail | null {
  const days = Math.floor((args.now.getTime() - args.signupAt.getTime()) / DAY_MS);
  const rung = [...FIRST_CAPTURE_EMAIL_RUNGS].reverse().find((r) => days >= r);
  if (rung === undefined) return null;
  const key = `email:first-capture:${rung}`;
  if (args.seenKeys.has(key)) return null;

  const name = firstName(args.name);
  const greeting = name ? `Hi ${name},` : "Hi,";
  const footer = [
    "Mneme",
    "",
    `Don't want these emails? Unsubscribe: ${args.unsubscribeUrl}`,
  ];

  if (rung === FIRST_CAPTURE_EMAIL_RUNGS[0]) {
    return {
      key,
      subject: "Start your map with one thing you love",
      text: [
        greeting,
        "",
        "Your Mneme map is still empty. The quickest way to start: open the app and name one book, film or idea you love. Mneme finds it and puts it on your map. It takes about ten seconds.",
        "",
        `Open Mneme: ${args.openUrl}`,
        "",
        "Anything you read or watch can go in too. Tap share in Safari, YouTube or anywhere else and pick Mneme.",
        "",
        ...footer,
      ].join("\n"),
    };
  }

  return {
    key,
    subject: "One thing you read or watched lately?",
    text: [
      greeting,
      "",
      "You joined Mneme but haven't saved anything yet, so this is the last reminder we'll send about it.",
      "",
      `Mneme works best with things you actually spent time on: an article you finished, a film you keep thinking about, a podcast that changed your mind. Save one and your map begins. Around ${GROWTH_TARGET}, it starts showing you how your ideas connect.`,
      "",
      `Open Mneme: ${args.openUrl}`,
      "",
      ...footer,
    ].join("\n"),
  };
}

// ── Unsubscribe links ─────────────────────────────────────────────────────────
// Signed rather than looked up, so the link works without a session and needs
// no table. The secret is the auth secret: rotating it signs everyone out
// anyway, and an old unsubscribe link failing then is the lesser problem.

function unsubscribeSignature(userId: string): string {
  return createHmac("sha256", getEnv().NEXTAUTH_SECRET)
    .update(`email-unsubscribe:${userId}`)
    .digest("base64url");
}

export function unsubscribeUrl(userId: string): string {
  const base = getEnv().MNEME_BASE_URL.replace(/\/$/, "");
  const params = new URLSearchParams({ u: userId, t: unsubscribeSignature(userId) });
  return `${base}/api/email/unsubscribe?${params.toString()}`;
}

export function verifyUnsubscribe(userId: string | null, token: string | null): boolean {
  if (!userId || !token) return false;
  const expected = Buffer.from(unsubscribeSignature(userId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function openAppUrl(): string {
  return `${getEnv().MNEME_BASE_URL.replace(/\/$/, "")}/api/open`;
}

// ── The sweep ─────────────────────────────────────────────────────────────────

export type FirstCaptureEmailCandidate = {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
};

/**
 * Send whatever first-capture emails are due among `users`, who the hourly
 * job has already narrowed to: at their morning hour, no captures, no push
 * token, not unsubscribed. No query at all when the list is empty.
 *
 * The ledger row is written before the send and removed if the send fails, so
 * a crash between the two can only ever lose an email, never send one twice.
 */
export async function runFirstCaptureEmailSweep(args: {
  db: DbClient;
  now: Date;
  users: FirstCaptureEmailCandidate[];
  send?: (message: EmailMessage) => Promise<boolean>;
}): Promise<{ considered: number; sent: number }> {
  const { db, now, users } = args;
  const send = args.send ?? sendEmail;
  // Unconfigured is a dev machine or a missing key: nothing could go out, and
  // claiming ledger rows would burn the rungs for nothing.
  if (users.length === 0 || (!args.send && !emailIsConfigured())) {
    return { considered: users.length, sent: 0 };
  }

  const rows = await db.notification.findMany({
    where: { recipientId: { in: users.map((u) => u.id) }, type: NotificationType.NUDGE },
    select: { recipientId: true, payload: true },
  });
  const seenBy = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = (row.payload as Record<string, unknown> | null)?.resurfaceKey;
    if (typeof key !== "string") continue;
    const seen = seenBy.get(row.recipientId) ?? new Set<string>();
    seen.add(key);
    seenBy.set(row.recipientId, seen);
  }

  const openUrl = openAppUrl();
  let sent = 0;
  for (const user of users) {
    const unsubscribe = unsubscribeUrl(user.id);
    const message = firstCaptureEmailFor({
      signupAt: user.createdAt,
      now,
      name: user.name,
      seenKeys: seenBy.get(user.id) ?? new Set(),
      openUrl,
      unsubscribeUrl: unsubscribe,
    });
    if (!message) continue;

    // SENT from birth: the push drain only reads PENDING, so this row is never
    // transmitted as a push. It does take the day's nudge slot, which is right:
    // one message a day, whatever the channel.
    const ledger = await db.notification.create({
      data: {
        recipientId: user.id,
        type: NotificationType.NUDGE,
        title: message.subject,
        body: "",
        deepLink: "/(tabs)",
        payload: { resurfaceKey: message.key, channel: "email" },
        status: NotificationStatus.SENT,
        sentAt: now,
      },
      select: { id: true },
    });

    const ok = await send({
      to: user.email,
      subject: message.subject,
      text: message.text,
      headers: {
        "List-Unsubscribe": `<${unsubscribe}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (ok) {
      sent += 1;
    } else {
      // Not delivered, so not seen: free the rung for tomorrow's run.
      await db.notification.delete({ where: { id: ledger.id } }).catch(() => {});
    }
  }

  return { considered: users.length, sent };
}
