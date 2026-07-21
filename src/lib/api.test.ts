import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, assertBodyWithinLimit, handleRoute, retryableError } from "./api";

beforeEach(() => {
  // The redaction path logs the real error; keep the test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleRoute", () => {
  it("returns the handler's data on success", async () => {
    const response = await handleRoute(async () => ({ hello: "world" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, data: { hello: "world" } });
  });

  // The mobile client matches on these codes and shows these messages verbatim,
  // so this branch must stay exactly as it was.
  it("passes a deliberate AppError through untouched", async () => {
    const response = await handleRoute(async () => {
      throw new AppError("USAGE_LIMIT", "You've reached this month's limit.", 429);
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: "USAGE_LIMIT", message: "You've reached this month's limit." },
    });
  });

  it("reports validation failures with their flattened issues", async () => {
    const response = await handleRoute(async () => {
      z.object({ name: z.string() }).parse({ name: 42 });
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.issues).toBeDefined();
  });

  describe("unexpected failures", () => {
    const leaky = () => {
      throw new Error(
        'Invalid `prisma.user.findUnique()` at /app/src/server/db.ts:12 — connect ECONNREFUSED 10.0.0.4:5432',
      );
    };

    it("never puts the underlying message on the wire", async () => {
      const response = await handleRoute(async () => leaky());
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.message).not.toMatch(/prisma|ECONNREFUSED|10\.0\.0\.4|\/app\//i);
    });

    it("hands back a request id the operator can trace", async () => {
      const response = await handleRoute(async () => leaky());
      const body = await response.json();

      expect(body.error.issues.requestId).toMatch(/^[0-9a-f]+$/);
    });

    it("logs the real error against that same id", async () => {
      const response = await handleRoute(async () => leaky());
      const { error } = await response.json();

      const logged = vi.mocked(console.error).mock.calls.map(([line]) => String(line)).join("\n");
      expect(logged).toContain(error.issues.requestId);
      expect(logged).toContain("ECONNREFUSED");
    });

    // Next throws these to signal control flow (dynamic rendering, redirect,
    // notFound). Turning them into a 500 both breaks the signal and logs a
    // stack trace for every dynamic route on every build.
    it("lets a framework signal propagate instead of reporting it", async () => {
      const signal = Object.assign(new Error("Dynamic server usage: headers"), {
        digest: "DYNAMIC_SERVER_USAGE",
      });

      await expect(handleRoute(async () => {
        throw signal;
      })).rejects.toBe(signal);

      expect(console.error).not.toHaveBeenCalled();
    });

    it("handles a thrown non-Error without crashing", async () => {
      const response = await handleRoute(async () => {
        throw "just a string";
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INTERNAL_ERROR" },
      });
    });
  });

  it("emits Retry-After for a retryable failure", async () => {
    const response = await handleRoute(async () => {
      throw retryableError("RATE_LIMIT", "Slow down.", 429, 42);
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
  });

  it("rounds a fractional Retry-After up to a whole second", async () => {
    const response = await handleRoute(async () => {
      throw retryableError("RATE_LIMIT", "Slow down.", 429, 0.2);
    });

    expect(response.headers.get("Retry-After")).toBe("1");
  });
});

describe("assertBodyWithinLimit", () => {
  const requestWith = (headers: Record<string, string>) =>
    new Request("http://localhost/api/upload", { method: "POST", headers });

  it("accepts a body inside the limit", () => {
    expect(() => assertBodyWithinLimit(requestWith({ "content-length": "1024" }), 2048)).not.toThrow();
  });

  it("rejects an oversized body before it is ever read", () => {
    expect(() => assertBodyWithinLimit(requestWith({ "content-length": "4096" }), 2048))
      .toThrow(AppError);
  });

  // Chunked requests carry no Content-Length; the schema's own caps remain the
  // backstop, so this must not become a way to reject legitimate uploads.
  it("defers to the schema when the header is absent", () => {
    expect(() => assertBodyWithinLimit(requestWith({}), 2048)).not.toThrow();
  });

  it("defers to the schema when the header is not a number", () => {
    expect(() => assertBodyWithinLimit(requestWith({ "content-length": "banana" }), 2048)).not.toThrow();
  });
});
