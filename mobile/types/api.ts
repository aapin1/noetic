export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { code: string; message: string; issues?: unknown };
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type CaptureKind = 'LINK' | 'TEXT' | 'QUOTE' | 'IMAGE';
export type InsightStyle = 'DIRECT' | 'REFLECTIVE' | 'ANALYTICAL';
export type InsightType =
  | 'PATTERN'
  | 'TRAJECTORY'
  | 'CONNECTION'
  | 'REINFORCES'
  | 'CONTRADICTS'
  | 'NOVELTY'
  | 'RECUR';
export type MemoryEdgeType =
  | 'RECURS'
  | 'REINFORCES'
  | 'CONTRADICTS'
  | 'EVOLVES_FROM'
  | 'RELATED';

export type TopicKind = 'general' | 'specific';

export interface CaptureTopic {
  topicId: string;
  name: string;
  slug: string;
  weight: number;
  /** general = coarse onboarding-style field; specific = fine-grained label. */
  kind: TopicKind;
}

export interface CaptureContent {
  id: string;
  title: string;
  description: string | null;
  canonicalUrl: string | null;
  sourceName: string | null;
  contentType: string | null;
  imageUrl: string | null;
  authorName: string | null;
}

export interface CapturedItem {
  id: string;
  title: string;
  summary: string | null;
  keyIdea: string | null;
  capturedAt: string;
  reaction: string | null;
  userContext: string | null;
  kind: CaptureKind;
  topics: CaptureTopic[];
  contentItem: CaptureContent | null;
  rawText: string | null;
  caption: string | null;
  mediaUrl: string | null;
}

export interface RelatedItem extends CapturedItem {
  edgeType?: MemoryEdgeType;
  edgeWeight?: number;
}

export interface InsightCard {
  id: string;
  type: InsightType;
  headline: string;
  body: string;
  strength: number;
  evidence: unknown;
}

export interface Recommendation {
  title: string;
  author: string;
  why: string;
}

export interface CaptureResponse extends CapturedItem {
  insights: InsightCard[];
  related: RelatedItem[];
  edges: { fromItemId: string; toItemId: string; type: MemoryEdgeType; weight: number }[];
  threadContext: { topicName: string; captureCount: number } | null;
  recommendations: Recommendation[];
  positionChallenge: CapturePositionChallenge | null;
}

export interface CaptureDetail extends CapturedItem {
  insights: InsightCard[];
  related: RelatedItem[];
}

export interface CaptureSummary extends CapturedItem {
  leadInsight: { id: string; type: InsightType; headline: string } | null;
}

export type ArchiveFolderKind = 'general' | 'specific' | 'uncategorized';

export interface ArchiveFolderSummary {
  topicId: string;
  name: string;
  slug: string;
  kind: ArchiveFolderKind;
  count: number;
  latestActivity: string;
}

export interface ArchiveFolderDetail {
  topicId: string;
  name: string;
  kind: ArchiveFolderKind;
  subfolders: ArchiveFolderSummary[];
  entries: CaptureSummary[];
}

export type ContentConfidence = 'rich' | 'partial' | 'thin';

export interface CapturePreflight {
  confidence: ContentConfidence;
  title?: string;
  excerpt?: string;
  bodySource?: string;
}

export interface MemoryGraphResponse {
  nodes: {
    id: string;
    label: string;
    kind: CaptureKind;
    topics: { topicId: string; name: string; kind: TopicKind }[];
    capturedAt: string;
    reaction: string | null;
    keyIdea: string | null;
    /** Deterministic semantic-map coordinates, normalized to [0,1]. */
    x: number;
    y: number;
  }[];
  edges: {
    fromItemId: string;
    toItemId: string;
    type: MemoryEdgeType;
    weight: number;
  }[];
  clusters: {
    topicId: string;
    name: string;
    /** 'domain' = coarse field label (zoomed out); 'topic' = specific label (zoomed in). */
    kind: 'domain' | 'topic';
    count: number;
    itemIds: string[];
  }[];
  positions: {
    topicId: string;
    statement: string;
    status: 'ACTIVE' | 'REVISED' | 'ABANDONED';
  }[];
}

export interface MemoryTrendsResponse {
  window: 'week' | 'month';
  captureCount: number;
  sparkline: { day: string; count: number }[];
  themes: {
    topicId: string;
    name: string;
    recent: number;
    prior: number;
    delta: number;
    total: number;
  }[];
  shifts: {
    topicId: string;
    name: string;
    recent: number;
    prior: number;
    delta: number;
    total: number;
  }[];
  recurring: {
    topicId: string;
    name: string;
    recent: number;
    prior: number;
    delta: number;
    total: number;
  }[];
  events: {
    id: string;
    type: string;
    payload: unknown;
    occurredAt: string;
    capturedItemId: string | null;
  }[];
}

