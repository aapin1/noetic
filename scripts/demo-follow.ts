/**
 * One-off App Review helper: make the demo account follow someone so the Pulse
 * tab isn't empty when a reviewer opens it (App Store Guideline 2.1(a)).
 *
 * Run with no args to list candidate accounts and their capture counts — the
 * Pulse card renders the followed user's map, so following an empty account
 * just trades "no one here" for "nothing on their map yet".
 *
 *   DATABASE_URL='<prod url>' npx tsx scripts/demo-follow.ts
 *   DATABASE_URL='<prod url>' npx tsx scripts/demo-follow.ts <follower> <target>
 *
 * Handles are given without the leading "@". Re-running is safe: the follow is
 * an upsert on the (followerId, followingId) unique pair.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function list() {
  const profiles = await prisma.profile.findMany({
    select: { handle: true, displayName: true, userId: true },
    orderBy: { createdAt: "asc" },
  });

  const rows = await Promise.all(
    profiles.map(async (p) => ({
      ...p,
      captures: await prisma.capturedItem.count({ where: { userId: p.userId } }),
      following: await prisma.follow.count({ where: { followerId: p.userId } }),
    })),
  );

  console.log(`\n${rows.length} accounts:\n`);
  for (const r of rows) {
    console.log(
      `  @${r.handle.padEnd(20)} ${String(r.captures).padStart(4)} captures  ` +
        `follows ${r.following}   (${r.displayName})`,
    );
  }
  console.log(`\nThen: npx tsx scripts/demo-follow.ts <follower> <target>\n`);
}

async function follow(followerHandle: string, targetHandle: string) {
  const [follower, target] = await Promise.all([
    prisma.profile.findUnique({ where: { handle: followerHandle } }),
    prisma.profile.findUnique({ where: { handle: targetHandle } }),
  ]);

  if (!follower) throw new Error(`No account with handle "${followerHandle}"`);
  if (!target) throw new Error(`No account with handle "${targetHandle}"`);
  if (follower.userId === target.userId) throw new Error("An account can't follow itself");

  const captures = await prisma.capturedItem.count({ where: { userId: target.userId } });
  if (captures === 0) {
    console.warn(
      `\n  WARNING: @${targetHandle} has 0 captures — the Pulse card will read ` +
        `"nothing on their map yet".\n`,
    );
  }

  await prisma.follow.upsert({
    where: {
      followerId_followingId: { followerId: follower.userId, followingId: target.userId },
    },
    create: { followerId: follower.userId, followingId: target.userId },
    update: {},
  });

  console.log(`\n  @${followerHandle} now follows @${targetHandle} (${captures} captures)\n`);
}

async function main() {
  const [followerHandle, targetHandle] = process.argv.slice(2);
  if (!followerHandle || !targetHandle) {
    await list();
    return;
  }
  await follow(followerHandle.replace(/^@/, ""), targetHandle.replace(/^@/, ""));
}

main()
  .catch((err) => {
    console.error(`\n  ${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
