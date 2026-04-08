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

  constructor(code: string, message: string, status = 400, issues?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, { status });
}

export function apiFailure(code: string, message: string, status = 400, issues?: unknown) {
  return NextResponse.json<ApiFailure>(
    {
      ok: false,
      error: {
        code,
        message,
        issues,
      },
    },
    { status },
  );
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

export async function handleRoute<T>(handler: () => Promise<T>, status = 200) {
  try {
    const data = await handler();
    return apiSuccess(data, status);
  } catch (error) {
    if (error instanceof AppError) {
      return apiFailure(error.code, error.message, error.status, error.issues);
    }

    if (error instanceof ZodError) {
      return apiFailure("VALIDATION_ERROR", "Request validation failed", 422, error.flatten());
    }

    if (error instanceof Error) {
      return apiFailure("INTERNAL_ERROR", error.message, 500);
    }

    return apiFailure("INTERNAL_ERROR", "Unknown server error", 500);
  }
}
