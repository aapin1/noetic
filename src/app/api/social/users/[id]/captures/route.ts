import { handleRoute, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { z } from "zod";
import { getPersonCaptures } from "@/server/services/social";

const personCapturesSchema = z.object({
  cursor: z.string().min(1).optional(),
});

export async function GET(
  request: Request,
  context: { params: { id: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseSearchParams(request, personCapturesSchema);
    return getPersonCaptures({
      userId,
      targetUserId: context.params.id,
      cursor: input.cursor,
    });
  });
}
