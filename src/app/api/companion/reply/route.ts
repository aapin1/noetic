import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { companionReplySchema } from "@/server/contracts";
import { addCompanionReply } from "@/server/services/companion";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, companionReplySchema);
    return addCompanionReply({
      userId,
      content: input.content,
      contextItemIds: input.contextItemIds,
    });
  }, 201);
}
