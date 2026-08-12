import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { socraticReplySchema } from "@/server/contracts";
import { enforceRateLimit } from "@/server/services/ratelimit";
import { consumeUsageOrThrow } from "@/server/services/usage";
import { addUserReply } from "@/server/services/socratic";

export async function POST(
  request: Request,
  { params }: { params: { topicId: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    // Every reply is a paid LLM call. Same ceiling as /api/companion/reply,
    // the other conversational endpoint — well above real use (a person
    // thinking through a topic sends a handful of turns a minute), but it
    // stops a scripted client from billing us in a loop.
    enforceRateLimit(userId, "socratic", 10, 60_000);
    const input = await parseJson(request, socraticReplySchema);
    // Socratic turns draw on the same daily conversation quota as the
    // companion: both are per-message LLM spend, and metering one while the
    // other ran uncapped left a free path to unlimited paid calls.
    await consumeUsageOrThrow(userId, "companion_message");
    return addUserReply({ userId, topicId: params.topicId, content: input.content });
  }, 201);
}
