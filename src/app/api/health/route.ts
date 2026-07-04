import { NextResponse } from "next/server";

// Lightweight liveness probe for the container platform's health checks.
// Intentionally does no DB work so a healthy web process isn't marked down
// by transient database latency.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
