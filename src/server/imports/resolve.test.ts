import { describe, expect, it, vi } from "vitest";

/**
 * The model backstop behind the keyless resolvers. What matters here is that
 * it is asked once per work (a sync of 50 diary entries must not become 50
 * calls for the same film) and that a failure is a miss, never a throw on the
 * capture path.
 */

const identifyWork = vi.fn(async (..._args: unknown[]) => null as string | null);
vi.mock("@/server/cognition/llm", () => ({ identifyWork: (...a: unknown[]) => identifyWork(...a) }));

import { recallWork } from "./resolve";

describe("recallWork", () => {
  it("returns the model's description and asks only once per work", async () => {
    identifyWork.mockResolvedValue("A 2025 horror film by Ryan Coogler.");

    const first = await recallWork({ kind: "film", title: "Sinners", year: 2025 });
    const again = await recallWork({ kind: "film", title: "sinners", year: 2025 });

    expect(first).toBe("A 2025 horror film by Ryan Coogler.");
    expect(again).toBe("A 2025 horror film by Ryan Coogler.");
    expect(identifyWork).toHaveBeenCalledTimes(1);
    expect(identifyWork).toHaveBeenCalledWith({ kind: "film", title: "Sinners", year: 2025 });
  });

  it("keeps different works apart", async () => {
    identifyWork.mockResolvedValue("The 1980 one.");
    await recallWork({ kind: "film", title: "Ronin", year: 1998 });
    await recallWork({ kind: "film", title: "Ronin", year: 2004 });
    expect(identifyWork).toHaveBeenCalledTimes(2);
  });

  it("a model failure is a miss, not a throw", async () => {
    identifyWork.mockRejectedValue(new Error("timeout"));
    await expect(recallWork({ kind: "book", title: "The Long Ships" })).resolves.toBeNull();
  });
});
