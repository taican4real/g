import { requireRequestContext } from "@/server/auth/context";
import { assertPlatformAdmin } from "@/server/rbac/authorize";
import { jsonError, jsonOk, parseBody } from "@/server/shared/http";
import { createCurriculum, listCurriculum } from "@/server/curriculum/curriculum";
import { curriculumCreateSchema } from "@/server/validation/curriculum.validation";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

async function requireAdmin(request: NextRequest) {
  const context = await requireRequestContext(request);
  if (!context.ok) return context;
  const allowed = assertPlatformAdmin(context.value);
  return allowed.ok ? context : allowed;
}

export async function GET(request: NextRequest) {
  const context = await requireAdmin(request);
  if (!context.ok) return jsonError(context.error);
  return jsonOk(await listCurriculum());
}

export async function POST(request: NextRequest) {
  const context = await requireAdmin(request);
  if (!context.ok) return jsonError(context.error);
  const body = await parseBody(request, curriculumCreateSchema);
  if (!body.ok) return jsonError(body.error);
  try {
    const result = await createCurriculum(body.value, context.value.userId);
    if (!result.ok) return jsonError(result.error);
    return jsonOk(result.value, 201);
  } catch (error) {
    const message = error instanceof Error && error.message.includes("duplicate")
      ? "This curriculum item already exists"
      : error instanceof Error && error.message.includes("subject is not active")
        ? "The subject is not associated with this examination session"
        : "Curriculum item could not be created";
    return jsonError({ code: message.includes("already") ? "CONFLICT" : "VALIDATION_ERROR", message });
  }
}
