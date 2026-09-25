import { NextRequest } from "next/server";
import { requireRequestContext } from "@/server/auth/context";
import { assertTenantScoped } from "@/server/rbac/authorize";
import { jsonError, jsonOk } from "@/server/shared/http";
import { listTeacherRegistrations } from "@/server/teacher-registration/teacher-registration";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await requireRequestContext(request);
  if (!context.ok) return jsonError(context.error);
  const tenant = assertTenantScoped(context.value);
  if (!tenant.ok) return jsonError(tenant.error);
  const result = await listTeacherRegistrations(context.value);
  return result.ok ? jsonOk(result.value) : jsonError(result.error);
}
