import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { unfollowUserSchema } from "@/server/contracts";
import { unfollowUser } from "@/server/services/social";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, unfollowUserSchema);
    return unfollowUser(userId, input.targetUserId);
  });
}
