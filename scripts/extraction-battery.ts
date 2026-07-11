/**
 * Manual extraction battery — runs the full fetchMetadata ladder against real
 * URLs of every content type and prints what came back. Not a unit test: it
 * hits live sites, so run it by hand when touching the extraction pipeline.
 *
 *   npx tsx scripts/extraction-battery.ts             # direct (no proxy)
 *   RESIDENTIAL_PROXY_URL=... npx tsx scripts/extraction-battery.ts
 *   npx tsx scripts/extraction-battery.ts <url> [...] # custom URLs
 */
import { fetchMetadata, scoreContentConfidence } from "@/server/metadata";

// minChars: what a healthy extraction must produce. 0 = informational only
// (the item prints its result but can't fail the battery) — used for sources
// that are inherently short (tweets aside, set >0) or currently hard-blocked
// upstream (Reddit's unauthenticated JSON API 403s from most IPs in 2026;
// the ladder degrades to thin + user-context there by design).
const DEFAULT_BATTERY: { label: string; url: string; minChars: number }[] = [
  { label: "youtube talk (captions)", url: "https://www.youtube.com/watch?v=arj7oStGLkU", minChars: 800 },
  { label: "youtube music video", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", minChars: 150 },
  { label: "youtu.be short link", url: "https://youtu.be/arj7oStGLkU", minChars: 800 },
  { label: "wikipedia", url: "https://en.wikipedia.org/wiki/Spaced_repetition", minChars: 800 },
  { label: "substack essay", url: "https://www.experimental-history.com/p/28-slightly-rude-notes-on-writing", minChars: 800 },
  { label: "personal blog (pg)", url: "https://www.paulgraham.com/greatwork.html", minChars: 800 },
  { label: "news article", url: "https://www.bbc.co.uk/news/articles/c2dy6e8klw0o", minChars: 800 },
  { label: "medium post", url: "https://medium.com/@erikdkennedy/7-rules-for-creating-gorgeous-ui-part-1-559d4e805cda", minChars: 800 },
  { label: "podcast page", url: "https://podcasts.apple.com/us/podcast/lex-fridman-podcast/id1434243584", minChars: 150 },
  { label: "tweet", url: "https://x.com/naval/status/1002103360646823936", minChars: 30 },
  { label: "reddit thread", url: "https://www.reddit.com/r/explainlikeimfive/comments/1lqx7c/eli5_why_is_the_sky_blue/", minChars: 0 },
];

async function main() {
  const args = process.argv.slice(2);
  const battery = args.length > 0 ? args.map((url) => ({ label: url, url, minChars: 150 })) : DEFAULT_BATTERY;
  const proxied = Boolean(process.env.RESIDENTIAL_PROXY_URL);
  console.log(`extraction battery — proxy ${proxied ? "ENABLED" : "disabled"}\n`);

  let failures = 0;
  for (const { label, url, minChars } of battery) {
    const started = Date.now();
    try {
      const { metadata, requiresManualInput } = await fetchMetadata(url);
      const confidence = metadata ? scoreContentConfidence(metadata) : "thin";
      const bodyLen = metadata?.bodyText?.length ?? 0;
      const ok = Boolean(metadata) && !requiresManualInput && bodyLen >= minChars;
      if (!ok && minChars > 0) failures++;
      console.log(
        [
          ok ? "✅" : minChars === 0 ? "ℹ️" : "❌",
          label.padEnd(26),
          `conf=${confidence.padEnd(7)}`,
          `src=${(metadata?.bodySource ?? "-").padEnd(11)}`,
          `body=${String(metadata?.bodyText?.length ?? 0).padStart(5)}ch`,
          `proxy=${metadata?.usedProxy ? "y" : "n"}`,
          `supadata=${metadata?.usedSupadata ? "y" : "n"}`,
          `${Date.now() - started}ms`,
          `title=${metadata?.title?.slice(0, 60) ?? "(none)"}`,
        ].join("  "),
      );
    } catch (err) {
      failures++;
      console.log(`❌ ${label.padEnd(26)}  threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n${battery.length - failures}/${battery.length} passed`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
