/**
 * The capture pipeline, end to end, against a real database.
 *
 * TEXT captures on purpose: a LINK capture would also scrape the live web,
 * which adds a second source of non-determinism that fixtures don't cover. With
 * TEXT the only outside call is OpenAI, and that is replayed — so classify →
 * embed → position → connect is fully deterministic here.
 *
 * Needs recorded fixtures. If a prompt changed, the failure will say so and
 * name the re-record command.
 */
import { describe, expect, it } from "vitest";
import { POST as postCapture, GET as listCapturesRoute } from "@/app/api/captures/route";
import { GET as getCaptureRoute } from "@/app/api/captures/[id]/route";
import { GET as getGraph } from "@/app/api/memory/graph/route";
import { authedRequest, createTestUser, flushBackgroundWork, prisma, readJson } from "../support/db";

type CaptureResponse = {
  id: string;
  title: string;
  summary: string | null;
  topics: { topicId: string; name?: string }[];
  mapX: number | null;
  mapY: number | null;
};

type CaptureDetail = CaptureResponse & {
  insights: { type: string; headline: string; body: string; strength: number }[];
};

/**
 * The insight polish (which carries the READING) and the mirror run after the
 * capture response with `void`. Replayed they land in milliseconds; while
 * recording they are real round-trips, and truncating the database out from
 * under them would skip the mirror's LLM call entirely (no rows, no call, no
 * fixture).
 */
const BACKGROUND_LLM_MS = process.env.LLM_FIXTURES?.startsWith("record") ? 12_000 : 500;
const RECORDING_TIMEOUT_MS = 90_000;

/** The old NOVELTY bodies promised value later; the footnote must not. */
const PROMISE = /save (a few )?more|as you add more|patterns will|will start to (emerge|show)|the system will/i;

async function captureText(user: Awaited<ReturnType<typeof createTestUser>>, text: string) {
  const { status, data } = await readJson<CaptureResponse>(
    await postCapture(authedRequest(user, "/api/captures", { body: { kind: "TEXT", text } })),
  );
  expect(status).toBe(201);
  await flushBackgroundWork(BACKGROUND_LLM_MS);
  return data.id;
}

async function readDetail(user: Awaited<ReturnType<typeof createTestUser>>, id: string) {
  const { data } = await readJson<CaptureDetail>(
    await getCaptureRoute(authedRequest(user, `/api/captures/${id}`), { params: { id } }),
  );
  return data;
}

const STOICISM_TEXT =
  "Epictetus argues that freedom comes not from controlling events but from " +
  "correctly judging what is and is not within our power. The dichotomy of " +
  "control is the load-bearing claim of Stoic ethics.";

const QUANTUM_TEXT =
  "The measurement problem in quantum mechanics asks why a superposition " +
  "collapses to a single outcome on observation. Decoherence explains the " +
  "appearance of collapse without resolving what selects the outcome.";

const ATTENTION_TEXT =
  "Attention is the scarce resource, not time. Deep work is the practice of " +
  "protecting long uninterrupted blocks of it, and most modern tools are " +
  "designed to fragment exactly that.";

const HABITS_TEXT =
  "Willpower is a poor foundation for change; environment design is a better " +
  "one. Make the good habit the default and the bad one require effort, and " +
  "behaviour follows without a fight.";

