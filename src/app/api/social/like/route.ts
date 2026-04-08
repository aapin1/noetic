import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { likeReviewSchema } from "@/server/contracts";
import { likeReview } from "@/server/services/social";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, likeReviewSchema);
    return likeReview(userId, input.reviewId);
  });
}
