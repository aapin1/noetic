import { handleRoute, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { compareProfilesSchema } from "@/server/contracts";
import { compareUsers } from "@/server/services/taste";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const viewerId = await requireRequestUserId(request);
    const input = await parseSearchParams(request, compareProfilesSchema);
    const target = await prisma.profile.findUnique({
      where: { handle: input.targetHandle },
      select: { userId: true },
    });

    if (!target) {
      throw new Error("Target profile not found");
    }

    return compareUsers({
      viewerId,
      targetUserId: target.userId,
    });
  });
}
