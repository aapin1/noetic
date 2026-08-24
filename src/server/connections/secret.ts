import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
// process.env rather than the validated `env` proxy: that one demands the whole
// server config, and this module is exercised by unit tests with only a secret.

/**
 * Provider tokens at rest. AES-256-GCM under a key derived from
 * NEXTAUTH_SECRET, so there is nothing new to configure: the same secret that
 * already guards every session guards these. Rotating NEXTAUTH_SECRET
 * invalidates stored tokens — people reconnect, which is the right outcome.
 */

function key(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required to store connection secrets");
  return Buffer.from(hkdfSync("sha256", secret, "mneme-connections", "provider-secret", 32));
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${body.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function openSecret(sealed: string): string | null {
  const [v, iv, body, tag] = sealed.split(".");
  if (v !== "v1" || !iv || !body || !tag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
