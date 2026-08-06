# CLAUDE.md

Monorepo: Next.js 14 backend (`src/`) + Expo 51 mobile app (`mobile/`). TypeScript throughout, Prisma + PostgreSQL, NextAuth.

## Commands

Docker must be running first (`npm run db:up`).

| Task | Command |
|---|---|
| Start backend | `npm run dev` |
| Start mobile | `cd mobile && EXPO_NO_DOCKER=1 npx expo start --ios -c` |
| Unit tests | `npm run test:unit` |
| Integration tests | `npm run test:integration` |
| DB push | `npm run db:push` |
| Regen Prisma client | `npm run prisma:generate` |

Always run `npm run prisma:generate` after editing `prisma/schema.prisma`. Copy `.env.example` to `.env.local`.

## Path Aliases

- Backend: `@/*` → `src/*`
- Mobile: `@/*` → `mobile/*`
