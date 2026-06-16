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

export interface CaptureTopic {
  topicId: string;
  name: string;
  slug: string;
  weight: number;
}

export interface CaptureContent {
  id: string;
  title: string;
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

export interface MemoryGraphResponse {
  nodes: {
    id: string;
    label: string;
    kind: CaptureKind;
    topics: { topicId: string; name: string }[];
    capturedAt: string;
    reaction: string | null;
    keyIdea: string | null;
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
    count: number;
    itemIds: string[];
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
}

export interface ConvergenceSignal {
  topicId: string;
  topicName: string;
  captureCount: number;
  sourceCount: number;
  signal: string;
}

export interface EvolutionPeriod {
  month: string;
  captureCount: number;
  keyIdeas: string[];
}

export interface EvolutionArc {
  topicId: string;
  topicName: string;
  captureCount: number;
  periods: EvolutionPeriod[];
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

export interface CapturePositionChallenge {
  challengeId: string;
  positionId: string;
  topicName: string;
  tension: string;
}

export interface PersonalIntelligenceResponse {
  contradictionCards: ContradictionCard[];
  threadSyntheses: ThreadSynthesis[];
  convergenceSignals: ConvergenceSignal[];
  evolutionArcs: EvolutionArc[];
  dormantThreads: DormantThread[];
}
