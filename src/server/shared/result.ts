export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "TENANT_REQUIRED"
  | "ACCOUNT_INACTIVE"
  | "TOKEN_INVALID"
  | "RATE_LIMITED"
  | "ENTITLEMENT_REQUIRED"
  | "PAYMENT_PROVIDER_UNAVAILABLE"
  | "INTERNAL_ERROR";

export type AppError = {
  code: AppErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(
  code: AppErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): Result<T> {
  return { ok: false, error: { code, message, fieldErrors } };
}
