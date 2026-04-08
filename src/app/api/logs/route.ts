import { Visibility } from "@prisma/client";
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { createLogEntrySchema } from "@/server/contracts";
import { createLogEntry } from "@/server/services/logging";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, createLogEntrySchema);
    const topics = input.topics ?? [];
    const visibility = input.visibility ?? Visibility.PUBLIC;
    return createLogEntry({
      userId,
      contentItemId: input.contentItemId,
      rating: input.rating,
      annotation: input.annotation,
      review: input.review,
      topics,
      visibility,
    });
  }, 201);
}
