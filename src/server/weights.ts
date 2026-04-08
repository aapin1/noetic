export const SIGNAL_WEIGHTS = {
  log: 1,
  rating: 2,
  review: 3,
  ranking: 5,
  save: 1,
  followTopicBoost: 0.5,
} as const;

export const FEED_WEIGHTS = {
  follow: 3,
  similarity: 2,
  topicOverlap: 2,
  recency: 3,
} as const;

export const TOP_FOLLOW_TOPICS = 3;
export const HALF_LIFE_DAYS = 30;
