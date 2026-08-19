# Mneme

A memory for everything you read, watch, and think. Save a link, a video, a PDF, or a stray thought; Mneme reads it, connects it to what you already believe, and draws a living map of your thinking.

Live on the [App Store](https://apps.apple.com/us/app/mneme-your-brain-mapped/id6791384175). Marketing site and legal pages in [`website/`](website).

## What's in the app

- **Atlas** — every capture lands as a point on a semantic map, near the ideas it already agrees with. Topics form on their own from embeddings and drift as you change; zoom into one and it opens as a smaller map.
- **Mind** — what is moving through your knowledge: threads picking up speed, two saves that quietly disagree, positions worth taking. Backed by an LLM intelligence layer with a content-addressed cache.
- **You** — the long view of your own attention: timeline, streaks, terrain, a yearly "wrapped".
- **Pulse** — a slow social check-in from the few people you follow. Not a feed.
- Plus: share-sheet capture, bulk import (bookmarks HTML, Pocket CSV, URL lists), full export, resurfacing push notifications, Sign in with Apple, a Socratic companion, and an optional Plus tier via RevenueCat.

## Repository layout

```
src/            Next.js 14 backend (API routes under src/app/api, services under src/server)
prisma/         Prisma schema (PostgreSQL)
mobile/         Expo 57 / React Native app (expo-router), Maestro E2E flows in mobile/.maestro
tests/          Integration and DB-backed tests for the backend
scripts/        E2E build/run scripts, E2E seed data, and manual extraction-pipeline probes
website/        Static marketing site (mneme-app.com)
docs/           Deployment runbook, mobile dev-client guide, IAP setup, design docs (docs/design)
render.yaml     Render blueprint for the production backend (Docker)
```

Path aliases: `@/*` → `src/*` in the backend, `@/*` → `mobile/*` in the app.

## Running locally

Prerequisites: Node 20+, Docker, Xcode (for the iOS dev client).

```bash
# Backend
cp .env.example .env.local        # fill in OPENAI_API_KEY etc.
npm install
npm run db:up                     # starts Postgres (dev + test) and pushes the schema
npm run dev                       # http://localhost:3000

# Mobile
cd mobile
cp .env.example .env              # or export EXPO_PUBLIC_API_URL for the backend URL
npm install
EXPO_NO_DOCKER=1 npx expo start --ios -c
```

The mobile app is a custom dev client rather than Expo Go; see [`docs/running-mobile.md`](docs/running-mobile.md) for building it and pointing it at the deployed backend.

After editing `prisma/schema.prisma`, run `npm run prisma:generate`.

## Tests

| Command | What it runs |
|---|---|
| `npm run test:unit` | Vitest unit tests for `src/server` and `mobile/lib` |
| `npm run test:integration` | API-route tests against the test database |
| `npm run test:db` | Capture-pipeline tests with recorded LLM fixtures |
| `npm run test:mobile` | Jest tests for the mobile app |
| `npm run e2e` | Maestro end-to-end suite against a seeded local backend |
| `npm run verify` | Typecheck + all of the above except E2E |

## Deployment

The backend runs as an always-on Docker service on Render with a Neon Postgres database and Cloudflare R2 for image storage. Secrets are set in the Render dashboard, never committed. See [`docs/deployment.md`](docs/deployment.md).

The mobile app ships through EAS Build / EAS Update (`mobile/eas.json`).
