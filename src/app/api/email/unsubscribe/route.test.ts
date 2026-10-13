import { beforeAll, describe, expect, it, vi } from "vitest";

const upsert = vi.fn(async () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { userPreference: { upsert } } }));

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unit";
  process.env.DIRECT_URL ??= "postgres://unit";
  process.env.NEXTAUTH_URL ??= "https://mneme.test";
  process.env.NEXTAUTH_SECRET ??= "unit-test-secret-value";
  process.env.MNEME_BASE_URL ??= "https://mneme.test";
});

describe("/api/email/unsubscribe", async () => {
  const { GET, POST } = await import("./route");
  const { unsubscribeUrl } = await import("@/server/services/first-capture-email");

  it("GET shows a button and changes nothing, so link scanners can't unsubscribe anyone", async () => {
    const res = await GET(new Request(unsubscribeUrl("user_1")));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<form method="post">');
    expect(upsert).not.toHaveBeenCalled();
  });

  it("POST (the button, or a mail app's one-click) turns the emails off", async () => {
    const res = await POST(new Request(unsubscribeUrl("user_1"), { method: "POST" }));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user_1" },
      update: { emailNudges: false },
    }));
  });

  it("rejects a forged link", async () => {
    const res = await POST(new Request("https://mneme.test/api/email/unsubscribe?u=user_2&t=nope", { method: "POST" }));
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});
