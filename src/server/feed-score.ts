import { FEED_WEIGHTS } from "@/server/weights";

export function calculateFeedScore(args: {
  followWeight: number;
  similarityWeight: number;
  topicOverlap: number;
  recencyDecay: number;
}) {
  return (
    args.followWeight * FEED_WEIGHTS.follow +
    args.similarityWeight * FEED_WEIGHTS.similarity +
    args.topicOverlap * FEED_WEIGHTS.topicOverlap +
    args.recencyDecay * FEED_WEIGHTS.recency
  );
}
