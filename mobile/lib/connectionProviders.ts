import type { ConnectionProvider } from '@/types/api';

/**
 * Everything the Connections grid can show, organised by what the CONTENT is
 * (films, books, saves…), never by how mneme reaches it. Linkable providers
 * and in-app sign-in targets sit side by side; the modal explains the
 * difference only once one is chosen.
 */

export type ContentGroup =
  | 'film & tv'
  | 'books'
  | 'articles & saves'
  | 'posts you write'
  | 'anime & manga'
  | 'games'
  | 'music';

export const GROUP_ORDER: ContentGroup[] = [
  'film & tv',
  'books',
  'articles & saves',
  'posts you write',
  'anime & manga',
  'games',
  'music',
];

export type LinkableMeta = {
  key: ConnectionProvider;
  name: string;
  /** Brand-ish accent for the drawn mark — one colour, never an asset. */
  accent: string;
  group: ContentGroup;
  /** What comes over, in one clause. */
  what: string;
  placeholder: string;
  /** The one thing worth knowing, in one short line. */
  hint: string;
  secret?: boolean;
};

export const LINKABLE: LinkableMeta[] = [
  // — film & tv —
  { key: 'letterboxd', name: 'letterboxd', accent: '#2C3440', group: 'film & tv', what: 'your reviews.', placeholder: 'username', hint: 'diary entries with a review — letterboxd shares your last 50.' },
  { key: 'trakt', name: 'trakt', accent: '#ED1C24', group: 'film & tv', what: 'your written reviews.', placeholder: 'username', hint: 'reviews & comments — profile has to be public.' },
  { key: 'youtube', name: 'youtube', accent: '#FF0000', group: 'film & tv', what: 'a playlist.', placeholder: 'playlist link', hint: 'any public or unlisted playlist, captions and all.' },
  // — books —
  { key: 'goodreads', name: 'goodreads', accent: '#553B08', group: 'books', what: 'your reviews.', placeholder: 'profile link or username', hint: 'reviews on your public "read" shelf.' },
  { key: 'hardcover', name: 'hardcover', accent: '#6A4C93', group: 'books', what: 'your reviews.', placeholder: 'api token', hint: 'token from hardcover.app/account/api.', secret: true },
  { key: 'bookwyrm', name: 'bookwyrm', accent: '#0B5394', group: 'books', what: 'your reviews.', placeholder: '@you@bookwyrm.social', hint: 'book reviews from any bookwyrm instance.' },
  // — articles & saves —
  { key: 'readwise', name: 'readwise', accent: '#1F3A5F', group: 'articles & saves', what: 'highlights and notes.', placeholder: 'access token', hint: 'token from readwise.io/access_token.', secret: true },
  { key: 'raindrop', name: 'raindrop', accent: '#0066FF', group: 'articles & saves', what: 'a saved collection.', placeholder: 'public collection link', hint: 'make a collection public, paste its link.' },
  { key: 'instapaper', name: 'instapaper', accent: '#1A1A1A', group: 'articles & saves', what: 'what you save.', placeholder: 'private rss link', hint: 'on the web: folder → download → rss, paste that link.', secret: true },
  { key: 'pinboard', name: 'pinboard', accent: '#0000EE', group: 'articles & saves', what: 'your bookmarks.', placeholder: 'username or api token', hint: 'username for public pins; api token includes private ones.' },
  { key: 'arena', name: 'are.na', accent: '#17AC10', group: 'articles & saves', what: 'your blocks.', placeholder: 'username', hint: 'text blocks as your thoughts, link blocks as saved links.' },
  { key: 'zotero', name: 'zotero', accent: '#CC2936', group: 'articles & saves', what: 'your notes on papers.', placeholder: 'user id or api key', hint: 'user id (or api key) from zotero.org/settings/keys.' },
  { key: 'github', name: 'github', accent: '#24292F', group: 'articles & saves', what: 'what you star.', placeholder: 'username', hint: 'starred repos, read like saved links.' },
  // — posts you write —
  { key: 'bluesky', name: 'bluesky', accent: '#1185FE', group: 'posts you write', what: 'your posts.', placeholder: 'you.bsky.social', hint: 'your posts, as your own thoughts.' },
  { key: 'mastodon', name: 'mastodon', accent: '#6364FF', group: 'posts you write', what: 'your posts.', placeholder: '@you@instance.social', hint: 'your public posts, newest 20 at a time.' },
  { key: 'reddit', name: 'reddit', accent: '#FF4500', group: 'posts you write', what: 'your comments.', placeholder: 'u/you', hint: 'your comments — reddit sometimes turns us away; it retries daily.' },
  { key: 'hackernews', name: 'hacker news', accent: '#FF6600', group: 'posts you write', what: 'your comments.', placeholder: 'username', hint: 'comments & posts, titled by their thread.' },
  { key: 'tumblr', name: 'tumblr', accent: '#001935', group: 'posts you write', what: 'your posts.', placeholder: 'blog name', hint: 'your posts — reblogs without your words stay put.' },
  { key: 'medium', name: 'medium', accent: '#000000', group: 'posts you write', what: 'your stories.', placeholder: '@you', hint: 'stories you published, read in full.' },
  { key: 'substack', name: 'substack', accent: '#FF6719', group: 'posts you write', what: 'your publication.', placeholder: 'you.substack.com', hint: 'for writers: your posts, read in full.' },
  // — anime & manga —
  { key: 'anilist', name: 'anilist', accent: '#02A9FF', group: 'anime & manga', what: 'your list notes.', placeholder: 'username', hint: 'list entries where you wrote a note — lists have to be public.' },
  { key: 'kitsu', name: 'kitsu', accent: '#F75239', group: 'anime & manga', what: 'your reviews & notes.', placeholder: 'username', hint: 'reviews & library notes — scores alone stay put.' },
  // — games —
  { key: 'steam', name: 'steam', accent: '#1B2838', group: 'games', what: 'your reviews.', placeholder: 'profile link', hint: 'game reviews — profile has to be public.' },
  { key: 'backloggd', name: 'backloggd', accent: '#FC6399', group: 'games', what: 'your reviews.', placeholder: 'username', hint: 'game reviews you wrote, newest first.' },
  { key: 'rawg', name: 'rawg', accent: '#1B1B1B', group: 'games', what: 'your reviews.', placeholder: 'rawg.io/@you', hint: 'game reviews you wrote.' },
  // — music —
  { key: 'listenbrainz', name: 'listenbrainz', accent: '#EB743B', group: 'music', what: 'your pins.', placeholder: 'username', hint: 'tracks you pinned with a few words about why.' },
  { key: 'bandcamp', name: 'bandcamp', accent: '#1DA0C3', group: 'music', what: 'your collection.', placeholder: 'bandcamp.com/you', hint: 'your public collection, read like saved links.' },
];

/**
 * Grid placement for the in-app sign-in targets (the list itself comes from
 * the server). Tile names stay short; the server's `name`/`what` speak in the
 * modal.
 */
export const SESSION_TILES: Record<string, { name: string; accent: string; group: ContentGroup }> = {
  netflix: { name: 'netflix', accent: '#E50914', group: 'film & tv' },
  'youtube-liked': { name: 'yt likes', accent: '#FF0000', group: 'film & tv' },
  kindle: { name: 'kindle', accent: '#FF9900', group: 'books' },
  goodreads: { name: 'goodreads full', accent: '#553B08', group: 'books' },
  crunchyroll: { name: 'crunchyroll', accent: '#F47521', group: 'anime & manga' },
};

export function linkableMeta(key: string): LinkableMeta | null {
  return LINKABLE.find((p) => p.key === key) ?? null;
}
