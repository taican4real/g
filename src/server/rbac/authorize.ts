import type {
  PermissionCode,
  TenantContext,
  UserRole,
} from "../types/access";
import { err, ok, type Result } from "../shared/result";

export const PLATFORM_ADMIN_ROLE = "platform_super_admin" as const;

export function isPlatformAdmin(context: TenantContext): boolean {
  return context.roles.includes(PLATFORM_ADMIN_ROLE);
}

export function hasRole(context: TenantContext, role: UserRole): boolean {
  return context.roles.includes(role);
}

export function hasPermission(
  context: TenantContext,
  code: PermissionCode,
): boolean {
  // Super admin is the explicit escalation path; every other permission must
  // be granted through a role.
  return isPlatformAdmin(context) || context.permissions.includes(code);
}

export function hasAnyPermission(
  context: TenantContext,
  codes: readonly PermissionCode[],
): boolean {
  return codes.some((code) => hasPermission(context, code));
}

export function hasAllPermissions(
  context: TenantContext,
  codes: readonly PermissionCode[],
): boolean {
  return codes.every((code) => hasPermission(context, code));
}

// ---------------------------------------------------------------------------
// Guards returning Result so route handlers can return structured errors.
// ---------------------------------------------------------------------------

export function assertPermission(
  context: TenantContext,
  code: PermissionCode,
): Result<void> {
  return hasPermission(context, code)
    ? ok(undefined)
    : err("FORBIDDEN", `Required permission: ${code}`);
}

export function assertRole(
  context: TenantContext,
  role: UserRole,
): Result<void> {
  return hasRole(context, role)
    ? ok(undefined)
    : err("FORBIDDEN", `Required role: ${role}`);
}

/** Requires a tenant-scoped context (a centre selected in the session). */
export function assertTenantScoped(context: TenantContext): Result<TenantContext> {
  return context.tenantId
    ? ok(context)
    : err("TENANT_REQUIRED", "A centre must be selected to perform this action");
}

/** Requires platform super admin elevation. */
export function assertPlatformAdmin(context: TenantContext): Result<TenantContext> {
  return isPlatformAdmin(context)
    ? ok(context)
    : err("FORBIDDEN", "Platform administrator access is required");
}