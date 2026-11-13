import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getPersonCapture } from "@/server/services/social";

export async function GET(
  request: Request,
  context: { params: { id: string; captureId: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getPersonCapture({
      userId,
      targetUserId: context.params.id,
      captureId: context.params.captureId,
    });
  });
}
