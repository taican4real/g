import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";

export const runtime = "nodejs";

export async function GET() {
  let database = "not-configured";
  try {
    if (process.env.DATABASE_URL) {
      await getDb()`select 1`;
      database = "connected";
    }
  } catch {
    database = "unreachable";
  }

  return NextResponse.json({
    status: database === "connected" ? "ok" : "degraded",
    service: "examforge-web",
    database,
    timestamp: new Date().toISOString(),
  });
}
