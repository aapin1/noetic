import { z } from "zod";
import { handleRoute } from "@/lib/api";
import { getRequestUserId } from "@/lib/auth";
import { getPublicTopicPage } from "@/server/services/profile";

const topicRouteSchema = z.object({
  slug: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export async function GET(
  request: Request,
  context: { params: { slug: string } },
) {
  return handleRoute(async () => {
    const viewerId = await getRequestUserId(request);
    const url = new URL(request.url);
    const input = topicRouteSchema.parse({
      slug: context.params.slug,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return getPublicTopicPage({
      slug: input.slug,
      viewerId,
      limit: input.limit,
    });
  });
}
