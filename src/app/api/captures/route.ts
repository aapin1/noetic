import { CaptureKind } from "@prisma/client";
import { handleRoute, parseJson, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { captureListSchema, captureSchema } from "@/server/contracts";
import { captureItem, listCaptures } from "@/server/services/cognition";
import { checkCaptureAgainstPositions } from "@/server/services/positions";
import { enforceRateLimit } from "@/server/services/usage";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "capture", 30, 5 * 60_000);
    const input = await parseJson(request, captureSchema);
    const capture = await captureItem({
      userId,
      kind: input.kind as CaptureKind,
      url: input.url,
      text: input.text,
      caption: input.caption,
      mediaUrl: input.mediaUrl,
      reaction: input.reaction,
      userContext: input.userContext,
      topicHints: input.topicHints,
    });
    // Position tension runs in the background: the challenge row it persists
    // is surfaced by the positions screens, and no client reads it from this
    // response — so blocking the commit on an extra LLM round-trip only added
    // user-visible seconds.
    void checkCaptureAgainstPositions({
      userId,
      capturedItemId: capture.id,
      topicIds: capture.topics.map((t) => t.topicId),
      captureTitle: capture.title,
      captureText: capture.rawText ?? capture.summary ?? "",
    }).catch((err) => {
      console.error("checkCaptureAgainstPositions (background) failed", err);
    });
    return { ...capture, positionChallenge: null };
  }, 201);
}

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseSearchParams(request, captureListSchema);
    return listCaptures({ userId, limit: input.limit, query: input.query, cursor: input.cursor });
  });
}
