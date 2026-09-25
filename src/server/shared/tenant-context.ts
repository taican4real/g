import "server-only";

export type {
  PermissionCode,
  TenantContext,
  TenantId,
  UserId,
  UserRole,
} from "@/server/types/access";

import type { TenantContext } from "@/server/types/access";

/**
 * Guard for tenant-scoped operations. Requires a context whose tenantId was
 * derived from the verified session. `expectedTenantId` is used to reject call
 * sites that attempt to pass a client-supplied tenant: any mismatch throws.
 */
export function requireTenantContext(
  context: TenantContext | null | undefined,
  expectedTenantId?: string,
): TenantContext {
  if (!context?.userId || !context.tenantId) {
    throw new Error("A resolved tenant context is required");
  }
  if (expectedTenantId && context.tenantId !== expectedTenantId) {
    throw new Error("Tenant context does not match the requested tenant");
  }
  return context;
}

/**
 * Guard for platform-level operations. Only a platform super admin context
 * satisfies it.
 */
export function requirePlatformContext(
  context: TenantContext | null | undefined,
): TenantContext {
  if (
    !context?.userId ||
    !context.roles.includes("platform_super_admin")
  ) {
    throw new Error("A platform administrator context is required");
  }
  return context;
}
