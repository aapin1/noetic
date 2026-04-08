import { handleRoute, parseJson } from "@/lib/api";
import { ingestContentSchema } from "@/server/contracts";
import { ingestUrl } from "@/server/services/content";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const input = await parseJson(request, ingestContentSchema);
    return ingestUrl(input.url);
  });
}
