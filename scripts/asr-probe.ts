/**
 * Exercises the Groq ASR tier in isolation. Almost every YouTube video carries
 * auto-captions, so the caption path wins and this tier — the fallback that
 * matters for caption-less and caption-blocked videos — is never reached by a
 * normal battery run. This probe pulls the same lowest-bitrate audio stream
 * attemptYouTubeAsr would use and hands it to the production transcriber.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/asr-probe.ts <videoId> [...]
 */
import { createProxySession } from "@/server/proxyFetch";
import { transcribeAudioUrl } from "@/server/transcribe";

const CLIENT = {
  ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  context: { client: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2", hl: "en" } },
};

async function main() {
  for (const videoId of process.argv.slice(2)) {
    const session = createProxySession();
    try {
      const res = await session.fetch(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": CLIENT.ua },
          body: JSON.stringify({ context: CLIENT.context, videoId }),
        },
        6000,
      );
      const data = (await res.json()) as any;
      const formats = (data?.streamingData?.adaptiveFormats ?? [])
        .filter((f: any) => f.url && f.mimeType?.startsWith("audio/"))
        .sort((a: any, b: any) => (a.bitrate ?? Infinity) - (b.bitrate ?? Infinity));
      const format = formats[0];
      const seconds = Number(data?.videoDetails?.lengthSeconds);
      if (!format?.url) {
        console.log(`${videoId}  no audio stream (playability=${data?.playabilityStatus?.status})`);
        continue;
      }
      console.log(
        `${videoId}  len=${seconds}s  bitrate=${format.bitrate}  size=${format.contentLength}B  ${format.mimeType?.slice(0, 30)}`,
      );

      const t0 = Date.now();
      const result = await transcribeAudioUrl({
        url: format.url,
        session,
        headers: { "user-agent": CLIENT.ua },
        filename: format.mimeType?.includes("webm") ? "audio.webm" : "audio.m4a",
        downloadTimeoutMs: 10000,
      });
      const ms = Date.now() - t0;
      if (!result) {
        console.log(`  ✗ ASR returned undefined after ${ms}ms (see asr_miss log above)`);
        continue;
      }
      // 256KB leading read: how much of the video the transcript actually covers.
      const covered = Number(format.contentLength)
        ? ((256 * 1024) / Number(format.contentLength)) * seconds
        : NaN;
      console.log(
        `  ✓ ${ms}ms  partial=${result.partial}  chars=${result.text.length}  ` +
          `covers≈${Number.isFinite(covered) ? `${Math.round(covered)}s of ${seconds}s` : "?"}`,
      );
      console.log(`    head: ${JSON.stringify(result.text.slice(0, 200))}`);
      console.log(`    tail: ${JSON.stringify(result.text.slice(-120))}`);
    } finally {
      await session.close().catch(() => {});
    }
  }
  process.exit(0);
}

main();
