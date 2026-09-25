import { NextRequest, NextResponse } from "next/server";
import { login } from "@/server/auth/authentication";
import { sessionCookieName, sessionCookieOptions } from "@/server/auth/sessions";
import { clientMeta, jsonError, parseBody } from "@/server/shared/http";
import { registerStudent } from "@/server/registration/registration";
import { registrationSchema } from "@/server/validation/registration.validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await parseBody(request, registrationSchema);
  if (!body.ok) return jsonError(body.error);
  const result = await registerStudent(body.value);
  if (!result.ok) return jsonError(result.error);

  const authenticated = await login({ identifier: body.value.email, password: body.value.password, ...clientMeta(request) });
  const response = NextResponse.json({ data: { ...result.value, signedIn: authenticated.ok } }, { status: 201 });
  if (authenticated.ok) response.cookies.set(sessionCookieName(), authenticated.value.token, sessionCookieOptions(Math.max(1, Math.floor((authenticated.value.expiresAt.getTime() - Date.now()) / 1000))));
  return response;
}
