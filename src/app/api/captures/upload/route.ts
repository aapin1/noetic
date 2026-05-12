import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError, handleRoute, parseJson } from "@/lib/api";
import { requireRequestUserId } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { captureUploadSchema } from "@/server/contracts";

function decodeUploadPayload(imageBase64: string, mimeType?: string): { buffer: Buffer; ext: string } {
  const dataUrlMatch = /^data:([^;]+);base64,(.+)$/s.exec(imageBase64.trim());

  if (dataUrlMatch) {
    const mime = dataUrlMatch[1];
    const b64 = dataUrlMatch[2];
    const ext =
      mime.includes("png") ? "png"
      : mime.includes("webp") ? "webp"
      : "jpg";
    return { buffer: Buffer.from(b64, "base64"), ext };
  }

  const mime = mimeType ?? "image/jpeg";
  const ext =
    mime.includes("png") ? "png"
    : mime.includes("webp") ? "webp"
    : "jpg";

  return { buffer: Buffer.from(imageBase64, "base64"), ext };
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

    const dir = path.join(process.cwd(), "public", "capture-uploads");
    await mkdir(dir, { recursive: true });
    const fname = `${userId.slice(0, 8)}_${Date.now()}_${randomBytes(4).toString("hex")}.${ext}`;
    await writeFile(path.join(dir, fname), buffer);

    const base = getEnv().MNEME_BASE_URL.replace(/\/$/, "");
    const mediaUrl = `${base}/capture-uploads/${encodeURIComponent(fname)}`;

    return { mediaUrl };
  }, 201);
}
