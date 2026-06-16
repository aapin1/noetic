import { AppError, handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getPositionByTopic } from "@/server/services/positions";

export async function GET(
  request: Request,
  { params }: { params: { topicId: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const position = await getPositionByTopic({ userId, topicId: params.topicId });
    if (!position) {
      throw new AppError("POSITION_NOT_FOUND", "No position found for this topic", 404);
    }
    return position;
  });
}
