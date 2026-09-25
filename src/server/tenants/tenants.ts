import { getDb, withPlatform } from "../db/client";
import {
  listActiveMemberships,
  resolveTenantContext,
  type Membership,
} from "../auth/context";
import { updateSessionActiveTenant } from "../auth/sessions";
import { recordAudit } from "../audit/audit";
import { hashPassword } from "../security/passwords";
import { generatePassword } from "../security/tokens";
import { err, ok, type Result } from "../shared/result";
import type { TenantContext } from "../types/access";

export type TenantSummary = {
  id: string;
  slug: string;
  name: string;
  status: string;
  memberCount: number;
  createdAt: Date;
};

export type CreateTenantInput = {
  name: string;
  slug: string;
  adminEmail: string;
  adminDisplayName: string;
  adminPassword?: string;
  actorUserId: string | null;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * Creates a tutorial centre (tenant) and its centre admin. Every tenant-owned
 * row is created inside one platform-scoped transaction. The initial password
 * is generated when not supplied and returned exactly once.
 */
export async function createTenant(
  input: CreateTenantInput,
): Promise<
  Result<{
    tenant: TenantSummary;
    admin: {
      id: string;
      email: string;
      displayName: string;
      password?: string;
    };
  }>
> {
  const sql = getDb();
  const slug = input.slug.trim().toLowerCase();
  const email = input.adminEmail.trim().toLowerCase();

  const [existing] = await sql`
    select id from tenants where slug = ${slug} limit 1
  `;
  if (existing) {
    return err("CONFLICT", `A centre with slug '${slug}' already exists`);
  }

  const adminPassword = input.adminPassword?.trim() || generatePassword();
  const adminPasswordHash = await hashPassword(adminPassword);

  const result = await withPlatform(async (tx) => {
    const [tenant] = await tx`
      insert into tenants (name, slug, created_by)
      values (${input.name.trim()}, ${slug}, ${input.actorUserId})
      returning id, slug, name, status, created_at
    `;

    const [existingUser] = await tx`
      select id from users where lower(email) = ${email} limit 1
    `;

    let adminUserId: string;
    let passwordReturned = false;
    if (existingUser) {
      adminUserId = existingUser.id;
      await tx`
        update users set display_name = ${input.adminDisplayName.trim()},
          updated_by = ${input.actorUserId}
        where id = ${adminUserId}
      `;
    } else {
      const [u] = await tx`
        insert into users (
          auth_provider, external_subject, email, display_name,
          password_hash, status, created_by
        ) values (
          'local', ${email}, ${email}, ${input.adminDisplayName.trim()},
          ${adminPasswordHash}, 'active', ${input.actorUserId}
        )
        returning id, email, display_name
      `;
      adminUserId = u.id;
      passwordReturned = true;
    }

    await tx`
      insert into tenant_memberships (tenant_id, user_id, membership_status)
      values (${tenant.id}, ${adminUserId}, 'active')
      on conflict (tenant_id, user_id)
      do update set membership_status = 'active'
    `;

    const [role] = await tx`
      select id from roles where code = 'centre_admin' limit 1
    `;
    if (role) {
      await tx`
        insert into user_roles (tenant_id, user_id, role_id, granted_by)
        values (${tenant.id}, ${adminUserId}, ${role.id}, ${input.actorUserId})
        on conflict (tenant_id, user_id, role_id) do nothing
      `;
    }

    return { tenant, adminUserId, passwordReturned, email };
  });

  await recordAudit({
    action: "tenant.created",
    tenantId: result.tenant.id,
    actorUserId: input.actorUserId,
    resourceType: "tenant",
    resourceId: result.tenant.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    details: { slug },
  });
  await recordAudit({
    action: "user.account_created",
    tenantId: result.tenant.id,
    actorUserId: result.adminUserId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    details: { email: result.email },
  });
  await recordAudit({
    action: "role.granted",
    tenantId: result.tenant.id,
    actorUserId: input.actorUserId,
    resourceType: "user_roles",
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    details: { role: "centre_admin" },
  });

  return ok({
    tenant: {
      id: result.tenant.id,
      slug: result.tenant.slug,
      name: result.tenant.name,
      status: result.tenant.status,
      memberCount: 1,
      createdAt: result.tenant.created_at,
    },
    admin: {
      id: result.adminUserId,
      email: result.email,
      displayName: input.adminDisplayName,
      password: result.passwordReturned ? adminPassword : undefined,
    },
  });
}

export async function listTenants(): Promise<TenantSummary[]> {
  return withPlatform(async (tx) => {
    const rows = await tx`
      select t.id, t.slug, t.name, t.status, t.created_at,
        (select count(*) from tenant_memberships tm where tm.tenant_id = t.id)
          as member_count
      from tenants t
      order by t.created_at desc
    `;
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      memberCount: Number(row.member_count),
      createdAt: row.created_at,
    }));
  });
}

/**
 * Switches the session's active tenant. The requested tenant is validated
 * against the user's own active memberships; a tenant the user does not
 * belong to is rejected even though the client supplied its id.
 */
export async function activateTenant(input: {
  userId: string;
  sessionId: string;
  tenantId: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<Result<{ context: TenantContext; tenant: Membership }>> {
  const memberships = await listActiveMemberships(input.userId);
  const target = memberships.find((m) => m.tenantId === input.tenantId);
  if (!target) {
    return err(
      "FORBIDDEN",
      "You are not an active member of this centre",
    );
  }

  await updateSessionActiveTenant(input.sessionId, input.tenantId);
  const contextResult = await resolveTenantContext({
    sessionId: input.sessionId,
    userId: input.userId,
    activeTenantId: input.tenantId,
    authMethod: "password",
  });
  if (!contextResult.ok) return contextResult;

  await recordAudit({
    action: "auth.tenant_activated",
    tenantId: input.tenantId,
    actorUserId: input.userId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return ok({ context: contextResult.value, tenant: target });
}