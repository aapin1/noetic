import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUsageSummary } from "@/server/services/usage";

/** Plan + current-period usage for the mobile app: drives ad visibility,
 * paywall state, and the usage meters in settings. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const [user, usage] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
      getUsageSummary(userId),
    ]);
    return { plan: user?.plan ?? "FREE", usage };
  });
}
