import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getCapture } from "@/server/services/cognition";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getCapture({ userId, capturedItemId: params.id });
  });
}
