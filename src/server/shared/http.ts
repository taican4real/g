import { NextResponse } from "next/server";
import { z } from "zod";
import {
  err,
  ok,
  type AppError,
  type AppErrorCode,
  type Result,
} from "./result";

export function appError(code: AppErrorCode, message: string): AppError {
  return { code, message };
}

const HTTP_STATUS: Record<AppError["code"], number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  TENANT_REQUIRED: 409,
  ACCOUNT_INACTIVE: 403,
  TOKEN_INVALID: 400,
  RATE_LIMITED: 429,
  ENTITLEMENT_REQUIRED: 402,
  PAYMENT_PROVIDER_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export function httpStatusFor(error: AppError): number {
  return HTTP_STATUS[error.code] ?? 500;
}

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

export function jsonError(error: AppError): NextResponse {
  return NextResponse.json({ error }, { status: httpStatusFor(error) });
}

/** Safe JSON body parsing with a strong schema at the route boundary. */
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<Result<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err("VALIDATION_ERROR", "Request body must be valid JSON");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.length ? issue.path.join(".") : "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return err("VALIDATION_ERROR", "Validation failed", fieldErrors);
  }
  return ok(parsed.data);
}

/** Best-effort client metadata for audit records and session rows. */
export function clientMeta(request: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ipAddress = forwarded?.split(",")[0]?.trim() || realIp?.trim() || undefined;
  return {
    ipAddress,
    userAgent: request.headers.get("user-agent") ?? undefined,
  };
}