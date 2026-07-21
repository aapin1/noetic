import { randomBytes } from "node:crypto";
import { ZodError, type ZodSchema } from "zod";
import { NextResponse } from "next/server";

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiFailure = {
  ok: false;
  error: {
    code: string;
    message: string;
    issues?: unknown;
  };
};

export class AppError extends Error {
  code: string;
  status: number;
  issues?: unknown;
  /** When set, the failure response carries a `Retry-After` header. */
  retryAfterSeconds?: number;

  constructor(code: string, message: string, status = 400, issues?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

/** A 429/503 that tells the client when it's worth trying again. */
export function retryableError(
  code: string,
  message: string,
  status: number,
  retryAfterSeconds: number,
) {
  const error = new AppError(code, message, status);
  error.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return error;
}

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, { status });
}

export function apiFailure(
  code: string,
  message: string,
  status = 400,
  issues?: unknown,
  headers?: Record<string, string>,
) {
  return NextResponse.json<ApiFailure>(
    {
      ok: false,
      error: {
        code,
        message,
        issues,
      },
    },
    headers ? { status, headers } : { status },
  );
}

/**
 * Rejects an oversized body BEFORE `request.json()` buffers it into memory.
 *
 * The Zod `.max()` caps on the base64 upload fields are a *second* line of
 * defence: by the time they run, the whole payload is already resident. On a
 * 512MB instance a handful of concurrent multi-megabyte posts is an OOM, so the
 * cheap header check has to come first.
 *
 * `Content-Length` is absent on chunked requests, in which case we fall through
 * and let the schema caps do the work — the header is an optimization, never
 * the only guard.
 */
export function assertBodyWithinLimit(request: Request, maxBytes: number) {
  const declared = request.headers.get("content-length");
  if (!declared) return;

  const length = Number(declared);
  if (!Number.isFinite(length)) return;

  if (length > maxBytes) {
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      `Request body exceeds ${Math.floor(maxBytes / (1024 * 1024))}MB`,
      413,
    );
  }
}

export async function parseJson<T>(request: Request, schema: ZodSchema<T>) {
  const json = await request.json();
  return schema.parse(json);
}

export async function parseSearchParams<T>(request: Request, schema: ZodSchema<T>) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  return schema.parse(params);
}

/**
 * What the client is told about an unexpected failure. The real error never
 * crosses the wire: raw `Error.message` here has included Prisma query text,
 * upstream URLs with credentials, and filesystem paths. The `requestId` is the
 * handle a user can quote so an operator can find the real stack in the logs.
 */
const INTERNAL_ERROR_MESSAGE =
  "Something went wrong on our end. Please try again.";

function newRequestId() {
  return randomBytes(6).toString("hex");
}

/**
 * Next signals control flow by throwing: `DynamicServerError` when a route reads
 * `request.headers` during the build's static-render probe, and the same pattern
 * for redirect/notFound. They all carry a `digest` string.
 *
 * These must propagate. Swallowing them into a 500 turns a build-time probe into
 * a logged "unhandled error" with a stack trace for every dynamic route, which
 * is both alarming and exactly the kind of noise that hides a real failure.
 */
function isFrameworkSignal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string"
  );
}

export async function handleRoute<T>(handler: () => Promise<T>, status = 200) {
  try {
    const data = await handler();
    return apiSuccess(data, status);
  } catch (error) {
    // Deliberate, client-facing failures pass through untouched — the mobile
    // app matches on these codes and displays these messages verbatim.
    if (error instanceof AppError) {
      return apiFailure(
        error.code,
        error.message,
        error.status,
        error.issues,
        error.retryAfterSeconds
          ? { "Retry-After": String(error.retryAfterSeconds) }
          : undefined,
      );
    }

    if (error instanceof ZodError) {
      return apiFailure("VALIDATION_ERROR", "Request validation failed", 422, error.flatten());
    }

    if (isFrameworkSignal(error)) {
      throw error;
    }

    const requestId = newRequestId();
    console.error(
      JSON.stringify({
        event: "unhandled_error",
        requestId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }),
    );

    return apiFailure("INTERNAL_ERROR", INTERNAL_ERROR_MESSAGE, 500, { requestId });
  }
}
