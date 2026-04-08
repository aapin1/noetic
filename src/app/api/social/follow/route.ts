import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { followUserSchema } from "@/server/contracts";
import { followUser } from "@/server/services/social";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, followUserSchema);
    return followUser(userId, input.targetUserId);
  });
}
