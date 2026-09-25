import { changePassword } from "@/server/auth/authentication";
import { getSessionUser, readSessionToken } from "@/server/auth/context";
import type { NextRequest } from "next/server";
import {
  appError,
  clientMeta,
  jsonError,
  jsonOk,
  parseBody,
} from "@/server/shared/http";
import { changePasswordSchema } from "@/server/validation/auth.validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const token = readSessionToken(request);
  if (!token) return jsonError(appError("UNAUTHENTICATED", "Not signed in"));
  const sessionUser = await getSessionUser(token);
  if (!sessionUser) {
    return jsonError(appError("UNAUTHENTICATED", "Session is invalid or expired"));
  }

  const body = await parseBody(request, changePasswordSchema);
  if (!body.ok) return jsonError(body.error);

  const result = await changePassword({
    userId: sessionUser.user.id,
    sessionId: sessionUser.session.sessionId,
    currentPassword: body.value.currentPassword,
    newPassword: body.value.newPassword,
    ...clientMeta(request),
  });
  if (!result.ok) return jsonError(result.error);

  return jsonOk({ ok: true });
}