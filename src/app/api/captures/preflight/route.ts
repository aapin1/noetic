import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { capturePreflightSchema } from "@/server/contracts";
import { preflightUrl } from "@/server/services/content";

export async function POST(request: Request) {
  return handleRoute(async () => {
    await requireRequestUserId(request);
    const input = await parseJson(request, capturePreflightSchema);
    return preflightUrl(input.url);
  });
}
