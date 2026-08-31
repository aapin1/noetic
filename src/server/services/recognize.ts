import { CaptureKind } from "@prisma/client";
import type { ProviderItem } from "@/server/connections/types";
import { resolveWork } from "@/server/imports/resolve";
import { capturePipeline } from "@/server/services/admission";
import { captureItem } from "@/server/services/cognition";
import { createManualContentItem } from "@/server/services/content";

/**
 * Onboarding recognition: the person names a work they already love ("Interstellar",
 * "The Left Hand of Darkness") and it becomes a real first capture — the same
 * words-about-a-work shape the connected-account sync produces, minus the feed.
 * The keyless resolver supplies the page; a miss still captures, as words about
 * a bare title, so naming something obscure never dead-ends the first session.
 */

type Lookup = NonNullable<ProviderItem["lookup"]>;

/** resolver kind → ContentItem.contentType (inverse of capture-items' RESOLVE_KIND). */
const CONTENT_TYPE: Record<Lookup["kind"], string> = {
  film: "film",
  tv: "tv",
  book: "book",
  anime: "anime",
  game: "game",
  album: "music",
};

export async function captureRecognizedWork(args: { userId: string; lookup: Lookup; words?: string }) {
  const resolved = await resolveWork(args.lookup);

  // The catalogue page's hostname, the way the Readwise sync names sources.
  let siteName: string | undefined;
  if (resolved?.url) {
    try {
      siteName = new URL(resolved.url).hostname.replace(/^www\./, "") || undefined;
    } catch {
      /* the title is enough */
    }
  }

  const content = await createManualContentItem({
    title: resolved?.title ?? args.lookup.title,
    description: resolved?.description,
    canonicalUrl: resolved?.url,
    originalUrl: resolved?.url,
    siteName,
    imageUrl: resolved?.imageUrl,
    authorName: resolved?.author ?? args.lookup.author,
    contentType: CONTENT_TYPE[args.lookup.kind],
    topics: [],
  });

  return capturePipeline.run(() =>
    captureItem({
      userId: args.userId,
      kind: CaptureKind.LINK,
      url: resolved?.url,
      contentItemId: content.id,
      origin: "onboarding",
      reaction: args.words || undefined,
    }),
  );
}
