import { getDb, type Sql } from "../db/client";

/**
 * Audit actions. Append-only: application code never updates or deletes audit
 * rows. Never include passwords, tokens, or secrets in `details`.
 */
export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.tenant_activated"
  | "auth.password_reset_requested"
  | "auth.password_reset_completed"
  | "auth.email_verification_requested"
  | "auth.email_verified"
  | "user.account_created"
  | "user.password_changed"
  | "tenant.created"
  | "role.granted"
  | "role.revoked"
  | "permission.changed"
  | "payment.session_created"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.webhook_invalid"
  | "entitlement.activated"
  | "entitlement.expired"
  | "entitlement.suspended"
  | "entitlement.cancelled";

export type AuditInput = {
  action: AuditAction;
  tenantId?: string | null;
  actorUserId?: string | null;
  resourceType?: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
};

const SENSITIVE_KEY = /(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie)/i;

/**
 * Fails before touching the database if an audit payload could leak a secret.
 */
export function assertAuditDetailsSafe(
  details: Record<string, unknown> | undefined,
): void {
  if (!details) return;
  for (const key of Object.keys(details)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Error(`Refusing to write sensitive key '${key}' to the audit log`);
    }
  }
}

/** Records an audit event. Insert policy always allows writes. */
export async function recordAudit(input: AuditInput): Promise<void> {
  assertAuditDetailsSafe(input.details);
  const sql: Sql = getDb();
  await sql`
    insert into audit_logs (
      tenant_id, actor_user_id, action, resource_type, resource_id,
      ip_address, user_agent, details
    ) values (
      ${input.tenantId ?? null}, ${input.actorUserId ?? null},
      ${input.action}, ${input.resourceType ?? null}, ${input.resourceId ?? null},
      ${input.ipAddress ?? null}, ${input.userAgent ?? null},
      ${JSON.stringify(input.details ?? {})}::jsonb
    )
  `;
}