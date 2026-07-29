import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { socraticReplySchema } from "@/server/contracts";
import { enforceRateLimit } from "@/server/services/ratelimit";
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
    return addUserReply({ userId, topicId: params.topicId, content: input.content });
  }, 201);
}
