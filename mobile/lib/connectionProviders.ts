import type { ConnectionProvider } from '@/types/api';

/**
 * Everything the Connections grid can show, organised by what the CONTENT is
 * (films, books, saves…), never by how mneme reaches it. Linkable providers
 * and in-app sign-in targets sit side by side; the modal explains the
 * difference only once one is chosen.
 */

export type ContentGroup =
  | 'Film & TV'
  | 'Books'
  | 'Articles & saves'
  | 'Posts you write'
  | 'Anime & manga'
  | 'Games'
  | 'Music';

export const GROUP_ORDER: ContentGroup[] = [
  'Film & TV',
  'Books',
  'Articles & saves',
  'Posts you write',
  'Anime & manga',
  'Games',
  'Music',
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
  { key: 'letterboxd', name: 'Letterboxd', accent: '#2C3440', group: 'Film & TV', what: 'your reviews', placeholder: 'Username', hint: 'Diary entries with a review. Letterboxd shares your last 50.' },
  { key: 'trakt', name: 'Trakt', accent: '#ED1C24', group: 'Film & TV', what: 'your written reviews', placeholder: 'Username', hint: 'Reviews and comments. Your profile has to be public.' },
  { key: 'youtube', name: 'YouTube', accent: '#FF0000', group: 'Film & TV', what: 'a playlist', placeholder: 'Playlist link', hint: 'Any public or unlisted playlist, captions included.' },
  // — books —
  { key: 'goodreads', name: 'Goodreads', accent: '#553B08', group: 'Books', what: 'your reviews', placeholder: 'Profile link or username', hint: 'Reviews on your public Read shelf.' },
  { key: 'hardcover', name: 'Hardcover', accent: '#6A4C93', group: 'Books', what: 'your reviews', placeholder: 'API token', hint: 'Token from hardcover.app/account/api.', secret: true },
  { key: 'bookwyrm', name: 'BookWyrm', accent: '#0B5394', group: 'Books', what: 'your reviews', placeholder: '@you@bookwyrm.social', hint: 'Book reviews from any BookWyrm instance.' },
  // — articles & saves —
  { key: 'readwise', name: 'Readwise', accent: '#1F3A5F', group: 'Articles & saves', what: 'highlights and notes', placeholder: 'Access token', hint: 'Token from readwise.io/access_token.', secret: true },
  { key: 'raindrop', name: 'Raindrop', accent: '#0066FF', group: 'Articles & saves', what: 'a saved collection', placeholder: 'Public collection link', hint: 'Make a collection public, then paste its link.' },
  { key: 'instapaper', name: 'Instapaper', accent: '#1A1A1A', group: 'Articles & saves', what: 'what you save', placeholder: 'Private RSS link', hint: 'On the web, open a folder, choose Download, then RSS, and paste that link.', secret: true },
  { key: 'pinboard', name: 'Pinboard', accent: '#0000EE', group: 'Articles & saves', what: 'your bookmarks', placeholder: 'Username or API token', hint: 'Username for public pins. An API token includes private ones.' },
  { key: 'arena', name: 'Are.na', accent: '#17AC10', group: 'Articles & saves', what: 'your blocks', placeholder: 'Username', hint: 'Text blocks become your thoughts, link blocks become saved links.' },
  { key: 'zotero', name: 'Zotero', accent: '#CC2936', group: 'Articles & saves', what: 'your notes on papers', placeholder: 'User ID or API key', hint: 'User ID or API key from zotero.org/settings/keys.' },
  { key: 'github', name: 'GitHub', accent: '#24292F', group: 'Articles & saves', what: 'what you star', placeholder: 'Username', hint: 'Starred repos, read like saved links.' },
  // — posts you write —
  { key: 'bluesky', name: 'Bluesky', accent: '#1185FE', group: 'Posts you write', what: 'your posts', placeholder: 'you.bsky.social', hint: 'Your posts, as your own thoughts.' },
  { key: 'mastodon', name: 'Mastodon', accent: '#6364FF', group: 'Posts you write', what: 'your posts', placeholder: '@you@instance.social', hint: 'Your public posts, newest 20 at a time.' },
  { key: 'reddit', name: 'Reddit', accent: '#FF4500', group: 'Posts you write', what: 'your comments', placeholder: 'u/you', hint: 'Your comments. Reddit sometimes refuses, so this retries daily.' },
  { key: 'hackernews', name: 'Hacker News', accent: '#FF6600', group: 'Posts you write', what: 'your comments', placeholder: 'Username', hint: 'Comments and posts, titled by their thread.' },
  { key: 'tumblr', name: 'Tumblr', accent: '#001935', group: 'Posts you write', what: 'your posts', placeholder: 'Blog name', hint: 'Your posts. Reblogs without your words are skipped.' },
  { key: 'medium', name: 'Medium', accent: '#000000', group: 'Posts you write', what: 'your stories', placeholder: '@you', hint: 'Stories you published, read in full.' },
  { key: 'substack', name: 'Substack', accent: '#FF6719', group: 'Posts you write', what: 'your publication', placeholder: 'you.substack.com', hint: 'For writers: your posts, read in full.' },
  // — anime & manga —
  { key: 'anilist', name: 'AniList', accent: '#02A9FF', group: 'Anime & manga', what: 'your list notes', placeholder: 'Username', hint: 'List entries where you wrote a note. Lists have to be public.' },
  { key: 'kitsu', name: 'Kitsu', accent: '#F75239', group: 'Anime & manga', what: 'your reviews and notes', placeholder: 'Username', hint: 'Reviews and library notes. Scores alone are skipped.' },
  // — games —
  { key: 'steam', name: 'Steam', accent: '#1B2838', group: 'Games', what: 'your reviews', placeholder: 'Profile link', hint: 'Game reviews. Your profile has to be public.' },
  { key: 'backloggd', name: 'Backloggd', accent: '#FC6399', group: 'Games', what: 'your reviews', placeholder: 'Username', hint: 'Game reviews you wrote, newest first.' },
  { key: 'rawg', name: 'RAWG', accent: '#1B1B1B', group: 'Games', what: 'your reviews', placeholder: 'rawg.io/@you', hint: 'Game reviews you wrote.' },
  // — music —
  { key: 'listenbrainz', name: 'ListenBrainz', accent: '#EB743B', group: 'Music', what: 'your pins', placeholder: 'Username', hint: 'Tracks you pinned with a few words about why.' },
  { key: 'bandcamp', name: 'Bandcamp', accent: '#1DA0C3', group: 'Music', what: 'your collection', placeholder: 'bandcamp.com/you', hint: 'Your public collection, read like saved links.' },
];

/**
 * Grid placement for the in-app sign-in targets (the list itself comes from
 * the server). Tile names stay short; the server's `name`/`what` speak in the
 * modal.
 */
export const SESSION_TILES: Record<string, { name: string; accent: string; group: ContentGroup }> = {
  netflix: { name: 'Netflix', accent: '#E50914', group: 'Film & TV' },
  'youtube-liked': { name: 'YouTube likes', accent: '#FF0000', group: 'Film & TV' },
  kindle: { name: 'Kindle', accent: '#FF9900', group: 'Books' },
  goodreads: { name: 'Goodreads (full)', accent: '#553B08', group: 'Books' },
  crunchyroll: { name: 'Crunchyroll', accent: '#F47521', group: 'Anime & manga' },
};

export function linkableMeta(key: string): LinkableMeta | null {
  return LINKABLE.find((p) => p.key === key) ?? null;
}
