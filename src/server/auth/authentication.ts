import { getDb } from "../db/client";
import { createSession } from "./sessions";
import {
  listActiveMemberships,
  resolveTenantContext,
  type Membership,
} from "./context";
import { recordAudit } from "../audit/audit";
import { hashPassword, verifyPassword } from "../security/passwords";
import { hashToken } from "../security/tokens";
import { err, ok, type Result } from "../shared/result";
import type { PermissionCode, UserRole } from "../types/access";

export type PublicUser = {
  id: string;
  email: string | null;
  displayName: string;
  status: string;
};

export type LoginSuccess = {
  token: string;
  expiresAt: Date;
  user: PublicUser;
  activeTenant: Membership | null;
  memberships: Membership[];
  roles: readonly UserRole[];
  permissions: readonly PermissionCode[];
  needTenantSelection: boolean;
};

type LoginInput = {
  identifier: string;
  password: string;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * Authenticates a local (email + password) account. The tenant membership and
 * active tenant are resolved from the database after password verification;
 * nothing about tenancy is accepted from the client.
 */
export async function login(
  input: LoginInput,
): Promise<Result<LoginSuccess>> {
  const sql = getDb();
  const email = input.identifier.trim().toLowerCase();
  const [user] = await sql`
    select id, email, phone, display_name, password_hash, status
    from users
    where lower(email) = ${email}
    limit 1
  `;

  if (!user || !user.password_hash) {
    await recordAudit({
      action: "auth.login_failed",
      actorUserId: user?.id ?? null,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      details: { reason: "unknown_identifier" },
    });
    return err("UNAUTHENTICATED", "Invalid email or password");
  }

  const valid = await verifyPassword(input.password, user.password_hash);
  if (!valid) {
    await recordAudit({
      action: "auth.login_failed",
      actorUserId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      details: { reason: "bad_password" },
    });
    return err("UNAUTHENTICATED", "Invalid email or password");
  }

  if (user.status !== "active") {
    await recordAudit({
      action: "auth.login_failed",
      actorUserId: user.id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      details: { reason: "account_status", status: user.status },
    });
    return err("ACCOUNT_INACTIVE", "This account is not active");
  }

  const memberships = await listActiveMemberships(user.id);
  const activeTenantId =
    memberships.length === 1 ? memberships[0].tenantId : null;

  const { token, record } = await createSession({
    userId: user.id,
    activeTenantId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await recordAudit({
    action: "auth.login",
    tenantId: activeTenantId,
    actorUserId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    details: { needTenantSelection: memberships.length > 1 },
  });

  const contextResult = await resolveTenantContext({
    sessionId: record.sessionId,
    userId: user.id,
    activeTenantId,
    authMethod: "password",
  });

  return ok({
    token,
    expiresAt: record.expiresAt,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      status: user.status,
    },
    activeTenant:
      memberships.find((m) => m.tenantId === activeTenantId) ?? null,
    memberships,
    roles: contextResult.ok ? contextResult.value.roles : [],
    permissions: contextResult.ok ? contextResult.value.permissions : [],
    needTenantSelection: memberships.length > 1,
  });
}

export async function logout(input: {
  token: string | null;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  if (!input.token) return;
  const sql = getDb();
  const [session] = await sql`
    select id, user_id, active_tenant_id
    from sessions
    where token_hash = ${hashToken(input.token)} and revoked_at is null
    limit 1
  `;
  if (session) {
    await sql`
      update sessions set revoked_at = now()
      where id = ${session.id} and revoked_at is null
    `;
    await recordAudit({
      action: "auth.logout",
      tenantId: session.active_tenant_id,
      actorUserId: session.user_id,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
  }
}

export async function changePassword(input: {
  userId: string;
  sessionId: string;
  currentPassword: string;
  newPassword: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<Result<void>> {
  const sql = getDb();
  const [user] = await sql`
    select password_hash from users where id = ${input.userId} limit 1
  `;
  if (!user?.password_hash) {
    return err("UNAUTHENTICATED", "Account has no local password");
  }
  const valid = await verifyPassword(input.currentPassword, user.password_hash);
  if (!valid) {
    await recordAudit({
      action: "user.password_changed",
      actorUserId: input.userId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      details: { reason: "current_password_incorrect" },
    });
    return err("FORBIDDEN", "Current password is incorrect");
  }

  const nextHash = await hashPassword(input.newPassword);
  await sql.begin(async (tx) => {
    await tx`
      update users set password_hash = ${nextHash}, updated_by = ${input.userId}
      where id = ${input.userId}
    `;
    await tx`
      update sessions set revoked_at = now()
      where user_id = ${input.userId} and id <> ${input.sessionId}
        and revoked_at is null
    `;
  });

  await recordAudit({
    action: "user.password_changed",
    actorUserId: input.userId,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
  return ok(undefined);
}