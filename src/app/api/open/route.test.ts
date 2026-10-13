import { describe, expect, it } from "vitest";
import { GET } from "./route";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";

describe("/api/open", () => {
  it("hands a phone straight to the app", () => {
    const res = GET(new Request("https://mneme.test/api/open", { headers: { "user-agent": IPHONE } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("mneme://");
  });

  it("gives a computer a page instead of a dead link", async () => {
    const res = GET(new Request("https://mneme.test/api/open", { headers: { "user-agent": MAC } }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("apps.apple.com");
  });
});
