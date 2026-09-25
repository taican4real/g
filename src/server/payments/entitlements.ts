import { withSystem, withTenant } from "../db/client";
import { err, ok, type Result } from "../shared/result";
import type { TenantContext } from "../types/access";

// ---------------------------------------------------------------------------
// Entitlement access control.
//
// This is the ONLY access-control model for purchased content. A user has
// access if and only if a row in `entitlements` matches their tenant and user
// identity, has a status that grants access (pending is NOT enough), and has
// not expired. Nothing from the browser — query parameters, redirects,
// localStorage, or student-reported status — is ever consulted.
// ---------------------------------------------------------------------------

export type EntitlementScope = {
  examTypeId?: string | null;
  subjectId?: string | null;
};

export type EntitlementRow = {
  id: string;
  tenantId: string;
  userId: string;
  paymentId: string | null;
  planId: string | null;
  registrationId: string | null;
  examTypeId: string | null;
  subjectId: string | null;
  status: string;
  startsAt: Date | null;
  expiresAt: Date | null;
};

export const EXPIRING_THRESHOLD_DAYS = 30;

function grantStatuses(): readonly string[] {
  return ["active", "expiring"];
}

/**
 * Materialises status transitions in the database so lists and admin views
 * are accurate even when no lazy access check has run recently. Idempotent.
 */
export async function refreshEntitlementStatuses(now = new Date()): Promise<{ expired: number; expiring: number }> {
  return withSystem(async (tx) => {
    const expiring = await tx`
      update entitlements
      set status = 'expiring', updated_at = now()
      where status = 'active'
        and expires_at is not null
        and expires_at > now()
        and expires_at <= now() + make_interval(days => ${EXPIRING_THRESHOLD_DAYS})
      returning id
    `;
    const expired = await tx`
      update entitlements
      set status = 'expired', updated_at = now()
      where status in ('active', 'expiring')
        and expires_at is not null
        and expires_at <= now()
      returning id
    `;
    return { expired: expired.length, expiring: expiring.length };
  });
}

async function listGranted(
  context: TenantContext,
  scope: EntitlementScope,
): Promise<EntitlementRow[]> {
  const examTypeId = scope.examTypeId ?? null;
  const subjectId = scope.subjectId ?? null;
  return withTenant(context.tenantId as string, context.userId, async (tx) => {
    const rows = await tx`
      select id, tenant_id, user_id, payment_id, plan_id, registration_id,
        exam_type_id, subject_id, status, starts_at, expires_at
      from entitlements
      where tenant_id = ${context.tenantId}
        and user_id = ${context.userId}
        and status in ${tx(grantStatuses())}
        and (expires_at is null or expires_at > now())
        and (${examTypeId}::uuid is null or exam_type_id is null or exam_type_id = ${examTypeId}::uuid)
        and (${subjectId}::uuid is null or subject_id is null or subject_id = ${subjectId}::uuid)
      order by expires_at asc nulls last, created_at asc
      limit 5
    `;
    return rows.map(toEntitlementRow);
  });
}

/**
 * Server-side access gate. Returns the strongest active entitlement or a
 * structured ENTITLEMENT_REQUIRED error. Callers that render protected
 * content must invoke this (or `requireActiveEntitlement`) on every request;
 * client state is never consulted.
 */
export async function checkEntitlement(
  context: TenantContext,
  scope: EntitlementScope = {},
): Promise<Result<EntitlementRow>> {
  if (!context.tenantId) return err("TENANT_REQUIRED", "A centre must be selected to check access");
  const rows = await listGranted(context, scope);
  if (rows.length === 0) {
    return err("ENTITLEMENT_REQUIRED", "An active entitlement is required for this content");
  }
  return ok(rows[0]);
}

/** Boolean convenience wrapper around `checkEntitlement`. */
export async function hasActiveEntitlement(
  context: TenantContext,
  scope: EntitlementScope = {},
): Promise<boolean> {
  return (await checkEntitlement(context, scope)).ok;
}

export async function listMyEntitlements(context: TenantContext): Promise<EntitlementRow[]> {
  if (!context.tenantId) return [];
  return withTenant(context.tenantId, context.userId, (tx) =>
    tx`
      select id, tenant_id, user_id, payment_id, plan_id, registration_id,
        exam_type_id, subject_id, status, starts_at, expires_at
      from entitlements
      where tenant_id = ${context.tenantId} and user_id = ${context.userId}
      order by created_at desc
      limit 50
    `.then((rows) => rows.map(toEntitlementRow)),
  );
}

function toEntitlementRow(row: Record<string, unknown>): EntitlementRow {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    userId: String(row.user_id),
    paymentId: (row.payment_id as string | null) ?? null,
    planId: (row.plan_id as string | null) ?? null,
    registrationId: (row.registration_id as string | null) ?? null,
    examTypeId: (row.exam_type_id as string | null) ?? null,
    subjectId: (row.subject_id as string | null) ?? null,
    status: String(row.status),
    startsAt: (row.starts_at as Date | null) ?? null,
    expiresAt: (row.expires_at as Date | null) ?? null,
  };
}