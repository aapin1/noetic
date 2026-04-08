const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
]);

function normalizeYouTubeUrl(url: URL) {
  const videoId =
    url.hostname === "youtu.be"
      ? url.pathname.replace(/^\//, "")
      : url.searchParams.get("v");

  if (!videoId) {
    return null;
  }

  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function normalizeUrl(input: string) {
  const url = new URL(input);
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if (url.port === "80" || url.port === "443") {
    url.port = "";
  }

  if (url.hostname === "m.youtube.com") {
    url.hostname = "www.youtube.com";
  }

  if (url.hostname === "youtube.com") {
    url.hostname = "www.youtube.com";
  }

  if (url.hostname === "youtu.be" || url.hostname.endsWith("youtube.com")) {
    const normalizedYouTube = normalizeYouTubeUrl(url);

    if (normalizedYouTube) {
      return normalizedYouTube;
    }
  }

  const keptParams = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
    .sort(([left], [right]) => left.localeCompare(right));

  url.search = "";

  for (const [key, value] of keptParams) {
    url.searchParams.append(key, value);
  }

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}
