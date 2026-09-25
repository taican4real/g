import { requestEmailVerification } from "@/server/auth/recovery";
import { jsonError, jsonOk, parseBody } from "@/server/shared/http";
import { verifyEmailRequestSchema } from "@/server/validation/auth.validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await parseBody(request, verifyEmailRequestSchema);
  if (!body.ok) return jsonError(body.error);

  const result = await requestEmailVerification(body.value.email);
  if (!result.ok) return jsonError(result.error);

  return jsonOk({
    ok: true,
    verificationUrl: result.value.verificationUrl,
  });
}