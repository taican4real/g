import { NextResponse } from "next/server";
import { listTeacherRegistrationOptions } from "@/server/teacher-registration/teacher-registration";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ data: await listTeacherRegistrationOptions() });
}
