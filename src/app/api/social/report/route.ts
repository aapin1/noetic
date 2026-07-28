import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { reportUserSchema } from "@/server/contracts";
import { reportUser } from "@/server/services/moderation";
import { enforceRateLimit } from "@/server/services/ratelimit";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    // Tighter than the other social limits: reports are written straight to a
    // table a human reads, so flooding it is the abuse case.
    enforceRateLimit(userId, "report", 20, 60 * 60_000);
    const input = await parseJson(request, reportUserSchema);
    return reportUser({
      userId,
      targetUserId: input.targetUserId,
      reason: input.reason,
      details: input.details,
    });
  }, 201);
}
