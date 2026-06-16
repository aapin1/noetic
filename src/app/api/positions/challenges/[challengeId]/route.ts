import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { acknowledgeSchema } from "@/server/contracts";
import { acknowledgeChallenge } from "@/server/services/positions";

export async function PATCH(
  request: Request,
  { params }: { params: { challengeId: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, acknowledgeSchema);
    await acknowledgeChallenge({
      userId,
      challengeId: params.challengeId,
      revision: input.revision,
    });
    return { acknowledged: true };
  });
}
