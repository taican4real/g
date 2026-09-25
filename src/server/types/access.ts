// Pure access-control types shared by server code, scripts, and tests.
// This module must not import framework or `server-only` code so that it can
// be executed by tooling and tests outside the Next.js runtime.

export type TenantId = string;
export type UserId = string;

export type UserRole =
  | "platform_super_admin"
  | "centre_admin"
  | "content_admin"
  | "teacher"
  | "student"
  ;

export const USER_ROLES = [
  "platform_super_admin",
  "centre_admin",
  "content_admin",
  "teacher",
  "student",
] as const satisfies readonly UserRole[];

export type PermissionCode =
  | "platform.tenants.manage"
  | "platform.users.manage"
  | "platform.roles.manage"
  | "platform.audit.view"
  | "tenant.settings.manage"
  | "tenant.members.manage"
  | "tenant.roles.grant"
  | "tenant.content.manage"
  | "tenant.cbt.manage"
  | "tenant.reports.view"
  | "tenant.billing.manage"
  | "tenant.audit.view"
  | "self.profile.manage";

export const PERMISSION_CODES = [
  "platform.tenants.manage",
  "platform.users.manage",
  "platform.roles.manage",
  "platform.audit.view",
  "tenant.settings.manage",
  "tenant.members.manage",
  "tenant.roles.grant",
  "tenant.content.manage",
  "tenant.cbt.manage",
  "tenant.reports.view",
  "tenant.billing.manage",
  "tenant.audit.view",
  "self.profile.manage",
] as const satisfies readonly PermissionCode[];

/**
 * The resolved authorization context for an authenticated request.
 *
 * `tenantId` is the tenant the user is acting as right now. It is derived
 * exclusively from the verified session (the active tenant), never from the
 * client. It is `null` for platform-level contexts (platform super admin
 * acting outside any centre).
 */
export type TenantContext = {
  tenantId: TenantId | null;
  userId: UserId;
  roles: readonly UserRole[];
  permissions: readonly PermissionCode[];
};