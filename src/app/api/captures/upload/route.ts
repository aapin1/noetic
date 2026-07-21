import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError, assertBodyWithinLimit, handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { captureUploadSchema } from "@/server/contracts";
import { enforceRateLimit } from "@/server/services/ratelimit";
import { isR2Configured, putCaptureImage } from "@/server/storage";

// Headroom over the schema's 21,000,000-char base64 cap, so the JSON envelope
// and a data-URL prefix still fit. The per-type byte limits after decoding are
// the real product rule; this only stops a hostile body being buffered at all.
const MAX_BODY_BYTES = 24 * 1024 * 1024;

const EXT_BY_MIME = (mime: string): string =>
  mime.includes("png") ? "png"
  : mime.includes("webp") ? "webp"
  : mime.includes("gif") ? "gif"
  : mime.includes("pdf") ? "pdf"
  : "jpg";

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  jpg: "image/jpeg",
  // Shared PDF documents are uploaded here, then captured as a LINK to the
  // stored file so the extraction ladder's PDF pipeline reads them.
  pdf: "application/pdf",
};

function decodeUploadPayload(imageBase64: string, mimeType?: string): { buffer: Buffer; ext: string } {
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(imageBase64.trim());

  const [buffer, declared] = dataUrlMatch
    ? [Buffer.from(dataUrlMatch[2], "base64"), dataUrlMatch[1]]
    : [Buffer.from(imageBase64, "base64"), mimeType ?? "image/jpeg"];

  // Sniff the magic bytes rather than trusting the declared type: iOS share
  // extensions report PDFs under several names (application/pdf, com.adobe.pdf,
  // sometimes nothing), and a PDF mis-filed as an image gets sent to a vision
  // model and fails.
  const ext = buffer.subarray(0, 5).toString("latin1") === "%PDF-" ? "pdf" : EXT_BY_MIME(declared);
  return { buffer, ext };
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    enforceRateLimit(userId, "upload", 40, 5 * 60_000);
    assertBodyWithinLimit(request, MAX_BODY_BYTES);
    const input = await parseJson(request, captureUploadSchema);
    const { buffer, ext } = decodeUploadPayload(input.imageBase64, input.mimeType);

    const maxBytes = ext === "pdf" ? 15 * 1024 * 1024 : 5 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new AppError("FILE_TOO_LARGE", `File exceeds ${ext === "pdf" ? 15 : 5}MB limit`, 413);
    }

    if (buffer.length < 32) {
      throw new AppError("FILE_INVALID", "File payload too small", 422);
    }

    const fname = `${userId.slice(0, 8)}_${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;

    // Production: store in R2 object storage. Dev fallback: local disk under public/.
    if (isR2Configured()) {
      const contentType = CONTENT_TYPE_BY_EXT[ext] ?? "image/jpeg";
      const mediaUrl = await putCaptureImage(`capture-uploads/${fname}`, buffer, contentType);
      return { mediaUrl };
    }

    const dir = path.join(process.cwd(), "public", "capture-uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fname), buffer);

    const base = getEnv().MNEME_BASE_URL.replace(/\/$/, "");
    const mediaUrl = `${base}/capture-uploads/${encodeURIComponent(fname)}`;

    return { mediaUrl };
  }, 201);
}
