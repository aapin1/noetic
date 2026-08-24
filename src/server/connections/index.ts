import type { ConnectionProvider } from "@prisma/client";
import { anilist } from "./anilist";
import { arena, github, pinboard, zotero } from "./collections";
import { backloggd, kitsu, rawg, steam } from "./games-anime";
import { goodreads } from "./goodreads";
import { hardcover } from "./hardcover";
import { instapaper } from "./instapaper";
import { letterboxd } from "./letterboxd";
import { bandcamp, listenbrainz } from "./music";
import { raindrop } from "./raindrop";
import { readwise } from "./readwise";
import { trakt } from "./trakt";
import type { Provider } from "./types";
import { bluesky, bookwyrm, hackernews, mastodon, medium, reddit, substack, tumblr } from "./writing";
import { youtube } from "./youtube";

export const PROVIDERS: Record<ConnectionProvider, Provider> = {
  LETTERBOXD: letterboxd,
  GOODREADS: goodreads,
  READWISE: readwise,
  ANILIST: anilist,
  TRAKT: trakt,
  HARDCOVER: hardcover,
  RAINDROP: raindrop,
  INSTAPAPER: instapaper,
  YOUTUBE: youtube,
  MASTODON: mastodon,
  BLUESKY: bluesky,
  TUMBLR: tumblr,
  MEDIUM: medium,
  SUBSTACK: substack,
  BOOKWYRM: bookwyrm,
  HACKERNEWS: hackernews,
  REDDIT: reddit,
  PINBOARD: pinboard,
  ARENA: arena,
  ZOTERO: zotero,
  GITHUB: github,
  KITSU: kitsu,
  STEAM: steam,
  BACKLOGGD: backloggd,
  RAWG: rawg,
  LISTENBRAINZ: listenbrainz,
  BANDCAMP: bandcamp,
};

export type { Provider, ProviderFeed, ProviderItem } from "./types";
export { ProviderError } from "./types";
