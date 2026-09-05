import { NotificationType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { DbClient } from "@/server/db";
import { createNotification, fitTitle, PUSH_TITLE_MAX, sentence } from "@/server/services/notifications";

/**
 * A push title has one line on the lock screen. These pin the two rules every
 * title follows: it fits the banner without the OS adding an ellipsis, and it
 * reads as a sentence rather than a lowercase fragment.
 */

/** A db that records the row createNotification would write. */
function recordingDb(actorName: string | null) {
  let row: { title: string; body: string } | null = null;
  const db = {
    user: {
      findUnique: async () => (actorName === null ? null : { name: actorName, profile: null }),
    },
    notification: {
      create: async ({ data }: { data: { title: string; body: string } }) => {
        row = { title: data.title, body: data.body };
        return data;
      },
    },
  } as unknown as DbClient;
  return { db, row: () => row };
}

const SOCIAL: NotificationType[] = ["NEW_FOLLOW", "NEW_LIKE", "NEW_COMMENT", "NEW_REPLY", "RANKING_UPDATED"];
const ALL = Object.values(NotificationType);

describe("push titles", () => {
  it("prefers the specific title only while it fits the banner", () => {
    expect(fitTitle("Attention is picking up", "A thread is picking up")).toBe("Attention is picking up");
    expect(fitTitle("Existential themes in film is picking up", "A thread is picking up"))
      .toBe("A thread is picking up");
  });

  it("starts every title with a capital letter", () => {
    expect(sentence("three days quiet")).toBe("Three days quiet");
    expect(sentence("Already fine")).toBe("Already fine");
  });

  it("keeps every templated title inside the budget, even for a long actor name", async () => {
    const name = "Maximilian Bartholomew-Featherstonehaugh";
    for (const type of ALL) {
      const { db, row } = recordingDb(SOCIAL.includes(type) ? name : null);
      await createNotification({ db, recipientId: "u1", actorId: SOCIAL.includes(type) ? "a1" : undefined, type, deepLink: "/today" });
      const written = row();
      expect(written, type).not.toBeNull();
      expect(written!.title.length, `${type}: ${written!.title}`).toBeLessThanOrEqual(PUSH_TITLE_MAX);
      expect(written!.title, type).not.toContain("…");
      expect(written!.title[0], type).toBe(written!.title[0].toUpperCase());
      expect(written!.body, type).not.toContain("—");
    }
  });

  it("names the actor when the name is short enough", async () => {
    const { db, row } = recordingDb("Evan");
    await createNotification({ db, recipientId: "u1", actorId: "a1", type: "NEW_FOLLOW", deepLink: "/profile/a1" });
    expect(row()!.title).toBe("Evan followed you");
  });
});
