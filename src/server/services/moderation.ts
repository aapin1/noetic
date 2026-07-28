import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { ReportReason } from "@/server/contracts";
import type { DbClient } from "@/server/db";

/**
 * Blocking and reporting.
 *
 * App Store Guideline 1.2 requires any app that shows user-generated content to
 * ship a way to report offensive content and a way to block abusive users.
 * Mneme shows other people's capture titles, key ideas, handles, and avatars in
 * Pulse, so it is squarely in scope.
 *
 * The two are deliberately separate: reporting is a signal to us and changes
 * nothing the reporter can see, while blocking is an immediate, self-service
 * remedy that does not wait on anyone reading the report.
 */

/**
 * Every account `userId` has blocked or been blocked by.
 *
 * Symmetric on purpose. A block that only hid the blocked person from the
 * blocker would leave the abusive party still watching — which is the half that
 * actually matters to someone being harassed.
 */
export async function blockedUserIds(
  userId: string,
  db: DbClient = prisma,
): Promise<string[]> {
  const rows = await db.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });

  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.blockerId === userId ? row.blockedId : row.blockerId);
  }
  return [...ids];
}

/**
 * Blocks `targetUserId` and severs the follow edge in BOTH directions.
 *
 * Dropping only the blocker's own follow would leave the blocked account still
 * following them, which on this app means still seeing their capture titles in
 * Pulse — the exact thing the block is for.
 */
export async function blockUser(args: {
  userId: string;
  targetUserId: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  if (args.userId === args.targetUserId) {
    throw new AppError("INVALID_BLOCK", "You cannot block yourself", 400);
  }

  const target = await db.user.findUnique({
    where: { id: args.targetUserId },
    select: { id: true },
  });
  if (!target) {
    throw new AppError("USER_NOT_FOUND", "Account not found", 404);
  }

  await db.userBlock.upsert({
    where: {
      blockerId_blockedId: { blockerId: args.userId, blockedId: args.targetUserId },
    },
    create: { blockerId: args.userId, blockedId: args.targetUserId },
    update: {},
  });

  await db.follow.deleteMany({
    where: {
      OR: [
        { followerId: args.userId, followingId: args.targetUserId },
        { followerId: args.targetUserId, followingId: args.userId },
      ],
    },
  });

  return { blocked: true as const };
}

export async function unblockUser(args: {
  userId: string;
  targetUserId: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  // deleteMany, not delete: unblocking something that is already unblocked is a
  // no-op the client should be free to retry, not a 404.
  await db.userBlock.deleteMany({
    where: { blockerId: args.userId, blockedId: args.targetUserId },
  });

  return { blocked: false as const };
}

/** The accounts this user has blocked, for the "blocked accounts" screen. */
export async function listBlockedUsers(userId: string, db: DbClient = prisma) {
  const rows = await db.userBlock.findMany({
    where: { blockerId: userId },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      blocked: {
        select: {
          id: true,
          profile: { select: { handle: true, displayName: true, avatarUrl: true } },
        },
      },
    },
  });

  return {
    users: rows.map((row) => ({
      id: row.blocked.id,
      handle: row.blocked.profile?.handle ?? row.blocked.id,
      displayName: row.blocked.profile?.displayName ?? "Unknown",
      avatarUrl: row.blocked.profile?.avatarUrl ?? null,
      blockedAt: row.createdAt.toISOString(),
    })),
  };
}

/**
 * Files a report. Idempotent-ish by design: a user re-reporting the same account
 * writes another row rather than erroring, because the repeat itself is signal.
 * The route rate-limits this so it cannot be used to flood the table.
 */
export async function reportUser(args: {
  userId: string;
  targetUserId: string;
  reason: ReportReason;
  details?: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  if (args.userId === args.targetUserId) {
    throw new AppError("INVALID_REPORT", "You cannot report yourself", 400);
  }

  const target = await db.user.findUnique({
    where: { id: args.targetUserId },
    select: { id: true },
  });
  if (!target) {
    throw new AppError("USER_NOT_FOUND", "Account not found", 404);
  }

  await db.userReport.create({
    data: {
      reporterId: args.userId,
      reportedId: args.targetUserId,
      reason: args.reason,
      details: args.details,
    },
  });

  // Reports are triaged out of band; log so they surface without a dashboard.
  console.log(
    JSON.stringify({
      event: "user_report",
      reporterId: args.userId,
      reportedId: args.targetUserId,
      reason: args.reason,
    }),
  );

  return { reported: true as const };
}
