import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { companionReplySchema } from "@/server/contracts";
import { companionReplies } from "@/server/services/admission";
import { addCompanionReply } from "@/server/services/companion";
import { enforceRateLimit } from "@/server/services/ratelimit";
import { consumeUsageOrThrow } from "@/server/services/usage";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "companion", 10, 60_000);
    const input = await parseJson(request, companionReplySchema);
    // Quota is consumed INSIDE the slot, never before it: a request turned away
    // by admission control does no work, so it must not cost the user one of
    // their daily companion messages.
    return companionReplies.run(async () => {
      await consumeUsageOrThrow(userId, "companion_message");
      return addCompanionReply({
        userId,
        content: input.content,
        contextItemIds: input.contextItemIds,
      });
    });
  }, 201);
}
