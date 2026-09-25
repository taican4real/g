import { NextRequest } from "next/server";
import { jsonError, jsonOk, parseBody } from "@/server/shared/http";
import { registerTeacher } from "@/server/teacher-registration/teacher-registration";
import { teacherRegistrationSchema } from "@/server/validation/teacher-registration.validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await parseBody(request, teacherRegistrationSchema);
  if (!body.ok) return jsonError(body.error);
  const result = await registerTeacher(body.value);
  return result.ok ? jsonOk(result.value, 201) : jsonError(result.error);
}
