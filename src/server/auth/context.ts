import { getDb, withUser } from "../db/client";
import type { NextRequest } from "next/server";
import {
  findSessionRecord,
  sessionCookieName,
  updateSessionActiveTenant,
  type ActiveSession,
} from "./sessions";
import { err, ok, type Result } from "../shared/result";
import type {
  PermissionCode,
  TenantContext,
  UserRole,
} from "../types/access";

export type SessionUser = {
  id: string;
  email: string | null;
  displayName: string;
  status: string;
};

export type ActiveSessionUser = {
  session: ActiveSession;
  user: SessionUser;
};

export type Membership = {
  tenantId: string;
  slug: string;
  name: string;
  membershipStatus: string;
};

/** Reads the bearer token from a request's cookies. */
export function readSessionToken(request: NextRequest): string | null {
  return request.cookies.get(sessionCookieName())?.value ?? null;
}

/** Resolves a bearer token to a live session and its user. */
export async function getSessionUser(
  token: string,
): Promise<ActiveSessionUser | null> {
  const record = await findSessionRecord(token);
  if (!record) return null;
  const sql = getDb();
  const [user] = await sql`
    select id, email, display_name, status
    from users
    where id = ${record.userId}
    limit 1
  `;
  if (!user) return null;
  return {
    session: {
      sessionId: record.sessionId,
      userId: record.userId,
      activeTenantId: record.activeTenantId,
      authMethod: record.authMethod,
    },
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      status: user.status,
    },
  };
}

/** Active memberships for a user, regardless of the current active tenant. */
export async function listActiveMemberships(
  userId: string,
): Promise<Membership[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select tm.tenant_id, t.slug, t.name, tm.membership_status
      from tenant_memberships tm
      join tenants t on t.id = tm.tenant_id
      where tm.user_id = ${userId}
        and tm.membership_status = 'active'
        and t.status = 'active'
      order by t.name asc
    `;
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      slug: row.slug,
      name: row.name,
      membershipStatus: row.membership_status,
    }));
  });
}

type RoleLoad = {
  roles: readonly UserRole[];
  permissions: readonly PermissionCode[];
};

/**
 * Loads the roles and permissions applicable to a user for the given tenant
 * scope. Platform-scope roles always apply; tenant-scope roles apply only when
 * `tenantId` matches the assignment.
 */
async function loadRolesAndPermissions(
  userId: string,
  tenantId: string | null,
): Promise<RoleLoad> {
  return withUser(userId, async (tx) => {
    const rows = await tx`
      select distinct r.code as role_code, p.code as permission_code
      from user_roles ur
      join roles r on r.id = ur.role_id
      left join role_permissions rp on rp.role_id = r.id
      left join permissions p on p.id = rp.permission_id
      where ur.user_id = ${userId}
        and (r.scope = 'platform' or ur.tenant_id = ${tenantId})
    `;
    const roles = new Set<UserRole>();
    const permissions = new Set<PermissionCode>();
    for (const row of rows) {
      if (row.role_code) roles.add(row.role_code as UserRole);
      if (row.permission_code) {
        permissions.add(row.permission_code as PermissionCode);
      }
    }
    return { roles: [...roles], permissions: [...permissions] };
  });
}

/**
 * Resolves the authorization context from a session. The tenant is derived
 * exclusively from the server-side session (the active tenant), never from
 * the client. Single-membership users have their tenant selected implicitly;
 * multi-membership users receive TENANT_REQUIRED until they activate one.
 */
export async function resolveTenantContext(
  session: ActiveSession,
): Promise<Result<TenantContext>> {
  let activeTenantId = session.activeTenantId;

  if (activeTenantId) {
    const memberships = await listActiveMemberships(session.userId);
    if (!memberships.some((m) => m.tenantId === activeTenantId)) {
      // The active tenant is no longer valid; reset it and fall through.
      await updateSessionActiveTenant(session.sessionId, null);
      activeTenantId = null;
    }
  }

  if (!activeTenantId) {
    const memberships = await listActiveMemberships(session.userId);
    if (memberships.length === 1) {
      activeTenantId = memberships[0].tenantId;
      await updateSessionActiveTenant(session.sessionId, activeTenantId);
    } else if (memberships.length > 1) {
      return err("TENANT_REQUIRED", "Select a centre to continue");
    } else {
      const { roles, permissions } = await loadRolesAndPermissions(
        session.userId,
        null,
      );
      if (roles.includes("platform_super_admin")) {
        return ok({
          tenantId: null,
          userId: session.userId,
          roles,
          permissions,
        });
      }
      return err("TENANT_REQUIRED", "No centre is assigned to this account");
    }
  }

  const { roles, permissions } = await loadRolesAndPermissions(
    session.userId,
    activeTenantId,
  );
  if (roles.length === 0) {
    return err("FORBIDDEN", "No roles are assigned for this centre");
  }

  return ok({
    tenantId: activeTenantId,
    userId: session.userId,
    roles,
    permissions,
  });
}

/**
 * Resolves the context for a request, returning a structured error when the
 * user is not authenticated or has no usable tenant/role context.
 */
export async function requireRequestContext(
  request: NextRequest,
): Promise<Result<TenantContext>> {
  const token = readSessionToken(request);
  if (!token) return err("UNAUTHENTICATED", "Not signed in");
  const sessionUser = await getSessionUser(token);
  if (!sessionUser) return err("UNAUTHENTICATED", "Session is invalid or expired");
  return resolveTenantContext(sessionUser.session);
}

export type { ActiveSession };

// CHUNK_END