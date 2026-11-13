import { handleRoute, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { z } from "zod";
import { getPersonFollows } from "@/server/services/social";

const personFollowsSchema = z.object({
  list: z.enum(["followers", "following"]),
  cursor: z.string().min(1).optional(),
});

export async function GET(
  request: Request,
  context: { params: { id: string } },
) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseSearchParams(request, personFollowsSchema);
    return getPersonFollows({
      userId,
      targetUserId: context.params.id,
      list: input.list,
      cursor: input.cursor,
    });
  });
}
