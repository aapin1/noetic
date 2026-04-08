import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { saveContentSchema } from "@/server/contracts";
import { saveContent } from "@/server/services/social";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, saveContentSchema);
    return saveContent(userId, input.contentItemId);
  });
}
