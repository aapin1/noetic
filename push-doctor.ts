/**
 * Temporary diagnostic — walks the push chain and reports where it breaks.
 * Not part of the app; delete when push is confirmed working.
 *
 *   DATABASE_URL='<prod pooled>' DIRECT_URL='<prod direct>' npx tsx push-doctor.ts
 *
 * Add --send to also push a test notification to every active token.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SEND = process.argv.includes("--send");

async function main() {
  console.log("\n=== 1. enum values present in the database ===");
  try {
    const values = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
      `SELECT enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'NotificationType' ORDER BY e.enumsortorder`,
    );
    const labels = values.map((v) => v.enumlabel);
    console.log(labels.join(", "));
    const missing = ["CONTRADICTION_FOUND", "THREAD_MOMENTUM", "DORMANT_REVIVAL", "RESURFACE"]
      .filter((v) => !labels.includes(v));
    console.log(missing.length
      ? `❌ MISSING: ${missing.join(", ")} — run: npx prisma db push`
      : "✅ all four resurfacing types exist");
  } catch (e) {
    console.log("❌ could not read enum:", (e as Error).message);
  }

  console.log("\n=== 2. device tokens ===");
  const tokens = await prisma.deviceToken.findMany({
    select: {
      token: true, isActive: true, platform: true, provider: true,
      createdAt: true, user: { select: { email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  if (tokens.length === 0) {
    console.log("❌ NO DEVICE TOKENS AT ALL.");
    console.log("   The app never registered. Either permission was never granted,");
    console.log("   or the build is pointing at a different backend.");
  } else {
    for (const t of tokens) {
      console.log(
        `${t.isActive ? "✅" : "💀"} ${t.provider}/${t.platform} ${t.user?.email ?? "?"} ` +
        `${t.token.slice(0, 30)}… (${t.createdAt.toISOString()})`,
      );
    }
    const active = tokens.filter((t) => t.isActive && t.provider === "EXPO").length;
    console.log(`\n${active > 0 ? "✅" : "❌"} ${active} active EXPO token(s)`);
  }

  console.log("\n=== 3. notifications ===");
  const notifs = await prisma.notification.findMany({
    select: {
      id: true, type: true, status: true, title: true,
      deepLink: true, createdAt: true, sentAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  if (notifs.length === 0) {
    console.log("(none — nothing has been queued yet)");
  } else {
    for (const n of notifs) {
      const mark = n.status === "SENT" ? "✅" : n.status === "FAILED" ? "❌" : "⏳";
      console.log(`${mark} [${n.status}] ${n.type} — "${n.title}" → ${n.deepLink}`);
    }
  }

  const pending = notifs.filter((n) => n.status === "PENDING").length;
  console.log(`\n${pending} pending`);

  if (SEND) {
    console.log("\n=== 4. sending a test push directly through Expo ===");
    const active = await prisma.deviceToken.findMany({
      where: { isActive: true, provider: "EXPO" },
      select: { token: true },
    });
    if (active.length === 0) {
      console.log("❌ no active tokens to send to");
    } else {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(active.map((t) => ({
          to: t.token,
          title: "two things you saved disagree",
          body: "this is a test push from push-doctor.",
          data: { deepLink: "/(tabs)/mind" },
          sound: "default",
        }))),
      });
      console.log(`HTTP ${res.status}`);
      console.log(JSON.stringify(await res.json(), null, 2));
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
