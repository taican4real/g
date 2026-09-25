import { confirmPasswordReset } from "@/server/auth/recovery";
import { jsonError, jsonOk, parseBody } from "@/server/shared/http";
import { resetConfirmSchema } from "@/server/validation/auth.validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await parseBody(request, resetConfirmSchema);
  if (!body.ok) return jsonError(body.error);

  const result = await confirmPasswordReset({
    token: body.value.token,
    newPassword: body.value.newPassword,
  });
  if (!result.ok) return jsonError(result.error);

  return jsonOk({ ok: true });
}