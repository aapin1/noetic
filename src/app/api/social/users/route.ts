import { handleRoute, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const searchSchema = z.object({
  q: z.string().min(1).max(100),
});

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const { q } = await parseSearchParams(request, searchSchema);

    const profiles = await prisma.profile.findMany({
      where: {
        userId: { not: userId },
        OR: [
          { handle: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        userId: true,
        handle: true,
        displayName: true,
        avatarUrl: true,
      },
      take: 20,
    });

    return {
      users: profiles.map((p) => ({
        id: p.userId,
        handle: p.handle,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
      })),
    };
  });
}
