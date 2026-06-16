import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getOrCreateThread } from "@/server/services/socratic";

export async function GET(
  request: Request,
  { params }: { params: { topicId: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getOrCreateThread({ userId, topicId: params.topicId });
  });
}
