import { NextResponse } from "next/server";
import { listRegistrationOptions } from "@/server/registration/registration";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ data: await listRegistrationOptions() });
}
