import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCompanionResponse } from "@/server/cognition/llm";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("generateCompanionResponse", () => {
  it("returns null when OPENAI_API_KEY is not set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await generateCompanionResponse({
      contextBlock: "map",
      conversationHistory: [],
      userMessage: "hello",
    });
    expect(result).toBeNull();
  });

  it("includes the focus block in the system prompt when provided", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "The tension is X." } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateCompanionResponse({
      contextBlock: "--- KNOWLEDGE MAP ---\nfull map\n--- END MAP ---",
      focusBlock: '--- FOCUS FOR THIS REPLY ---\n1. "Capture A" — idea A\n2. "Capture B" — idea B\n--- END FOCUS ---',
      conversationHistory: [],
      userMessage: "Find the connection",
    });

    expect(result).toBe("The tension is X.");
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const systemMessage = body.messages[0].content as string;
    expect(systemMessage).toContain("--- FOCUS FOR THIS REPLY ---");
    expect(systemMessage).toContain("Capture A");
    expect(systemMessage).toContain("Ground your answer specifically in the focus items above");
  });

  it("omits the focus section entirely when no focus block is given", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "General answer." } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateCompanionResponse({
      contextBlock: "map",
      conversationHistory: [],
      userMessage: "What's new?",
    });

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const systemMessage = body.messages[0].content as string;
    expect(systemMessage).not.toContain("FOCUS FOR THIS REPLY");
  });
});
