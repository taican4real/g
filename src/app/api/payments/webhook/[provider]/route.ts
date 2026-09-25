import { NextRequest } from "next/server";
import { handlePaymentWebhook } from "@/server/payments/payments";
import { jsonError, jsonOk } from "@/server/shared/http";
import { webhookProviderSchema } from "@/server/validation/payment.validation";

export const runtime = "nodejs";

/**
 * Provider webhook endpoint. Unauthenticated by design — authenticity comes
 * from the provider's HMAC signature over the raw body, verified by the
 * provider adapter. Responses are idempotent so providers can safely retry:
 * a duplicate webhook still returns 200.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerName } = await params;
  const parsedName = webhookProviderSchema.safeParse(providerName);
  if (!parsedName.success) {
    return jsonError({ code: "NOT_FOUND", message: "Unknown payment provider" });
  }

  // Raw body is required for signature verification; JSON parsing happens only
  // after the signature has been checked.
  const rawBody = await request.text();

  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of request.headers) headers[name] = value;

  let payload: unknown;
  try {
    payload = rawBody.length ? JSON.parse(rawBody) : {};
  } catch {
    return jsonError({ code: "VALIDATION_ERROR", message: "Webhook body must be valid JSON" });
  }

  const result = await handlePaymentWebhook(parsedName.data, rawBody, headers, payload);
  if (!result.ok) return jsonError(result.error);
  return jsonOk({ outcome: result.value.outcome, paymentId: result.value.paymentId });
}