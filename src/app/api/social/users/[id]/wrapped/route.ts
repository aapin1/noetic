import { handleRoute } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getPersonWrapped } from "@/server/services/social";

export async function GET(
  request: Request,
  context: { params: { id: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getPersonWrapped({ userId, targetUserId: context.params.id });
  });
}
