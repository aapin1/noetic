export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; issues?: unknown };
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type Visibility = 'PUBLIC' | 'FOLLOWERS' | 'PRIVATE';
export type ContentType = 'article' | 'newsletter' | 'video' | 'podcast' | 'essay' | 'lecture' | 'interview' | 'book' | 'link';
export type NotificationType = 'FOLLOW' | 'LIKE' | 'COMMENT' | 'MENTION' | 'RANKING_CHANGE' | 'SIMILAR_USER';

export interface UserProfile {
  id: string;
  handle: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
  publicNotes?: string | null;
  followersCount: number;
  followingCount: number;
  identitySummary?: string | null;
  tasteVector?: Record<string, number>;
  isFollowing?: boolean;
}

export interface OwnerProfile extends UserProfile {
  email: string;
  logCount: number;
  reviewCount: number;
}

export interface ContentItem {
  id: string;
  title: string;
  description?: string | null;
  canonicalUrl?: string | null;
  originalUrl?: string | null;
  imageUrl?: string | null;
  authorName?: string | null;
  sourceName?: string | null;
  sourceDomain?: string | null;
  contentType: string;
  publishedAt?: string | null;
  topics: string[];
}

export interface LogEntry {
  id: string;
  userId: string;
  user: Pick<UserProfile, 'id' | 'handle' | 'displayName' | 'avatarUrl'>;
  contentItem: ContentItem;
  rating?: number | null;
  review?: string | null;
  annotation?: string | null;
  topics: string[];
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  likeCount?: number;
  saveCount?: number;
  commentCount?: number;
  isLiked?: boolean;
  isSaved?: boolean;
}

export interface RankingItem {
  id: string;
  position: number;
  contentItemId: string;
  contentItem: ContentItem;
  note?: string | null;
}

export interface RankingList {
  id: string;
  title: string;
  description?: string | null;
  visibility: Visibility;
  userId: string;
  user: Pick<UserProfile, 'id' | 'handle' | 'displayName' | 'avatarUrl'>;
  items: RankingItem[];
  createdAt: string;
  updatedAt: string;
}

export interface FeedItem {
  id: string;
  type: 'LOG' | 'REVIEW' | 'RANKING' | 'FOLLOW';
  reason?: string | null;
  logEntry?: LogEntry;
  rankingList?: RankingList;
  user?: Pick<UserProfile, 'id' | 'handle' | 'displayName' | 'avatarUrl'>;
  targetUser?: Pick<UserProfile, 'id' | 'handle' | 'displayName' | 'avatarUrl'>;
  score?: number;
  createdAt: string;
}

export interface SearchResults {
  users: UserProfile[];
  contentItems: ContentItem[];
  topics: { slug: string; name: string; count: number }[];
}

export interface CompareResult {
  viewerProfile: UserProfile;
  targetProfile: UserProfile;
  overlapScore: number;
  sharedTopics: string[];
  viewerUniqueTopics: string[];
  targetUniqueTopics: string[];
  sharedSources: string[];
  editorialSummary?: string | null;
}

export interface TopicPage {
  slug: string;
  name: string;
  topUsers: UserProfile[];
  topContent: ContentItem[];
  recentLogs: LogEntry[];
}

export interface ContentPage {
  contentItem: ContentItem;
  reviews: LogEntry[];
  similarContent: ContentItem[];
  reviewers: Pick<UserProfile, 'id' | 'handle' | 'displayName' | 'avatarUrl'>[];
  userRankPosition?: number | null;
}

export interface Notification {
  id: string;
  type: NotificationType;
  read: boolean;
  createdAt: string;
  actor?: Pick<UserProfile, 'id' | 'handle' | 'displayName' | 'avatarUrl'>;
  logEntry?: LogEntry;
  contentItem?: ContentItem;
}

export interface Comment {
  id: string;
  userId: string;
  user: Pick<UserProfile, 'id' | 'handle' | 'displayName' | 'avatarUrl'>;
  content: string;
  createdAt: string;
  parentId?: string | null;
  replies?: Comment[];
}

export interface IngestedMetadata {
  id?: string;
  title?: string;
  description?: string;
  canonicalUrl?: string;
  originalUrl: string;
  siteName?: string;
  imageUrl?: string;
  authorName?: string;
  publishedAt?: string;
  sourceName?: string;
  sourceDomain?: string;
  contentType?: string;
  requiresManualInput: boolean;
}

export interface ProfileWithActivity extends UserProfile {
  topRankings: RankingList[];
  recentLogs: LogEntry[];
  similarUsers: (UserProfile & { similarityScore: number })[];
  publicNotesList: LogEntry[];
}
