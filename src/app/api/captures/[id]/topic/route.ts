import { z } from "zod";
import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getCapture } from "@/server/services/cognition";
import { moveCaptureTopic } from "@/server/services/topic-assign";

const moveTopicSchema = z
  .object({
    topicId: z.string().min(1).optional(),
    topicName: z.string().min(1).max(80).optional(),
  })
  .refine((value) => Boolean(value.topicId) !== Boolean(value.topicName), {
    message: "Provide exactly one of topicId or topicName",
  });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, moveTopicSchema);
    await moveCaptureTopic({
      userId,
      capturedItemId: params.id,
      topicId: input.topicId,
      topicName: input.topicName,
    });
    return getCapture({ userId, capturedItemId: params.id });
  });
}
