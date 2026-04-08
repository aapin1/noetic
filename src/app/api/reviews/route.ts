import { Visibility } from "@prisma/client";
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { updateReviewSchema } from "@/server/contracts";
import { updateReview } from "@/server/services/logging";

export async function PATCH(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, updateReviewSchema);
    const visibility = input.visibility ?? Visibility.PUBLIC;
    return updateReview({
      userId,
      logEntryId: input.logEntryId,
      content: input.content,
      visibility,
    });
  });
}
