import { NextRequest } from "next/server";
import { requireRequestContext } from "@/server/auth/context";
import {
  createPaymentSession,
  listStudentPayments,
} from "@/server/payments/payments";
import { jsonError, jsonOk, parseBody } from "@/server/shared/http";
import { createPaymentSessionSchema } from "@/server/validation/payment.validation";

export const runtime = "nodejs";

async function requireStudent(request: NextRequest) {
  const context = await requireRequestContext(request);
  if (!context.ok) return context;
  if (!context.value.roles.includes("student")) {
    return { ok: false as const, error: { code: "FORBIDDEN" as const, message: "Student access is required" } };
  }
  return context;
}

export async function POST(request: NextRequest) {
  const context = await requireStudent(request);
  if (!context.ok) return jsonError(context.error);
  const body = await parseBody(request, createPaymentSessionSchema);
  if (!body.ok) return jsonError(body.error);
  const result = await createPaymentSession(context.value, body.value.registrationId);
  return result.ok ? jsonOk(result.value, 201) : jsonError(result.error);
}

export async function GET(request: NextRequest) {
  const context = await requireStudent(request);
  if (!context.ok) return jsonError(context.error);
  return jsonOk(await listStudentPayments(context.value));
}