describe("capture pipeline", () => {
  it("persists a text capture with topics and an embedding", async () => {
    const user = await createTestUser();

    const { status, data } = await readJson<CaptureResponse>(
      await postCapture(
        authedRequest(user, "/api/captures", {
          body: { kind: "TEXT", text: STOICISM_TEXT },
        }),
      ),
    );

    expect(status).toBe(201);
    expect(data.id).toBeTruthy();

    const row = await prisma.capturedItem.findUnique({
      where: { id: data.id },
      include: { topics: { include: { topic: true } } },
    });

    expect(row?.userId).toBe(user.id);
    expect(row?.kind).toBe("TEXT");
    expect(row?.rawText).toBe(STOICISM_TEXT);

    // The embedding is what the map and every connection are derived from, so
    // an empty one means the pipeline silently fell back to keywords.
    expect(row?.embedding.length).toBeGreaterThan(0);

    // Classified into at least one topic, and not into a generic junk label.
    expect(row?.topics.length).toBeGreaterThan(0);
    const names = row?.topics.map((t) => t.topic.name.toLowerCase()) ?? [];
    expect(names.every((n) => n.length > 1)).toBe(true);
  });

  it("defers map position to the graph read, then persists it", async () => {
    const user = await createTestUser();

    const { data } = await readJson<CaptureResponse>(
      await postCapture(
        authedRequest(user, "/api/captures", {
          body: { kind: "TEXT", text: QUANTUM_TEXT },
        }),
      ),
    );

    // Capture deliberately leaves the node unpositioned — the semantic layout
    // seats it later so the capture doesn't wait on SMACOF (cognition.ts).
    const afterCapture = await prisma.capturedItem.findUnique({ where: { id: data.id } });
    expect(afterCapture?.mapX).toBeNull();

    await getGraph(authedRequest(user, "/api/memory/graph"));

    // The graph read runs the layout and writes the coordinates back, so a
    // refetch never reshuffles the map.
    const afterGraph = await prisma.capturedItem.findUnique({ where: { id: data.id } });
    expect(afterGraph?.mapX).not.toBeNull();
    expect(afterGraph?.mapY).not.toBeNull();
    expect(Number.isFinite(afterGraph?.mapX ?? NaN)).toBe(true);
    expect(Number.isFinite(afterGraph?.mapY ?? NaN)).toBe(true);
  });

  it("keeps map coordinates stable across repeated graph reads", async () => {
    const user = await createTestUser();

    await postCapture(
      authedRequest(user, "/api/captures", { body: { kind: "TEXT", text: STOICISM_TEXT } }),
    );
    await postCapture(
      authedRequest(user, "/api/captures", { body: { kind: "TEXT", text: QUANTUM_TEXT } }),
    );

    await getGraph(authedRequest(user, "/api/memory/graph"));
    const first = await prisma.capturedItem.findMany({
      where: { userId: user.id },
      select: { id: true, mapX: true, mapY: true },
      orderBy: { id: "asc" },
    });

    await getGraph(authedRequest(user, "/api/memory/graph"));
    const second = await prisma.capturedItem.findMany({
      where: { userId: user.id },
      select: { id: true, mapX: true, mapY: true },
      orderBy: { id: "asc" },
    });

    expect(first.every((r) => r.mapX != null)).toBe(true);
    expect(second).toEqual(first);
  });

  it("scopes captures to their owner", async () => {
    const owner = await createTestUser({ handle: "owner_scope" });
    const stranger = await createTestUser({ handle: "stranger_scope" });

    await postCapture(
      authedRequest(owner, "/api/captures", { body: { kind: "TEXT", text: STOICISM_TEXT } }),
    );

    const { data: mine } = await readJson<unknown[]>(
      await listCapturesRoute(authedRequest(owner, "/api/captures")),
    );
    const { data: theirs } = await readJson<unknown[]>(
      await listCapturesRoute(authedRequest(stranger, "/api/captures")),
    );

    expect(mine).toHaveLength(1);
    expect(theirs).toHaveLength(0);
  });

  it("rejects a text capture with no text", async () => {
    const user = await createTestUser();

    const { status, error } = await readJson(
      await postCapture(authedRequest(user, "/api/captures", { body: { kind: "TEXT" } })),
    );

    expect(status).toBe(422);
    expect(error?.code).toBe("VALIDATION_ERROR");
    expect(await prisma.capturedItem.count()).toBe(0);
  });

  it("reads a first capture from its content alone, and leads with that reading", async () => {
    const user = await createTestUser();
    const id = await captureText(user, STOICISM_TEXT);

    const detail = await readDetail(user, id);

    // The one thing a first capture has is its content, so the first insight
    // is the claim it makes and the catch in it — not a note that the graph
    // is empty.
    const [lead] = detail.insights;
    expect(lead.type).toBe("READING");
    expect(lead.headline.length).toBeGreaterThan(20);
    expect(lead.body.length).toBeGreaterThan(20);
    expect(lead.strength).toBe(1);

    // The graph fact is still there, as a footnote that promises nothing.
    const novelty = detail.insights.find((row) => row.type === "NOVELTY");
    expect(novelty).toBeTruthy();
    expect(novelty!.body).not.toMatch(PROMISE);
    expect(detail.insights.indexOf(novelty!)).toBeGreaterThan(0);
  }, RECORDING_TIMEOUT_MS);

  it("writes the mirror on the third capture, leads with it there, and never writes a second", async () => {
    const user = await createTestUser();
    const ids = [
      await captureText(user, STOICISM_TEXT),
      await captureText(user, QUANTUM_TEXT),
      await captureText(user, ATTENTION_TEXT),
    ];

    const mirrors = await prisma.insight.findMany({ where: { userId: user.id, type: "MIRROR" } });
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0].capturedItemId).toBe(ids[2]);
    expect(mirrors[0].headline.length).toBeGreaterThan(20);
    expect(mirrors[0].body.length).toBeGreaterThan(20);
    // Second person: it is about the reader, not the items.
    expect(mirrors[0].headline).toMatch(/\byou\b|\byou'/i);
    expect((mirrors[0].evidence as { captureIds: string[] }).captureIds.sort()).toEqual([...ids].sort());

    // It outranks the capture's own reading on the screen.
    const detail = await readDetail(user, ids[2]);
    expect(detail.insights[0].type).toBe("MIRROR");
    expect(detail.insights[1].type).toBe("READING");

    // The first two captures carry no mirror.
    const earlier = await readDetail(user, ids[0]);
    expect(earlier.insights.some((row) => row.type === "MIRROR")).toBe(false);

    // One per account: the fourth capture does not write another.
    await captureText(user, HABITS_TEXT);
    expect(await prisma.insight.count({ where: { userId: user.id, type: "MIRROR" } })).toBe(1);
  }, RECORDING_TIMEOUT_MS);

  it("records the client clock for the streak day", async () => {
    const user = await createTestUser();

    await postCapture(
      authedRequest(user, "/api/captures", {
        body: { kind: "TEXT", text: STOICISM_TEXT, tzOffsetMinutes: -240 },
      }),
    );

    // rememberTzOffset is fired with `void` so the capture never waits on it.
    await flushBackgroundWork();

    const preference = await prisma.userPreference.findUnique({ where: { userId: user.id } });
    expect(preference?.tzOffsetMinutes).toBe(-240);
  });
});
