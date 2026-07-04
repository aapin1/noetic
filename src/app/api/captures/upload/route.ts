import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError, handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { captureUploadSchema } from "@/server/contracts";
import { isR2Configured, putCaptureImage } from "@/server/storage";

const EXT_BY_MIME = (mime: string): string =>
  mime.includes("png") ? "png"
  : mime.includes("webp") ? "webp"
  : mime.includes("gif") ? "gif"
  : "jpg";

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  jpg: "image/jpeg",
};

function decodeUploadPayload(imageBase64: string, mimeType?: string): { buffer: Buffer; ext: string } {
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(imageBase64.trim());

  if (dataUrlMatch) {
    return { buffer: Buffer.from(dataUrlMatch[2], "base64"), ext: EXT_BY_MIME(dataUrlMatch[1]) };
  }

  return { buffer: Buffer.from(imageBase64, "base64"), ext: EXT_BY_MIME(mimeType ?? "image/jpeg") };
}

export async function POST(request: Request) {
  return handleRoute(async () => {
    const userId = await requireRequestUserId(request);
    const input = await parseJson(request, captureUploadSchema);
    const { buffer, ext } = decodeUploadPayload(input.imageBase64, input.mimeType);

    if (buffer.length > 5 * 1024 * 1024) {
      throw new AppError("FILE_TOO_LARGE", "Image exceeds 5MB limit", 413);
    }

    if (buffer.length < 32) {
      throw new AppError("FILE_INVALID", "Image payload too small", 422);
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
