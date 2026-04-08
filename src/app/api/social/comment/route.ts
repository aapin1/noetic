import { Visibility } from "@prisma/client";
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { commentSchema } from "@/server/contracts";
import { commentOnReview } from "@/server/services/social";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, commentSchema);
    const visibility = input.visibility ?? Visibility.PUBLIC;
    return commentOnReview({
      userId,
      reviewId: input.reviewId,
      parentId: input.parentId,
      content: input.content,
      visibility,
    });
  }, 201);
}
