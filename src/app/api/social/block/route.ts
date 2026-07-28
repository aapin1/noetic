import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { blockUserSchema } from "@/server/contracts";
import { blockUser, listBlockedUsers, unblockUser } from "@/server/services/moderation";
import { enforceRateLimit } from "@/server/services/ratelimit";

/** The caller's blocked accounts — backs the "blocked accounts" settings screen. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return listBlockedUsers(userId);
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "block", 60, 5 * 60_000);
    const input = await parseJson(request, blockUserSchema);
    return blockUser({ userId, targetUserId: input.targetUserId });
  });
}

export async function DELETE(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "block", 60, 5 * 60_000);
    const input = await parseJson(request, blockUserSchema);
    return unblockUser({ userId, targetUserId: input.targetUserId });
  });
}
