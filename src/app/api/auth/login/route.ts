import { login } from "@/server/auth/authentication";
import {
  sessionCookieName,
  sessionCookieOptions,
  sessionTtlSeconds,
} from "@/server/auth/sessions";
import {
  clientMeta,
  jsonError,
  jsonOk,
  parseBody,
} from "@/server/shared/http";
import { loginSchema } from "@/server/validation/auth.validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await parseBody(request, loginSchema);
  if (!body.ok) return jsonError(body.error);

  const meta = clientMeta(request);
  const result = await login({
    identifier: body.value.identifier,
    password: body.value.password,
    ...meta,
  });
  if (!result.ok) return jsonError(result.error);

  const { token, ...payload } = result.value;
  const response = jsonOk(payload);
  response.cookies.set(
    sessionCookieName(),
    token,
    sessionCookieOptions(sessionTtlSeconds()),
  );
  return response;
}