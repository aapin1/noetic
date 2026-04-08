export function buildIdentitySummary(args: {
  topTopics: string[];
  topSources: string[];
  recentContentTypes: string[];
}) {
  const topicPart = args.topTopics.length > 0 ? args.topTopics.join(", ") : "no dominant topics yet";
  const sourcePart = args.topSources.length > 0 ? args.topSources.join(", ") : "no dominant sources yet";
  const typePart = args.recentContentTypes.length > 0 ? args.recentContentTypes.join(", ") : "no recent content types yet";

  return `Top topics: ${topicPart}. Core sources: ${sourcePart}. Recent formats: ${typePart}.`;
}
