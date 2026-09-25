import { requireRequestContext } from "@/server/auth/context";
import { assertPlatformAdmin } from "@/server/rbac/authorize";
import { jsonError, jsonOk, parseBody } from "@/server/shared/http";
import { updateCurriculum, type CurriculumEntity } from "@/server/curriculum/curriculum";
import { curriculumUpdateSchema } from "@/server/validation/curriculum.validation";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
const entities = new Set<CurriculumEntity>(["examType", "examSession", "subject", "examSubject", "syllabus", "syllabusSubject", "topic", "subtopic", "learningObjective"]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ entity: string; id: string }> }) {
  const context = await requireRequestContext(request);
  if (!context.ok) return jsonError(context.error);
  const allowed = assertPlatformAdmin(context.value);
  if (!allowed.ok) return jsonError(allowed.error);
  const { entity, id } = await params;
  if (!entities.has(entity as CurriculumEntity)) return jsonError({ code: "NOT_FOUND", message: "Curriculum entity not found" });
  const body = await parseBody(request, curriculumUpdateSchema);
  if (!body.ok) return jsonError(body.error);
  try {
    const result = await updateCurriculum(entity as CurriculumEntity, id, body.value, context.value.userId);
    if (!result.ok) return jsonError(result.error);
    return jsonOk(result.value);
  } catch {
    return jsonError({ code: "VALIDATION_ERROR", message: "Curriculum item could not be updated" });
  }
}
