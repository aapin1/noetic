import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getEnv } from "@/lib/env";

/**
 * Object storage for capture images. Uses Cloudflare R2 (S3-compatible) in
 * production; when R2 is not configured, callers fall back to local disk so
 * local development works without any cloud setup.
 */

let cachedClient: S3Client | null = null;

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
};

/** Returns the R2 config only when every required value is present. */
export function getR2Config(): R2Config | null {
  const env = getEnv();
  if (
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET &&
    env.R2_PUBLIC_URL
  ) {
    return {
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
      publicUrl: env.R2_PUBLIC_URL.replace(/\/$/, ""),
    };
  }
  return null;
}

export function isR2Configured(): boolean {
  return getR2Config() !== null;
}

function getClient(config: R2Config): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return cachedClient;
}

/**
 * Uploads an image buffer to R2 under `key` and returns its public URL.
 * Throws if R2 is not configured — call isR2Configured() first.
 */
export async function putCaptureImage(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const config = getR2Config();
  if (!config) {
    throw new Error("R2 is not configured");
  }

  await getClient(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  return `${config.publicUrl}/${key}`;
}
