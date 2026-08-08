/**
 * Seeds the test database with a known account and a small, fixed map so the
 * Maestro flows always sign in to the same screens.
 *
 * Captures are inserted directly rather than pushed through the capture
 * pipeline: the point here is a stable backdrop for UI assertions, and going
 * through the pipeline would mean live LLM calls and a different map each run.
 *
 * Run: npm run e2e:seed   (loads .env.test — never touches the dev database)
 */
import { CaptureKind, InsightType, PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

export const E2E_USER = {
  email: "e2e@mneme.test",
  password: "e2e-password-1234",
  handle: "e2e_tester",
  displayName: "E2E Tester",
};

const DAY_MS = 86_400_000;

const CAPTURES = [
  {
    userTitle: "The Dichotomy of Control",
    rawText:
      "Epictetus argues that freedom comes not from controlling events but from correctly judging what is and is not within our power.",
    keyIdea: "Freedom follows from judging what is up to you.",
    summary: "Epictetus on the dichotomy of control as the root of Stoic freedom.",
    topic: "philosophy",
    mapX: -0.4,
    mapY: 0.25,
  },
  {
    userTitle: "What Is It Like to Be a Bat?",
    rawText:
      "Nagel argues that subjective experience cannot be captured by any objective physical description, however complete.",
    keyIdea: "Objective description leaves out what experience is like.",
    summary: "Nagel's argument that consciousness resists reduction.",
    topic: "philosophy",
    mapX: -0.15,
    mapY: 0.5,
  },
  {
    userTitle: "The Measurement Problem",
    rawText:
      "Decoherence explains the appearance of wavefunction collapse without settling what selects a single outcome.",
    keyIdea: "Decoherence explains the appearance of collapse, not the selection.",
    summary: "Why measurement remains unresolved in quantum foundations.",
    topic: "science",
    mapX: 0.55,
    mapY: -0.3,
  },
  // Backdated history so /today has something to hand back deterministically:
  // the 30-day capture is an exact anniversary, so its selector always picks
  // it over the hash rotation, and the edge below gives it a strongest pair.
  // The 1-day capture plus the fresh ones above make a 2-day streak, which is
  // what renders the StreakMark (MIN_VISIBLE = 2) — the /today entry point.
  {
    userTitle: "Memory Is Reconstructive",
    rawText:
      "Remembering is not playback: each recall rebuilds the event from fragments, and the rebuild overwrites the original.",
    keyIdea: "Each recall rebuilds — and quietly rewrites — the memory.",
    summary: "Why memory behaves like reconstruction rather than recording.",
    topic: "science",
    mapX: 0.35,
    mapY: 0.1,
    daysAgo: 30,
  },
  {
    userTitle: "The Extended Mind",
    rawText:
      "Clark and Chalmers argue cognition leaks into the world: a notebook consulted reliably is memory as much as the hippocampus is.",
    keyIdea: "Tools used reliably are part of the mind, not aids to it.",
    summary: "The extended-mind thesis against skull-bound cognition.",
    topic: "philosophy",
    mapX: -0.25,
    mapY: 0.05,
    daysAgo: 20,
  },
  {
    userTitle: "Flow and Attention",
    rawText:
      "Csikszentmihalyi's flow is attention fully spent on one task — challenge and skill matched closely enough that self-monitoring goes quiet.",
    keyIdea: "Flow is attention with nothing left over to watch itself.",
    summary: "Flow as the full employment of attention.",
    topic: "science",
    mapX: 0.4,
    mapY: -0.55,
    daysAgo: 10,
  },
  {
    userTitle: "Notes on Habit",
    rawText:
      "A habit is a decision made once and then amortized: the cue carries the choice so the moment doesn't have to.",
    keyIdea: "Habits amortize a decision across its repetitions.",
    summary: "Habit as pre-decided behaviour.",
    topic: "philosophy",
    mapX: -0.55,
    mapY: -0.1,
    daysAgo: 1,
  },
];

function assertTestDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("mneme_test")) {
    throw new Error(
      `Refusing to seed: DATABASE_URL is not the test database (${url.replace(/\/\/[^@]*@/, "//***@") || "unset"}).`,
    );
  }
}

async function main() {
  assertTestDatabase();

  // Idempotent: a re-run replaces the account and its captures wholesale, so
  // repeated E2E runs always start from the same map.
  await prisma.user.deleteMany({ where: { email: E2E_USER.email } });

  const user = await prisma.user.create({
    data: {
      email: E2E_USER.email,
      name: E2E_USER.displayName,
      passwordHash: await hash(E2E_USER.password, 12),
      profile: {
        create: {
          handle: E2E_USER.handle,
          displayName: E2E_USER.displayName,
          isOnboarded: true,
        },
      },
      preference: { create: {} },
    },
    select: { id: true },
  });

  const itemIdsByTitle = new Map<string, string>();

  for (const capture of CAPTURES) {
    const topic = await prisma.topic.upsert({
      where: { slug: capture.topic },
      update: {},
      create: { name: capture.topic, slug: capture.topic },
    });

    const daysAgo = "daysAgo" in capture ? (capture.daysAgo as number) : 0;
    const item = await prisma.capturedItem.create({
      data: {
        userId: user.id,
        kind: CaptureKind.TEXT,
        userTitle: capture.userTitle,
        rawText: capture.rawText,
        keyIdea: capture.keyIdea,
        summary: capture.summary,
        terms: [],
        mapX: capture.mapX,
        mapY: capture.mapY,
        capturedAt: new Date(Date.now() - daysAgo * DAY_MS),
        topics: { create: { topicId: topic.id } },
      },
      select: { id: true },
    });
    itemIdsByTitle.set(capture.userTitle, item.id);

    // The insight detail screen renders Insight rows, not keyIdea — without
    // one its "what it means" card is empty.
    await prisma.insight.create({
      data: {
        userId: user.id,
        capturedItemId: item.id,
        type: InsightType.NOVELTY,
        headline: capture.keyIdea,
        body: capture.summary,
        evidence: [],
        strength: 0.8,
      },
    });
  }

  // The anniversary capture's strongest pair, for /today's "these two touch".
  // Newer → older, matching the pipeline's edge-direction convention.
  await prisma.memoryEdge.create({
    data: {
      userId: user.id,
      fromItemId: itemIdsByTitle.get("The Extended Mind")!,
      toItemId: itemIdsByTitle.get("Memory Is Reconstructive")!,
      type: "CONTRADICTS",
      weight: 0.82,
    },
  });

  console.log(`seeded ${E2E_USER.email} with ${CAPTURES.length} captures`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
