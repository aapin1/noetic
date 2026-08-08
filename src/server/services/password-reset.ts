import { randomInt } from "node:crypto";
import { compare } from "bcryptjs";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { createPasswordHash } from "@/lib/auth";
import { sendEmail, type EmailMessage } from "@/server/services/email";
import type { RootDbClient } from "@/server/db";

/**
 * Code-based password reset — no deep links, the user types the code into the
 * app. Threat model, in order of what actually protects the account:
 *
 *  1. Codes expire in 15 minutes and die after MAX_ATTEMPTS guesses, so the
 *     online brute-force budget against one account is 5 tries in 15 minutes
 *     against a 1-in-a-million code.
 *  2. Codes are bcrypt-hashed at rest and never logged in production, so a
 *     database read or a log leak yields nothing directly usable.
 *  3. The request endpoint answers identically whether or not the email has
 *     an account, so it cannot be used to enumerate members. That extends to
 *     delivery failures — the caller is told "sent" even when nothing went
 *     out, because "sent" vs "failed" would leak the same bit.
 */

const CODE_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

/** A real cost-12 hash (of a fixed pad string, matching no code), so the
 * unknown-email path burns the same bcrypt work as a genuine compare. */
const TIMING_PAD_HASH = "$2a$12$YQxvqXJeNaqcQ2Q85qVof.VYWiWbcDFkWOImXvHyQiea0mNIqeL36";

/** Uniform failure for every confirm problem — unknown email, no active code,
 * expired, spent, or plain wrong. Distinguishing them only helps a guesser. */
function invalidCode(): AppError {
  return new AppError(
    "INVALID_RESET_CODE",
    "that code didn't work. request a new one and try again.",
    400,
  );
}

function generateCode(): string {
  // Full 000000–999999 space; padStart keeps leading-zero codes six digits.
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Issues a reset code for `email` and mails it. Always resolves to the same
 * value — enumeration safety is this function's contract, not just the
 * route's. Issuing replaces any earlier outstanding code (single active code
 * per user keeps the attempt cap meaningful).
 *
 * When no email provider is configured, dev builds log the code so the flow
 * is exercisable end-to-end; production logs nothing.
 */
export async function requestPasswordReset(args: {
  email: string;
  db?: RootDbClient;
  send?: (message: EmailMessage) => Promise<boolean>;
}): Promise<{ sent: true }> {
  const db = args.db ?? prisma;
  const send = args.send ?? sendEmail;
  const email = args.email.trim().toLowerCase();

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!user) {
    // Burn the same bcrypt work as the real path, so response timing doesn't
    // separate "has an account" from "doesn't".
    await createPasswordHash(generateCode());
    return { sent: true };
  }

  const code = generateCode();
  const codeHash = await createPasswordHash(code);

  await db.passwordResetCode.deleteMany({ where: { userId: user.id } });
  await db.passwordResetCode.create({
    data: {
      userId: user.id,
      codeHash,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  const delivered = await send({
    to: email,
    subject: "your mneme reset code",
    text: [
      `your password reset code is ${code}.`,
      "",
      "it expires in 15 minutes. if you didn't ask for this, you can ignore it — your password hasn't changed.",
    ].join("\n"),
  });

  if (!delivered && process.env.NODE_ENV !== "production") {
    console.log(`[password-reset] no email provider configured — code for ${email}: ${code}`);
  }

  return { sent: true };
}

/**
 * Verifies a code and sets the new password. On success every outstanding
 * code for the user is invalidated; the consuming delete happens BEFORE the
 * password write, so a failure between the two can never leave a spent code
 * alive.
 */
export async function confirmPasswordReset(args: {
  email: string;
  code: string;
  newPassword: string;
  db?: RootDbClient;
}): Promise<{ reset: true }> {
  const db = args.db ?? prisma;
  const email = args.email.trim().toLowerCase();

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!user) {
    // Same-shaped work as the real path (see requestPasswordReset).
    await compare(args.code, TIMING_PAD_HASH);
    throw invalidCode();
  }

  const row = await db.passwordResetCode.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  if (!row || row.expiresAt.getTime() <= Date.now()) {
    throw invalidCode();
  }

  // Charge the attempt BEFORE comparing, so a client that never reads the
  // response still spends its budget. The increment is atomic; two racing
  // guesses each pay.
  const charged = await db.passwordResetCode.update({
    where: { id: row.id },
    data: { attempts: { increment: 1 } },
  });

  if (charged.attempts > MAX_ATTEMPTS) {
    throw invalidCode();
  }

  const valid = await compare(args.code, row.codeHash);
  if (!valid) {
    throw invalidCode();
  }

  const passwordHash = await createPasswordHash(args.newPassword);

  // Consume first — see the function comment.
  await db.passwordResetCode.deleteMany({ where: { userId: user.id } });
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return { reset: true };
}
