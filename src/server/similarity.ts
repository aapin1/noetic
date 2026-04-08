export type WeightedVector = Record<string, number>;

export function cosineSimilarity(left: WeightedVector, right: WeightedVector) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (const key of keys) {
    const leftValue = left[key] ?? 0;
    const rightValue = right[key] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function scaleSimilarityScore(score: number) {
  return Math.round(Math.max(0, Math.min(1, score)) * 10000) / 100;
}

export function overlappingWeights(left: WeightedVector, right: WeightedVector, prefix: string) {
  const overlaps = Object.keys(left)
    .filter((key) => key.startsWith(prefix) && (right[key] ?? 0) > 0)
    .map((key) => ({
      key,
      score: (left[key] ?? 0) + (right[key] ?? 0),
    }))
    .sort((a, b) => b.score - a.score);

  return overlaps;
}
