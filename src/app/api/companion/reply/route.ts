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
    await consumeUsageOrThrow(userId, "companion_message");
    const input = await parseJson(request, companionReplySchema);
    return companionReplies.run(() =>
      addCompanionReply({
        userId,
        content: input.content,
        contextItemIds: input.contextItemIds,
      }),
    );
  }, 201);
}