export interface UserPreference {
  id: string;
  userId: string;
  insightStyle: InsightStyle;
  preferences: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface OwnerProfile {
  id: string;
  handle: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
  publicNotes?: string | null;
  identitySummary?: string | null;
  email?: string;
  isOnboarded?: boolean;
  /** Account creation date (ISO). Present on the owner's own /api/me/profile. */
  createdAt?: string;
}

export interface ArcBucket {
  label: string;
  count: number;
}

/** The owner's capture history bucketed four ways, each oldest → newest. */
export interface WrappedArcs {
  hours: ArcBucket[];
  days: ArcBucket[];
  weeks: ArcBucket[];
  months: ArcBucket[];
}

/** Personal "Wrapped" stats over the owner's full capture history. */
export interface WrappedStats {
  totalCaptures: number;
  firstCaptureAt: string | null;
  daysSinceFirst: number;
  distinctTopics: number;
  /** Coarse fields (general topics), most-captured first. */
  topFields: { name: string; count: number }[];
  /** Specific sub-topics, most-captured first. */
  topTopics: { name: string; count: number }[];
  newTopicsThisMonth: string[];
  busiestDayOfWeek: string | null;
  busiestHour: number | null;
  /** Captures per hour of day (0–23) and per weekday (index 0 = Sunday). */
  hourHistogram: number[];
  weekdayHistogram: number[];
  formats: { name: string; count: number }[];
  currentStreak: number;
  longestStreak: number;
  arcs: WrappedArcs;
  followingCount: number;
  followerCount: number;
  firstFollow: {
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    followedAt: string;
  } | null;
  friendActivity: {
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    count: number;
  }[];
}

export interface IngestedMetadata {
  id?: string;
  title?: string;
  description?: string;
  canonicalUrl?: string;
  originalUrl: string;
  sourceName?: string;
  contentType?: string;
  imageUrl?: string;
  requiresManualInput: boolean;
}

export interface ContradictionCard {
  itemAId: string;
  itemBId: string;
  labelA: string;
  labelB: string;
  previewA: string;
  previewB: string;
  tension: string;
}

export interface ThreadSynthesis {
  topicId: string;
  topicName: string;
  captureCount: number;
  position: string;
  openQuestion: string;
  /** Capture ids feeding this thread — used to deep-link into companion/Atlas. */
  itemIds: string[];
}

export interface ConvergenceSignal {
  topicId: string;
  topicName: string;
  captureCount: number;
  sourceCount: number;
  signal: string;
}

export interface DormantThread {
  topicId: string;
  topicName: string;
  captureCount: number;
  lastCapturedAt: string;
  daysSilent: number;
}

export interface PositionChallengeItem {
  id: string;
  positionId: string;
  capturedItemId: string | null;
  capturedItem: {
    id: string;
    rawText: string | null;
    contentItem: { title: string } | null;
  } | null;
  tension: string;
  acknowledged: boolean;
  revised: boolean;
  revision: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserPosition {
  id: string;
  userId: string;
  topicId: string;
  topic: { name: string; slug: string };
  statement: string;
  captureCountAtCreation: number;
  status: 'ACTIVE' | 'REVISED' | 'ABANDONED';
  challenges: PositionChallengeItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SocraticMessage {
  id: string;
  threadId: string;
  role: 'USER' | 'COMPANION';
  content: string;
  createdAt: string;
}

export interface SocraticThread {
  id: string;
  userId: string;
  topicId: string;
  topic: { name: string };
  messages: SocraticMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface CompanionMessage {
  id: string;
  threadId: string;
  role: 'USER' | 'COMPANION';
  content: string;
  createdAt: string;
}

export interface CompanionThread {
  id: string;
  userId: string;
  messages: CompanionMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface CapturePositionChallenge {
  challengeId: string;
  positionId: string;
  topicName: string;
  tension: string;
}

export interface FeedItem {
  id: string;
  capturedAt: string;
  title: string | null;
  rawText: string | null;
  keyIdea: string | null;
  kind: CaptureKind;
  topics: { topicId: string; name: string }[];
  author: { id: string; handle: string; displayName: string; avatarUrl: string | null };
}

export interface FeedResponse {
  items: FeedItem[];
  nextCursor: string | null;
}

export interface PulseMapNode {
  id: string;
  /** Normalized [0,1] semantic-map coordinates. */
  x: number;
  y: number;
  kind: CaptureKind;
  topics: { topicId: string; name: string }[];
}

export interface PulseMapCluster {
  topicId: string;
  name: string;
  kind: 'domain' | 'topic';
  count: number;
}

export interface PulseLatestItem {
  id: string;
  title: string;
  keyIdea: string | null;
  kind: CaptureKind;
  capturedAt: string;
  topics: { topicId: string; name: string }[];
}

export interface PulseFriend {
  user: {
    id: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    identitySummary: string | null;
  };
  captureCount: number;
  map: { nodes: PulseMapNode[]; clusters: PulseMapCluster[] };
  latest: PulseLatestItem[];
}

export interface PulseResponse {
  friends: PulseFriend[];
}

export interface PersonalIntelligenceResponse {
  contradictionCards: ContradictionCard[];
  threadSyntheses: ThreadSynthesis[];
  convergenceSignals: ConvergenceSignal[];
  dormantThreads: DormantThread[];
}

export interface UsageMeter {
  kind: 'social_video_transcript' | 'image_describe' | 'companion_message' | 'voice_transcription';
  used: number;
  limit: number;
  period: 'month' | 'day';
}

export interface Entitlements {
  plan: 'FREE' | 'PLUS';
  usage: UsageMeter[];
}
