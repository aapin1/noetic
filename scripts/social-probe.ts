/**
 * Diagnostic probe for TikTok/Instagram extraction through the residential
 * proxy (RESIDENTIAL_PROXY_URL). Prints what each endpoint serves; no paid
 * tiers are touched.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/social-probe.ts
 */
import { createProxySession } from "@/server/proxyFetch";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const TT_ID = process.argv[2] ?? "7106594312292453675";
const IG_SC = process.argv[3] ?? "DJQJeVQPnI4";

function count(html: string, needle: string) {
  return (html.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
}

async function main() {
  const session = createProxySession();
  console.log("viaProxy:", session.viaProxy);
  const probes: { label: string; url: string; ua: string; keys: string[] }[] = [
    { label: "tiktok page (iphone)", url: `https://www.tiktok.com/@tiktok/video/${TT_ID}`, ua: IPHONE_UA, keys: ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "subtitleInfos", "playAddr", "webapp.reflow.video.detail", "webapp.video-detail", "verify", "captcha"] },
    { label: "tiktok page (desktop)", url: `https://www.tiktok.com/@tiktok/video/${TT_ID}`, ua: DESKTOP_UA, keys: ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "subtitleInfos", "playAddr", "webapp.video-detail", "verify", "captcha"] },
    { label: "tiktok player api", url: `https://www.tiktok.com/player/api/v1/items?item_ids=${TT_ID}`, ua: IPHONE_UA, keys: ["url_list", "play_url", "desc"] },
    { label: "tiktok oembed", url: `https://www.tiktok.com/oembed?url=https://www.tiktok.com/@tiktok/video/${TT_ID}`, ua: IPHONE_UA, keys: ["title", "author_name"] },
    { label: "ig reel page (desktop)", url: `https://www.instagram.com/reel/${IG_SC}/`, ua: DESKTOP_UA, keys: ["og:title", "og:description", "video_url", "login", "xdt_shortcode_media", "\"caption\""] },
    { label: "ig reel page (iphone)", url: `https://www.instagram.com/reel/${IG_SC}/`, ua: IPHONE_UA, keys: ["og:title", "og:description", "video_url", "login", "xdt_shortcode_media"] },
    { label: "ig embed captioned", url: `https://www.instagram.com/reel/${IG_SC}/embed/captioned/`, ua: DESKTOP_UA, keys: ["video_url", "class=\"Caption\"", "contextJSON", "shortcode_media", "og:description", "login"] },
  ];
  for (const p of probes) {
    const t0 = Date.now();
    try {
      const res = await session.fetch(p.url, { headers: { "user-agent": p.ua, accept: "text/html,application/json;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" }, redirect: "follow" }, 15000);
      const body = await res.text();
      console.log(`${p.label.padEnd(24)} http=${res.status} bytes=${body.length} ${Date.now() - t0}ms  ` + p.keys.map((k) => `${k}=${count(body, k)}`).join(" "));
    } catch (e) {
      console.log(`${p.label.padEnd(24)} threw ${(e as Error).message}`);
    }
  }
  // IG GraphQL (doc_id POST) through the proxy
  try {
    const t0 = Date.now();
    const body = new URLSearchParams({
      variables: JSON.stringify({ shortcode: IG_SC, fetch_tagged_user_count: null, hoisted_comment_id: null, hoisted_reply_id: null }),
      doc_id: "8845758582119845",
      lsd: "AVqbxe3J_YA",
    }).toString();
    const res = await session.fetch("https://www.instagram.com/graphql/query", { method: "POST", headers: { "user-agent": DESKTOP_UA, "content-type": "application/x-www-form-urlencoded", "x-ig-app-id": "936619743392459", "x-fb-lsd": "AVqbxe3J_YA", "x-asbd-id": "129477", origin: "https://www.instagram.com", referer: `https://www.instagram.com/reel/${IG_SC}/` }, body }, 15000);
    const text = await res.text();
    console.log(`${"ig graphql doc_id".padEnd(24)} http=${res.status} bytes=${text.length} ${Date.now() - t0}ms  xdt_shortcode_media=${count(text, "xdt_shortcode_media")} video_url=${count(text, "video_url")} is_video=${count(text, "is_video")} head=${text.slice(0, 120).replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(`ig graphql doc_id threw ${(e as Error).message}`);
  }
  await session.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
