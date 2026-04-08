import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { manualContentSchema } from "@/server/contracts";
import { createManualContentItem } from "@/server/services/content";

export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireRequestUserId(request);
    const input = await parseJson(request, manualContentSchema);
    const topics = input.topics ?? [];
    return createManualContentItem({
      title: input.title,
      description: input.description,
      canonicalUrl: input.canonicalUrl,
      originalUrl: input.originalUrl,
      siteName: input.siteName,
      imageUrl: input.imageUrl,
      authorName: input.authorName,
      publishedAt: input.publishedAt,
      sourceName: input.sourceName,
      sourceDomain: input.sourceDomain,
      contentType: input.contentType,
      topics,
    });
  }, 201);
}
