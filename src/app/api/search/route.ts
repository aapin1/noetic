import { handleRoute, parseSearchParams } from "@/lib/api";
import { searchSchema } from "@/server/contracts";
import { searchEverything } from "@/server/services/search";

export async function GET(request: Request) {
  return handleRoute(async () => {
    const input = await parseSearchParams(request, searchSchema);
    return searchEverything({
      query: input.query,
      limit: input.limit,
    });
  });
}
