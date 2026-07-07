import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getArchiveFolder } from "@/server/services/archive";

export async function GET(request: Request, { params }: { params: { topicId: string } }) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getArchiveFolder({ userId, topicId: params.topicId });
  });
}
