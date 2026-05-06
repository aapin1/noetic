import { CaptureKind } from "@prisma/client";
import { handleRoute, parseJson, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { captureListSchema, captureSchema } from "@/server/contracts";
import { captureItem, listCaptures } from "@/server/services/cognition";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, captureSchema);
    return captureItem({
      userId,
      kind: input.kind as CaptureKind,
      url: input.url,
      text: input.text,
      caption: input.caption,
      mediaUrl: input.mediaUrl,
      reaction: input.reaction,
      topicHints: input.topicHints,
    });
  }, 201);
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseSearchParams(request, captureListSchema);
    return listCaptures({ userId, limit: input.limit });
  });
}
