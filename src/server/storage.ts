import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

/**
 * Turns a stored public URL back into its bucket key, or null when the URL did
 * not come from our bucket.
 *
 * The null case matters: `mediaUrl` also holds remote image URLs the extraction
 * pipeline found on third-party pages, and those must never be handed to a
 * delete call keyed on a path we did not write.
 */
function keyFromPublicUrl(url: string, publicUrl: string): string | null {
  const prefix = `${publicUrl}/`;
  if (!url.startsWith(prefix)) return null;

  const key = decodeURIComponent(url.slice(prefix.length));
  if (!key || key.includes("..")) return null;
  return key;
}

/**
 * Best-effort deletion of previously uploaded objects.
 *
 * Called when a capture or a whole account goes away. Deleting the database row
 * alone used to leave the image, the avatar, or the shared PDF in the bucket
 * forever — which contradicts the privacy policy's promise that deletion is
 * complete, and quietly grows the storage bill with orphans nothing references.
 *
 * Never throws: an object-store hiccup must not turn a successful account
 * deletion into a 500 the user reads as "my data is still there". Failures are
 * logged so the orphans can be swept later.
 */
export async function deleteStoredObjects(urls: (string | null | undefined)[]): Promise<void> {
  const config = getR2Config();
  if (!config) return;

  const keys = [
    ...new Set(
      urls
        .filter((url): url is string => typeof url === "string" && url.length > 0)
        .map((url) => keyFromPublicUrl(url, config.publicUrl))
        .filter((key): key is string => key !== null),
    ),
  ];

  if (keys.length === 0) return;

  // DeleteObjects caps at 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    try {
      await getClient(config).send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "r2_delete_failed",
          count: batch.length,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
