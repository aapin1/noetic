import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { createPositionSchema } from "@/server/contracts";
import { createPosition, getPositionsForUser } from "@/server/services/positions";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    return getPositionsForUser({ userId });
  });
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, createPositionSchema);
    return createPosition({
      userId,
      topicId: input.topicId,
      statement: input.statement,
      captureCountAtCreation: input.captureCountAtCreation,
    });
  }, 201);
}
