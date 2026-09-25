import {
  getSessionUser,
  listActiveMemberships,
  readSessionToken,
  resolveTenantContext,
} from "@/server/auth/context";
import type { NextRequest } from "next/server";
import { appError, jsonError, jsonOk } from "@/server/shared/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = readSessionToken(request);
  if (!token) {
    return jsonError(appError("UNAUTHENTICATED", "Not signed in"));
  }
  const sessionUser = await getSessionUser(token);
  if (!sessionUser) {
    return jsonError(appError("UNAUTHENTICATED", "Session is invalid or expired"));
  }

  const contextResult = await resolveTenantContext(
    sessionUser.session,
  );
  const memberships = await listActiveMemberships(sessionUser.user.id);
  const activeTenant =
    memberships.find(
      (m) => m.tenantId === sessionUser.session.activeTenantId,
    ) ?? null;

  return jsonOk({
    user: sessionUser.user,
    session: {
      sessionId: sessionUser.session.sessionId,
      activeTenantId: sessionUser.session.activeTenantId,
      authMethod: sessionUser.session.authMethod,
    },
    memberships,
    activeTenant,
    context: contextResult.ok ? contextResult.value : null,
    tenantRequired: !contextResult.ok,
  });
}