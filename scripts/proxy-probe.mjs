/**
 * Measures a residential proxy against the two targets the capture pipeline
 * actually needs: YouTube InnerTube (playability + English captions) and a
 * TikTok page fetch (media URL for the Groq ASR tier). Run it against each
 * candidate provider's trial before buying — generic proxy benchmarks don't
 * test these endpoints.
 *
 *   RESIDENTIAL_PROXY_URL='http://user-{session}:pass@host:port' node scripts/proxy-probe.mjs
 *   node scripts/proxy-probe.mjs --direct   # sanity-check without a proxy
 *
 * Provider templates ({session} is filled per probe, giving a fresh exit IP):
 *   Webshare     http://USER-{session}:PASS@p.webshare.io:80
 *   Decodo       http://user-USER-session-{session}:PASS@gate.decodo.com:7000
 *   Oxylabs      http://customer-USER-sessid-{session}:PASS@pr.oxylabs.io:7777
 *   Bright Data  http://brd-customer-ID-zone-residential-session-{session}:PASS@brd.superproxy.io:33335
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const direct = process.argv.includes("--direct");
let template = process.env.RESIDENTIAL_PROXY_URL?.trim();
// Fall back to .env.local so the URL (it embeds the proxy password) never has
// to be typed on a command line. Only this one key is read; nothing is printed.
if (!template && !direct) {
  try {
    const line = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n")
      .find((l) => l.startsWith("RESIDENTIAL_PROXY_URL="));
    template = line?.slice("RESIDENTIAL_PROXY_URL=".length).trim().replace(/^["']|["']$/g, "");
  } catch {
    // no .env.local — the error below explains what to set
  }
}
if (!direct && !template) {
  console.error("Set RESIDENTIAL_PROXY_URL (or pass --direct to test without a proxy).");
  process.exit(1);
}

const IOS_UA = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";
const IOS_CONTEXT = { client: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2", hl: "en" } };
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const YT_VIDEOS = ["aircAruvnKk", "IV3dnLzthDA", "iCvmsMzlF7o", "QsBT5EQt348", "rA5qnZUXcqo", "ZoqgAy3h4OM"];
const TIKTOK_URLS = [
  "https://www.tiktok.com/@nasa/video/7268215971266333994",
  "https://www.tiktok.com/@bbcnews/video/7412063889593109793",
];

function session() {
  if (direct) return { fetch: (url, init, ms) => fetchWithTimeout(url, init, ms), close: async () => {} };
  const agent = new ProxyAgent(template.replaceAll("{session}", randomBytes(6).toString("hex")));
  return {
    fetch: async (url, init = {}, ms = 12000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        return await undiciFetch(url, { ...init, dispatcher: agent, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    },
    close: () => agent.close(),
  };
}

async function fetchWithTimeout(url, init = {}, ms = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeYouTube(videoId) {
  const s = session();
  const t0 = Date.now();
  try {
    const res = await s.fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": IOS_UA },
      body: JSON.stringify({ context: IOS_CONTEXT, videoId }),
    });
    if (!res.ok) return { verdict: `http_${res.status}`, ms: Date.now() - t0 };
    const data = await res.json();
    const status = data?.playabilityStatus?.status ?? "unknown";
    if (status !== "OK") return { verdict: `playability_${status}`, ms: Date.now() - t0 };
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const en = tracks.find((t) => t.languageCode?.startsWith("en"));
    if (!en?.baseUrl) return { verdict: "no_english_tracks", ms: Date.now() - t0 };
    const cap = await s.fetch(en.baseUrl, { headers: { "user-agent": IOS_UA } });
    const chars = cap.ok ? (await cap.text()).length : 0;
    return { verdict: chars > 500 ? "PASS" : "captions_empty", ms: Date.now() - t0 };
  } catch (e) {
    return { verdict: `error:${e.message.slice(0, 40)}`, ms: Date.now() - t0 };
  } finally {
    await s.close().catch(() => {});
  }
}

async function probeTikTok(url) {
  const s = session();
  const t0 = Date.now();
  try {
    const res = await s.fetch(url, { headers: { "user-agent": BROWSER_UA, accept: "text/html" }, redirect: "follow" });
    if (!res.ok) return { verdict: `http_${res.status}`, ms: Date.now() - t0 };
    const html = await res.text();
    const hasMedia = /"playAddr":"/.test(html) || /"downloadAddr":"/.test(html);
    return { verdict: hasMedia ? "PASS" : "no_media_url", ms: Date.now() - t0 };
  } catch (e) {
    return { verdict: `error:${e.message.slice(0, 40)}`, ms: Date.now() - t0 };
  } finally {
    await s.close().catch(() => {});
  }
}

console.log(`Probing ${direct ? "DIRECT (no proxy)" : "proxy"} — fresh session per request\n`);

let ytPass = 0;
const latencies = [];
for (const id of YT_VIDEOS) {
  const r = await probeYouTube(id);
  if (r.verdict === "PASS") {
    ytPass++;
    latencies.push(r.ms);
  }
  console.log(`  youtube ${id}  ${String(r.ms).padStart(5)}ms  ${r.verdict}`);
}

let ttPass = 0;
for (const url of TIKTOK_URLS) {
  const r = await probeTikTok(url);
  if (r.verdict === "PASS") ttPass++;
  console.log(`  tiktok  ${url.split("/")[3]}  ${String(r.ms).padStart(5)}ms  ${r.verdict}`);
}

const median = latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] ?? 0;
console.log(`\nYouTube InnerTube : ${ytPass}/${YT_VIDEOS.length} (median ${median}ms)`);
console.log(`TikTok media URL  : ${ttPass}/${TIKTOK_URLS.length}`);
console.log(
  ytPass === YT_VIDEOS.length
    ? "VERDICT: exits are clean for the capture pipeline."
    : ytPass >= YT_VIDEOS.length - 1
      ? "VERDICT: mostly clean — the in-code retry should absorb the misses."
      : "VERDICT: too many flagged exits — try another provider/pool.",
);
