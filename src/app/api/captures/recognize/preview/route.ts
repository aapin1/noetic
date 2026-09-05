import { handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { recognizePreviewSchema } from "@/server/contracts";
import { enforceRateLimit } from "@/server/services/ratelimit";
import { findWork, findWorkAlternatives } from "@/server/services/recognize";

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "recognize-preview", 30, 5 * 60_000);
    const input = await parseJson(request, recognizePreviewSchema);
    const lookup = { kind: input.kind, title: input.title, year: input.year };
    // The understanding ladder: catalogue page first, then the model's own
    // knowledge of the work. Only when both come back empty does the client
    // fall to rung three and ask the person what it is. Sibling candidates
    // ride along so a wrong best-guess ("Her" the film vs the others) is one
    // tap from the right one.
    const [{ resolved, recalled }, siblings] = await Promise.all([
      findWork(lookup),
      findWorkAlternatives(lookup),
    ]);
    const alternatives = (resolved?.title
      ? siblings.filter((s) => s.title.toLowerCase().trim() !== resolved.title.toLowerCase().trim())
      : siblings
    ).slice(0, 3);
    if (resolved?.description) return { hit: true as const, ...resolved, alternatives };
    if (recalled) {
      return {
        hit: true as const,
        // A catalogue page with no blurb still contributes its link and cover.
        url: resolved?.url,
        imageUrl: resolved?.imageUrl,
        title: resolved?.title ?? input.title,
        description: recalled.description,
        author: resolved?.author ?? recalled.author ?? undefined,
        alternatives,
      };
    }
    return { hit: false as const, alternatives };
  });
}
