import { getSessionUser, readSessionToken } from "@/server/auth/context";
import { activateTenant } from "@/server/tenants/tenants";
import type { NextRequest } from "next/server";
import {
  appError,
  clientMeta,
  jsonError,
  jsonOk,
  parseBody,
} from "@/server/shared/http";
import { activateTenantSchema } from "@/server/validation/tenant.validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const token = readSessionToken(request);
  if (!token) return jsonError(appError("UNAUTHENTICATED", "Not signed in"));
  const sessionUser = await getSessionUser(token);
  if (!sessionUser) {
    return jsonError(appError("UNAUTHENTICATED", "Session is invalid or expired"));
  }

  const body = await parseBody(request, activateTenantSchema);
  if (!body.ok) return jsonError(body.error);

  const result = await activateTenant({
    userId: sessionUser.user.id,
    sessionId: sessionUser.session.sessionId,
    tenantId: body.value.tenantId,
    ...clientMeta(request),
  });
  if (!result.ok) return jsonError(result.error);

  return jsonOk({
    context: result.value.context,
    tenant: result.value.tenant,
  });
}