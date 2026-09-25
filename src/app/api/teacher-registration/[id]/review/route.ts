import { NextRequest } from "next/server";
import { requireRequestContext } from "@/server/auth/context";
import { assertTenantScoped } from "@/server/rbac/authorize";
import { jsonError, jsonOk, parseBody } from "@/server/shared/http";
import { reviewTeacherRegistration } from "@/server/teacher-registration/teacher-registration";
import { teacherReviewSchema } from "@/server/validation/teacher-registration.validation";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await requireRequestContext(request);
  if (!context.ok) return jsonError(context.error);
  const tenant = assertTenantScoped(context.value);
  if (!tenant.ok) return jsonError(tenant.error);
  const body = await parseBody(request, teacherReviewSchema);
  if (!body.ok) return jsonError(body.error);
  const { id } = await params;
  const result = await reviewTeacherRegistration(context.value, id, body.value);
  return result.ok ? jsonOk(result.value) : jsonError(result.error);
}
