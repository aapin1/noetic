/**
 * Companion: "New chat" reset, and the map context reaching beyond the
 * newest slice of captures.
 */
import { describe, expect, it } from "vitest";
import { DELETE as resetCompanion, GET as getCompanion } from "@/app/api/companion/route";
import { buildCompanionContext } from "@/server/services/companion";
import { authedRequest, createTestUser, prisma, readJson } from "../support/db";

type Thread = { id: string; messages: { role: string; content: string }[] };

describe("companion", () => {
  it("New chat clears the conversation and keeps one thread", async () => {
    const user = await createTestUser();
    const { data: thread } = await readJson<Thread>(await getCompanion(authedRequest(user, "/api/companion")));

    await prisma.companionMessage.createMany({
      data: [
        { threadId: thread.id, role: "USER", content: "old question" },
        { threadId: thread.id, role: "COMPANION", content: "old answer" },
      ],
    });

    const { status, data: fresh } = await readJson<Thread>(
      await resetCompanion(authedRequest(user, "/api/companion", { method: "DELETE" })),
    );

    expect(status).toBe(200);
    expect(fresh.id).toBe(thread.id);
    expect(fresh.messages).toHaveLength(1);
    expect(fresh.messages[0].role).toBe("COMPANION");
    expect(await prisma.companionMessage.count({ where: { threadId: thread.id } })).toBe(1);
  });

  it("lists every capture, with older ones by title under their topic", async () => {
    const user = await createTestUser();
    const topic = await prisma.topic.create({ data: { name: "Stoicism", slug: `stoicism-${user.id}` } });

    // Oldest first, so "Ancient capture" ends up far outside the detail block.
    for (let i = 0; i < 80; i++) {
      await prisma.capturedItem.create({
        data: {
          userId: user.id,
          kind: "TEXT",
          rawText: i === 0 ? "Ancient capture" : `Note ${i}`,
          keyIdea: `idea ${i}`,
          userTitle: i === 1 ? "My renamed note" : null,
          terms: [],
          capturedAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
          ...(i === 0 ? { topics: { create: { topicId: topic.id } } } : {}),
        },
      });
    }

    const context = await buildCompanionContext(user.id, prisma, "anything");

    expect(context).toContain("Rest of the map");
    expect(context).toMatch(/Stoicism: #80 Ancient capture/);
    expect(context).toContain("My renamed note");
  });
});
