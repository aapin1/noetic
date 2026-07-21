import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Constant-time secret comparison. `!==` leaks how many leading bytes matched
 * via response timing, which over enough samples recovers the secret one byte
 * at a time. Lengths are compared first because `timingSafeEqual` throws on a
 * length mismatch — that leaks only the length, which is not sensitive here.
 */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

// RevenueCat server notifications keep User.plan authoritative on the backend
// (the mobile SDK only reflects StoreKit state). app_user_id is our User.id —
// the app calls Purchases.logIn(userId) after sign-in.
// Configure the webhook in the RevenueCat dashboard with an Authorization
// header equal to REVENUECAT_WEBHOOK_SECRET.

const PLUS_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "TRANSFER",
  // Lifetime is a non-subscription (one-time) purchase — RevenueCat reports
  // it as NON_RENEWING_PURCHASE and never sends an EXPIRATION for it.
  "NON_RENEWING_PURCHASE",
]);

export async function POST(request: Request) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret || !secretMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let event: { type?: string; app_user_id?: string } | undefined;
  try {
    const body = (await request.json()) as { event?: typeof event };
    event = body.event;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const userId = event?.app_user_id;
  const type = event?.type ?? "";
  if (!userId) return NextResponse.json({ ok: true });

  const plan = PLUS_EVENTS.has(type) ? "PLUS" : type === "EXPIRATION" ? "FREE" : undefined;
  if (plan) {
    // Anonymous RevenueCat ids ($RCAnonymousID:…) never match a User row;
    // updateMany treats them as a no-op instead of throwing.
    await prisma.user.updateMany({ where: { id: userId }, data: { plan } });
    console.log(JSON.stringify({ event: "revenuecat", type, userId, plan }));
  }

  return NextResponse.json({ ok: true });
}
