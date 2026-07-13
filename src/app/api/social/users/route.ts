import { handleRoute, parseSearchParams } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { z } from "zod";
import { searchProfiles } from "@/server/services/social";

const searchSchema = z.object({
  q: z.string().min(1).max(100),
});

export async function GET(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const { q } = await parseSearchParams(request, searchSchema);

    return searchProfiles({ userId, query: q });
  });
}
