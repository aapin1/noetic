import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { socraticReplySchema } from "@/server/contracts";
import { addUserReply } from "@/server/services/socratic";

export async function POST(
  request: Request,
  { params }: { params: { topicId: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, socraticReplySchema);
    return addUserReply({ userId, topicId: params.topicId, content: input.content });
  }, 201);
}
