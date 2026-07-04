# Deployment Runbook — Production Backend

Production stack for the App Store build:

- **Backend server:** always-on Docker container on **Render** (`render.yaml` + `Dockerfile`). Host-agnostic — the same image runs on Railway/Fly if you ever switch.
- **Database:** **Neon** managed Postgres (pooled + direct connection strings).
- **Image storage:** **Cloudflare R2** (S3-compatible). The app auto-detects R2 from env; without it, uploads fall back to local disk (dev only).

Everything is HTTPS, so the mobile dev-build's iOS ATS restriction and the localhost/LAN reachability problems both go away.

---

## Environment variables

Set these in the Render dashboard (all marked `sync: false` in `render.yaml`). Add the same keys to your local `.env.local` for local testing.

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string (app runtime). |
| `DIRECT_URL` | Neon **direct** connection string (schema push / migrations). |
| `NEXTAUTH_URL` | The service's public URL, e.g. `https://mneme-backend.onrender.com`. |
| `NEXTAUTH_SECRET` | Random secret (Render can generate; or `openssl rand -base64 32`). |
| `MNEME_BASE_URL` | Same public URL as `NEXTAUTH_URL`. |
| `OPENAI_API_KEY` | OpenAI key for embeddings, topic/insight LLM, and image vision. |
| `OPENAI_VISION_MODEL` | Vision model (default `gpt-4o`). |
| `R2_ACCOUNT_ID` | Cloudflare account ID. |
| `R2_ACCESS_KEY_ID` | R2 API token access key. |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret. |
| `R2_BUCKET` | R2 bucket name, e.g. `mneme-captures`. |
| `R2_PUBLIC_URL` | Public base URL for the bucket (r2.dev URL or a custom domain). |

---

## Step 1 — Neon Postgres

1. Create a project at [neon.tech](https://neon.tech).
2. In **Connection Details**, copy two strings:
   - **Pooled** connection (has `-pooler` in the host) → `DATABASE_URL`
   - **Direct** connection (no `-pooler`) → `DIRECT_URL`
   Append `?sslmode=require` if not already present.
3. Push the schema (run from the repo root; uses the direct URL):
   ```bash
   DATABASE_URL="<pooled>" DIRECT_URL="<direct>" npx prisma db push
   ```
   > This project uses `prisma db push` (no migration history yet). Adopting `prisma migrate` is a recommended future improvement for production change tracking.

## Step 2 — Cloudflare R2

1. In the Cloudflare dashboard → **R2** → create a bucket (e.g. `mneme-captures`).
2. Enable public access: bucket **Settings → Public access → R2.dev subdomain** (or connect a custom domain). Copy that public base URL → `R2_PUBLIC_URL`.
3. **R2 → Manage API Tokens → Create API token** (Object Read & Write for this bucket). Copy the **Access Key ID** and **Secret Access Key**.
4. Your **Account ID** is shown in the R2 overview → `R2_ACCOUNT_ID`.

Uploaded images become `${R2_PUBLIC_URL}/capture-uploads/<file>`; the vision step fetches them by URL.

## Step 3 — Render service

1. Push this repo to GitHub (Render deploys from git).
2. Render dashboard → **New → Blueprint** → select the repo. It reads `render.yaml` and creates the `mneme-backend` web service.
3. Fill in every `sync: false` env var from the table above. Leave `NEXTAUTH_URL`/`MNEME_BASE_URL` blank for the very first deploy.
4. Deploy. Once it's live, copy the assigned URL (e.g. `https://mneme-backend.onrender.com`), set `NEXTAUTH_URL` and `MNEME_BASE_URL` to it, and trigger a redeploy.
5. Verify: `curl https://<your-service>.onrender.com/api/health` → `{"status":"ok"}`.

## Step 4 — Point the mobile app at production

Rebuild/relaunch Metro with the production API URL (it's inlined into the JS bundle):

```bash
cd mobile && EXPO_PUBLIC_API_URL="https://<your-service>.onrender.com" npx expo start --dev-client
```

For a distributable build, set `EXPO_PUBLIC_API_URL` in EAS (e.g. `eas env:create` or an `eas.json` build-profile `env`) so release builds bake in the production URL.

---

## Local development

No cloud setup required. With R2 vars unset, image uploads write to `public/capture-uploads/` and are served locally, exactly as before. Set the R2 vars in `.env.local` only if you want to exercise the R2 path locally.

## Notes

- **Prisma engine:** the Dockerfile uses `node:20-slim` (Debian) so Prisma's `native` engine matches the build and runtime platform.
- **Scaling:** `plan: starter` is a single always-on instance. Bump to `standard`/add instances in `render.yaml` as load grows.
- **Cost:** Render starter (~$7/mo) + Neon free tier + R2 (free up to 10GB, no egress fees) — a few dollars a month to start.
