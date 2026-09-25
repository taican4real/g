import { NextRequest } from "next/server";
import { requireRequestContext } from "@/server/auth/context";
import { listMyEntitlements } from "@/server/payments/entitlements";
import { jsonError, jsonOk } from "@/server/shared/http";

export const runtime = "nodejs";

/** Returns the signed-in student's entitlements and current access status. */
export async function GET(request: NextRequest) {
  const context = await requireRequestContext(request);
  if (!context.ok) return jsonError(context.error);
  return jsonOk(await listMyEntitlements(context.value));
}