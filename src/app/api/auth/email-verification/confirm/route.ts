import { confirmEmailVerification } from "@/server/auth/recovery";
import { jsonError, jsonOk, parseBody } from "@/server/shared/http";
import { verifyEmailConfirmSchema } from "@/server/validation/auth.validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await parseBody(request, verifyEmailConfirmSchema);
  if (!body.ok) return jsonError(body.error);

  const result = await confirmEmailVerification(body.value.token);
  if (!result.ok) return jsonError(result.error);

  return jsonOk({ ok: true });
}