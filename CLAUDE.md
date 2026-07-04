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

## Working Guidelines

**Think before coding.** State assumptions explicitly. If multiple interpretations exist, present them. If something is unclear, ask — don't guess.

**Simplicity first.** Minimum code that solves the problem. No speculative features, abstractions, or configurability that wasn't asked for.

**Surgical changes.** Touch only what the task requires. Don't improve adjacent code. Remove only the dead code YOUR changes created — mention pre-existing dead code instead of deleting it.

**Verify completion.** Define what done looks like before starting. For multi-step tasks, state a brief plan with a check per step.
