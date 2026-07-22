/**
 * Stage-by-stage extraction probe. Unlike extraction-battery.ts (pass/fail on
 * the final body length), this prints what each stage of the capture pipeline
 * actually produced, so a bad "About this capture" can be attributed to the
 * stage that lost the content:
 *
 *   stage 1  fetchMetadata          → bodySource, body text, proxy/supadata use
 *   stage 2  scoreContentConfidence → rich/partial/thin gate
 *   stage 3  cleanContentMetadata   → the LLM excerpt that becomes the summary
 *   stage 4  the capture-summary rule applied to that excerpt
 *
 * Every function called here is the production one; nothing is reimplemented.
 * The diagnostic JSON lines the pipeline already logs (extraction, yt_asr,
 * asr_miss, yt_transcript_miss) are captured per URL and printed alongside.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/stage-probe.ts
 *   NO_PROXY_RUN=1 npx dotenv -e .env.local -- npx tsx scripts/stage-probe.ts
 *   ... scripts/stage-probe.ts <url> [...]
 */
import { writeFileSync } from "node:fs";
import { cleanContentMetadata } from "@/server/cognition/llm";
import { fetchMetadata, scoreContentConfidence } from "@/server/metadata";

const SOURCES: { label: string; url: string }[] = [
  { label: "yt/veritasium 10:19", url: "https://www.youtube.com/watch?v=XeSu9fBJ2sI" },
  { label: "yt/3blue1brown 9:52", url: "https://www.youtube.com/watch?v=fNk_zzaMoSs" },
  { label: "yt/chalmers 9:19", url: "https://www.youtube.com/watch?v=C5DfnIjZPGw" },
  { label: "substack/acx", url: "https://www.astralcodexten.com/p/being-john-rawls" },
  { label: "substack/exp-history", url: "https://www.experimental-history.com/p/the-rise-and-fall-of-peer-review" },
  { label: "substack/noahpinion", url: "https://www.noahpinion.blog/p/the-fall-of-the-nerds" },
  { label: "news/arstechnica", url: "https://arstechnica.com/science/2026/07/an-orbiting-disco-ball-gave-einsteins-theory-its-most-precise-test-yet/" },
  { label: "news/bbc", url: "https://www.bbc.com/news/articles/c0qyq800n44o" },
  { label: "news/nytimes", url: "https://www.nytimes.com/2026/02/18/science/evolution-cells-asgard.html" },
  { label: "other/medium", url: "https://medium.com/@erikdkennedy/7-rules-for-creating-gorgeous-ui-part-1-559d4e805cda" },
  { label: "other/reddit", url: "https://www.reddit.com/r/explainlikeimfive/comments/1lqx7c/eli5_why_is_the_sky_blue/" },
  { label: "other/arxiv-pdf", url: "https://arxiv.org/pdf/1706.03762" },
  { label: "other/apple-podcast", url: "https://podcasts.apple.com/us/podcast/lex-fridman-podcast/id1434243584" },
];

/** The capture-summary rule from captureItem(), applied to the cleaned excerpt:
 * this is the string the insight screen shows as "About this capture". */
function captureSummaryOf(description: string | null | undefined): string | null {
  if (!description || /^https?:\/\//i.test(description)) return null;
  if (description.length <= 400) return description;
  const head = description.slice(0, 400);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "), head.lastIndexOf(".\n"));
  return end >= 120 ? head.slice(0, end + 1) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const sources = args.length > 0 ? args.map((url) => ({ label: url, url })) : SOURCES;
  if (process.env.NO_PROXY_RUN) delete process.env.RESIDENTIAL_PROXY_URL;

  console.log(
    `stage probe — proxy ${process.env.RESIDENTIAL_PROXY_URL ? "ENABLED" : "disabled"}, ` +
      `groq ${process.env.GROQ_API_KEY ? "on" : "off"}, supadata ${process.env.SUPADATA_API_KEY ? "on" : "off"}, ` +
      `openai ${process.env.OPENAI_API_KEY ? "on" : "off"}\n`,
  );

  // Capture the pipeline's own structured log lines per URL.
  const realLog = console.log.bind(console);
  let events: string[] = [];
  console.log = (...a: unknown[]) => {
    const s = String(a[0]);
    if (s.startsWith("{") && s.includes('"event"')) events.push(s);
    else realLog(...a);
  };

  const rows: Record<string, unknown>[] = [];
  for (const { label, url } of sources) {
    events = [];
    const t0 = Date.now();
    const { metadata, requiresManualInput } = await fetchMetadata(url).catch((e) => {
      realLog(`  threw: ${e}`);
      return { metadata: undefined, requiresManualInput: true };
    });
    const extractMs = Date.now() - t0;
    const body = metadata?.bodyText ?? "";
    const confidence = metadata ? scoreContentConfidence(metadata) : "thin";

    const t1 = Date.now();
    const cleaned = metadata?.title
      ? await cleanContentMetadata({
          rawTitle: metadata.title,
          rawDescription: metadata.description,
          rawAuthor: metadata.authorName,
          siteName: metadata.siteName,
          bodyText: metadata.bodyText,
        })
      : null;
    const cleanMs = Date.now() - t1;
    const summary = captureSummaryOf(cleaned?.excerpt ?? metadata?.description ?? null);

    realLog(`\n■ ${label}  (${url})`);
    realLog(`  1 extract  ${extractMs}ms  src=${metadata?.bodySource ?? "-"}  body=${body.length}ch  proxy=${metadata?.usedProxy ? "y" : "n"}  supadata=${metadata?.usedSupadata ? "y" : "n"}  manual=${requiresManualInput}`);
    realLog(`    title    ${metadata?.title ?? "(none)"}`);
    realLog(`    body[0:220] ${JSON.stringify(body.slice(0, 220))}`);
    realLog(`    body[tail]  ${JSON.stringify(body.slice(-160))}`);
    realLog(`  2 confidence  ${confidence}`);
    realLog(`  3 clean    ${cleanMs}ms  title=${cleaned?.title ?? "(null)"}`);
    realLog(`    excerpt  ${cleaned?.excerpt ?? "(null)"}`);
    realLog(`  4 ABOUT    ${summary ?? "(none — screen asks the user)"}`);
    for (const e of events) realLog(`    log: ${e}`);

    rows.push({ label, url, extractMs, cleanMs, bodySource: metadata?.bodySource ?? null, bodyChars: body.length,
      usedProxy: !!metadata?.usedProxy, usedSupadata: !!metadata?.usedSupadata, confidence,
      title: metadata?.title ?? null, cleanedTitle: cleaned?.title ?? null, excerpt: cleaned?.excerpt ?? null,
      about: summary, bodyHead: body.slice(0, 400), events });
  }

  console.log = realLog;
  const out = process.env.PROBE_OUT ?? "/tmp/stage-probe.json";
  writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(`\nwrote ${out}`);
}

main();
