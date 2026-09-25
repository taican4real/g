import { createHash, randomBytes } from "node:crypto";
import {
  withSystem,
  withTenant,
  type Sql,
} from "../db/client";
import { err, ok, type Result } from "../shared/result";
import { hasActiveEntitlement } from "./entitlements";
import {
  getPaymentProvider,
  type ParsedWebhook,
  type PaymentProvider,
} from "./provider";
import { recordAudit } from "../audit/audit";
import { queueEmail } from "../notifications/outbox";
import type { TenantContext } from "../types/access";

// ---------------------------------------------------------------------------
// Phase 7 payment workflows.
//
// The ONLY way a payment reaches `success` is the signature-verified provider
// webhook path below, which re-verifies the transaction against the provider
// API before activating anything. Nothing in a redirect, query parameter,
// client state, or student-reported status is trusted.
// ---------------------------------------------------------------------------

export type PaymentStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | "cancelled"
  | "refunded"
  | "expired";

export type PaymentRow = {
  id: string;
  tenantId: string;
  userId: string;
  registrationId: string | null;
  paymentRequirementId: string | null;
  planId: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  provider: string | null;
  providerReference: string | null;
  checkoutUrl: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

function hashToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function newCheckoutToken(): string {
  return randomBytes(24).toString("base64url");
}

function newProviderReference(): string {
  const suffix = randomBytes(8).toString("base64url").replace(/[^A-Za-z0-9]+/g, "").slice(0, 12).toUpperCase();
  return `PY-${new Date().getUTCFullYear()}-${suffix}`;
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PendingRegistration = {
  id: string;
  examTypeId: string;
  examSessionId: string;
  studentCode: string;
  tenantName: string;
  email: string;
  examName: string;
  firstName: string;
  requirement: {
    id: string;
    amountMinor: number;
    currency: string;
  };
  plan: {
    id: string;
    examTypeId: string | null;
    subjectId: string | null;
    entitlementDurationDays: number | null;
  } | null;
};

async function findPendingRegistration(
  tx: Sql,
  context: TenantContext,
  registrationId?: string,
): Promise<PendingRegistration | null> {
  const scopedRegistrationId = registrationId ?? null;
  const rows = await tx`
    select
      sr.id, sr.exam_type_id, sr.exam_session_id, sr.student_code,
      t.name as tenant_name,
      u.email,
      u.display_name,
      et.name as exam_name,
      pr.id as requirement_id, pr.amount_minor as requirement_amount, pr.currency as requirement_currency,
      pp.id as plan_id, pp.exam_type_id as plan_exam_type_id, pp.subject_id as plan_subject_id,
      pp.entitlement_duration_days
    from student_registrations sr
    join payment_requirements pr on pr.registration_id = sr.id
    join tenants t on t.id = sr.tenant_id
    join users u on u.id = sr.user_id
    join exam_types et on et.id = sr.exam_type_id
    left join payment_plans pp on pp.id = pr.plan_id
    where sr.tenant_id = ${context.tenantId}
      and sr.user_id = ${context.userId}
      and sr.status = 'payment_pending'
      and (${scopedRegistrationId}::uuid is null or sr.id = ${scopedRegistrationId}::uuid)
    order by sr.created_at desc
    limit 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    examTypeId: String(row.exam_type_id),
    examSessionId: String(row.exam_session_id),
    studentCode: String(row.student_code),
    tenantName: String(row.tenant_name),
    email: String(row.email),
    examName: String(row.exam_name),
    firstName: String(row.display_name),
    requirement: {
      id: String(row.requirement_id),
      amountMinor: Number(row.requirement_amount),
      currency: String(row.requirement_currency),
    },
    plan: row.plan_id
      ? {
          id: String(row.plan_id),
          examTypeId: (row.plan_exam_type_id as string | null) ?? null,
          subjectId: (row.plan_subject_id as string | null) ?? null,
          entitlementDurationDays: (row.entitlement_duration_days as number | null) ?? null,
        }
      : null,
  };
}
// ---------------------------------------------------------------------------
// Session creation — "payment requirement -> payment session".
// ---------------------------------------------------------------------------

export async function createPaymentSession(
  context: TenantContext,
  registrationId?: string,
): Promise<Result<{ paymentId: string; provider: string; checkoutUrl: string; status: PaymentStatus }>> {
  if (!context.tenantId) return err("TENANT_REQUIRED", "A centre must be selected to start a payment");
  if (!context.roles.includes("student")) return err("FORBIDDEN", "Student access is required to start a payment");

  const provider = getPaymentProvider();
  if (!provider) {
    return err("PAYMENT_PROVIDER_UNAVAILABLE", "No payment provider is configured for this environment");
  }

  return withSystem(async (tx) => {
    const registration = await findPendingRegistration(tx, context, registrationId);
    if (!registration) return err("VALIDATION_ERROR", "No pending registration with an outstanding payment requirement was found");

    const reference = newProviderReference();
    const checkoutTokenHash = hashToken(newCheckoutToken());

    const [created] = await tx`
      insert into payments (
        tenant_id, user_id, registration_id, payment_requirement_id, plan_id,
        amount_minor, currency, status, provider, provider_reference,
        checkout_token_hash
      ) values (
        ${context.tenantId}, ${context.userId}, ${registration.id}, ${registration.requirement.id}, ${registration.plan?.id ?? null},
        ${registration.requirement.amountMinor}, ${registration.requirement.currency}, 'pending', ${provider.name}, ${reference},
        ${checkoutTokenHash}
      ) returning id
    `;

    let checkout: { provider: string; providerReference: string; checkoutUrl: string };
    try {
      checkout = await provider.createCheckout({
        siteName: "ExamForge",
        tenantName: registration.tenantName,
        email: registration.email,
        description: `${registration.examName} registration payment`,
        amountMinor: registration.requirement.amountMinor,
        currency: registration.requirement.currency,
        providerReference: reference,
        callbackUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/app/student`,
        webhookUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/api/payments/webhook/${provider.name}`,
        metadata: {
          paymentId: created.id,
          registrationId: registration.id,
          studentCode: registration.studentCode,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Checkout could not be initialized";
      await tx`update payments set status = 'failed', failed_at = now(), provider_message = ${message} where id = ${created.id}`;
      return err("PAYMENT_PROVIDER_UNAVAILABLE", "The payment provider rejected the checkout request");
    }

    const [updated] = await tx`
      update payments
      set status = 'processing', provider = ${checkout.provider},
        provider_reference = ${checkout.providerReference}, checkout_url = ${checkout.checkoutUrl}
      where id = ${created.id}
      returning id, status
    `;
    await tx`update payment_requirements set status = 'processing', provider = ${checkout.provider}, provider_reference = ${checkout.providerReference} where id = ${registration.requirement.id}`;

    await recordAudit({
      action: "payment.session_created",
      tenantId: context.tenantId,
      actorUserId: context.userId,
      resourceType: "payments",
      resourceId: created.id,
      details: { provider: checkout.provider, amountMinor: registration.requirement.amountMinor, currency: registration.requirement.currency },
    });

    return ok({ paymentId: String(updated.id), provider: checkout.provider, checkoutUrl: checkout.checkoutUrl, status: String(updated.status) as PaymentStatus });
  });
}
// ---------------------------------------------------------------------------
// Webhook handling — the verified success path.
// ---------------------------------------------------------------------------

export type WebhookOutcome =
  | "processed"
  | "duplicate"
  | "unmatched"
  | "ignored"
  | "invalid_signature";

export type WebhookResult = {
  outcome: WebhookOutcome;
  paymentId?: string;
};

/**
 * Entry point for provider webhooks. Fully idempotent: the same webhook
 * delivered twice acknowledges the second delivery without re-activating
 * access. Signature verification happens first; the transaction is then
 * re-verified against the provider's API before any state changes.
 */
export async function handlePaymentWebhook(
  providerName: string,
  rawBody: string,
  headers: Readonly<Record<string, string | undefined>>,
  payload: unknown,
): Promise<Result<WebhookResult>> {
  const provider = getPaymentProvider(providerName);
  if (!provider) {
    return err("NOT_FOUND", "Unknown payment provider");
  }

  if (!provider.verifyWebhookSignature(rawBody, headers)) {
    return err("VALIDATION_ERROR", "Webhook signature verification failed");
  }

  const parsed = provider.parseWebhook(payload);
  if (!parsed) {
    return ok({ outcome: "ignored" });
  }

  return withSystem(async (tx) => {
    // 1. Idempotency anchor: (provider, provider_transaction_id) is unique.
    const [existing] = await tx`
      select id from payment_transactions
      where provider = ${provider.name} and provider_transaction_id = ${parsed.providerTransactionId}
      limit 1
    `;
    if (existing) {
      return ok<WebhookResult>({ outcome: "duplicate" });
    }

    const [recorded] = await tx`
      insert into payment_transactions (
        provider, provider_transaction_id, event_type, raw_payload, signature_verified
      ) values (
        ${provider.name}, ${parsed.providerTransactionId}, ${payload && typeof payload === "object" ? String((payload as Record<string, unknown>).event ?? "event") : "event"},
        ${JSON.stringify(payload ?? {})}, true
      ) returning id
    `;

    // 2. Find the payment by provider reference.
    const payment = await findPaymentByReference(tx, provider, parsed.providerReference);
    if (!payment) {
      await tx`update payment_transactions set verification_status = 'ignored', processed_at = now(), error_message = 'no matching payment' where id = ${recorded.id}`;
      return ok<WebhookResult>({ outcome: "unmatched" });
    }
    if (payment.status === "success") {
      await tx`update payment_transactions set verification_status = 'verified', payment_id = ${payment.id}, processed_at = now() where id = ${recorded.id}`;
      return ok<WebhookResult>({ outcome: "duplicate", paymentId: payment.id });
    }

    // 3. Server-side source of truth: reconcile with the provider API.
    let verified: Awaited<ReturnType<PaymentProvider["verifyTransaction"]>>;
    try {
      verified = await provider.verifyTransaction(parsed.providerReference, payment.amountMinor, payment.currency);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction verification unavailable";
      await tx`update payment_transactions set verification_status = 'failed', payment_id = ${payment.id}, processed_at = now(), error_message = ${message} where id = ${recorded.id}`;
      return err("PAYMENT_PROVIDER_UNAVAILABLE", message);
    }

    if (verified.status !== "success") {
      await tx`update payments set status = 'failed', failed_at = now(), provider_message = 'Provider reported a non-successful transaction' where id = ${payment.id}`;
      await tx`update payment_requirements set status = 'failed' where id = ${payment.paymentRequirementId}`;
      await tx`update payment_transactions set verification_status = 'verified', payment_id = ${payment.id}, processed_at = now() where id = ${recorded.id}`;
      await recordAudit({
        action: "payment.failed",
        tenantId: payment.tenantId,
        actorUserId: payment.userId,
        resourceType: "payments",
        resourceId: payment.id,
        details: { reason: "provider_reported_failure", providerTransactionId: verified.providerTransactionId },
      });
      return ok<WebhookResult>({ outcome: "processed", paymentId: payment.id });
    }

    // 4. Amount/currency must match the payment we charged. Reject otherwise.
    const amountMatches = verified.amountMinor === payment.amountMinor;
    const currencyMatches = verified.currency.toUpperCase() === payment.currency.toUpperCase();
    if (!amountMatches || !currencyMatches) {
      await tx`update payments set status = 'failed', failed_at = now(), provider_message = 'Verified amount/currency does not match the charge' where id = ${payment.id}`;
      await tx`update payment_requirements set status = 'failed' where id = ${payment.paymentRequirementId}`;
      await tx`update payment_transactions set verification_status = 'failed', payment_id = ${payment.id}, processed_at = now(), error_message = 'amount or currency mismatch' where id = ${recorded.id}`;
      await recordAudit({
        action: "payment.failed",
        tenantId: payment.tenantId,
        actorUserId: payment.userId,
        resourceType: "payments",
        resourceId: payment.id,
        details: { reason: "amount_or_currency_mismatch" },
      });
      return ok<WebhookResult>({ outcome: "processed", paymentId: payment.id });
    }

    // 5. Everything checks out: mark paid, complete the registration, and
    // activate the entitlement in one transaction.
    const [done] = await tx`
      update payments
      set status = 'success', paid_at = ${verified.paidAt ?? new Date()}, provider_message = 'Verified by provider API'
      where id = ${payment.id}
      returning id
    `;
    await tx`update payment_requirements set status = 'paid' where id = ${payment.paymentRequirementId}`;
    await tx`update student_registrations set status = 'completed', completed_at = now() where id = ${payment.registrationId}`;
    const entitlement = await activateEntitlement(tx, payment);

    await queueEmail(tx, {
      tenantId: payment.tenantId,
      userId: payment.userId,
      recipientEmail: payment.email,
      notificationType: "student.payment.confirmed",
      templateCode: "student.payment.confirmed",
      payload: {
        firstName: payment.displayName,
        studentCode: payment.studentCode,
        examination: payment.examName,
        amount: (payment.amountMinor / 100).toFixed(2),
        currency: payment.currency,
        providerReference: parsed.providerReference,
        expiresAt: formatExpiry(entitlement.expiresAt),
        loginUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/login`,
      },
    });

    await tx`update payment_transactions set verification_status = 'verified', payment_id = ${payment.id}, processed_at = now() where id = ${recorded.id}`;

    await recordAudit({
      action: "payment.succeeded",
      tenantId: payment.tenantId,
      actorUserId: payment.userId,
      resourceType: "payments",
      resourceId: done.id,
      details: { provider: provider.name, amountMinor: payment.amountMinor, currency: payment.currency },
    });
    await recordAudit({
      action: "entitlement.activated",
      tenantId: payment.tenantId,
      actorUserId: payment.userId,
      resourceType: "entitlements",
      resourceId: entitlement.id,
      details: { planId: payment.planId ?? null },
    });

    return ok<WebhookResult>({ outcome: "processed", paymentId: String(done.id) });
  });
}

function formatExpiry(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "the end of your plan";
}

// ---------------------------------------------------------------------------
// Loads a payment row (with joined registrant context) by provider reference.
// ---------------------------------------------------------------------------

type PaymentWithContext = {
  id: string;
  tenantId: string;
  userId: string;
  registrationId: string | null;
  paymentRequirementId: string | null;
  planId: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  email: string;
  displayName: string;
  studentCode: string;
  examName: string;
  planExamTypeId: string | null;
  planSubjectId: string | null;
  planDurationDays: number | null;
};

async function findPaymentByReference(
  tx: Sql,
  provider: PaymentProvider,
  reference: string,
): Promise<PaymentWithContext | null> {
  const rows = await tx`
    select
      p.id, p.tenant_id, p.user_id, p.registration_id, p.payment_requirement_id, p.plan_id,
      p.amount_minor, p.currency, p.status,
      u.email,
      u.display_name,
      coalesce(sr.student_code, '') as student_code,
      coalesce(et.name, '') as exam_name,
      pp.exam_type_id as plan_exam_type_id,
      pp.subject_id as plan_subject_id,
      pp.entitlement_duration_days
    from payments p
    join users u on u.id = p.user_id
    left join student_registrations sr on sr.id = p.registration_id
    left join exam_types et on et.id = sr.exam_type_id
    left join payment_plans pp on pp.id = p.plan_id
    where p.provider = ${provider.name} and p.provider_reference = ${reference}
    limit 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    userId: String(row.user_id),
    registrationId: (row.registration_id as string | null) ?? null,
    paymentRequirementId: (row.payment_requirement_id as string | null) ?? null,
    planId: (row.plan_id as string | null) ?? null,
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    status: String(row.status),
    email: String(row.email),
    displayName: String(row.display_name),
    studentCode: String(row.student_code),
    examName: String(row.exam_name),
    planExamTypeId: (row.plan_exam_type_id as string | null) ?? null,
    planSubjectId: (row.plan_subject_id as string | null) ?? null,
    planDurationDays: (row.entitlement_duration_days as number | null) ?? null,
  };
}
// ---------------------------------------------------------------------------
// Activates the entitlement for a verified payment. Scope mirrors the plan
// (exam_type_id/subject_id); a plan without a subject scope entitles the
// whole examination.
// ---------------------------------------------------------------------------

async function activateEntitlement(
  tx: Sql,
  payment: PaymentWithContext,
): Promise<{ id: string; expiresAt: Date | null }> {
  const durationDays = payment.planDurationDays;
  const [entitlement] = durationDays && durationDays > 0
    ? await tx`
        insert into entitlements (
          tenant_id, user_id, payment_id, plan_id, registration_id,
          exam_type_id, subject_id, status, starts_at, expires_at, granted_at
        ) values (
          ${payment.tenantId}, ${payment.userId}, ${payment.id}, ${payment.planId ?? null}, ${payment.registrationId ?? null},
          ${payment.planExamTypeId ?? null}, ${payment.planSubjectId ?? null}, 'active', now(),
          now() + make_interval(days => ${durationDays}), now()
        ) returning id, expires_at
      `
    : await tx`
        insert into entitlements (
          tenant_id, user_id, payment_id, plan_id, registration_id,
          exam_type_id, subject_id, status, starts_at, expires_at, granted_at
        ) values (
          ${payment.tenantId}, ${payment.userId}, ${payment.id}, ${payment.planId ?? null}, ${payment.registrationId ?? null},
          ${payment.planExamTypeId ?? null}, ${payment.planSubjectId ?? null}, 'active', now(), null, now()
        ) returning id, expires_at
      `;
  return {
    id: String(entitlement.id),
    expiresAt: (entitlement.expires_at as Date | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Read views for the student dashboard.
// ---------------------------------------------------------------------------

export async function listStudentPayments(context: TenantContext): Promise<PaymentRow[]> {
  if (!context.tenantId) return [];
  return withTenant(context.tenantId, context.userId, (tx) =>
    tx`
      select id, tenant_id, user_id, registration_id, payment_requirement_id, plan_id,
        amount_minor, currency, status, provider, provider_reference, checkout_url, paid_at, created_at
      from payments
      where tenant_id = ${context.tenantId} and user_id = ${context.userId}
      order by created_at desc
      limit 20
    `.then((rows) => rows.map(toPaymentRow)),
  );
}

function toPaymentRow(row: Record<string, unknown>): PaymentRow {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    userId: String(row.user_id),
    registrationId: (row.registration_id as string | null) ?? null,
    paymentRequirementId: (row.payment_requirement_id as string | null) ?? null,
    planId: (row.plan_id as string | null) ?? null,
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    status: String(row.status) as PaymentStatus,
    provider: (row.provider as string | null) ?? null,
    providerReference: (row.provider_reference as string | null) ?? null,
    checkoutUrl: (row.checkout_url as string | null) ?? null,
    paidAt: (row.paid_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

/** The student's payment status including whether access is unlocked. */
export async function studentPaymentStatus(context: TenantContext): Promise<Result<{
  registrationId: string | null;
  paymentStatus: PaymentStatus | null;
  checkoutUrl: string | null;
  hasAccess: boolean;
}>> {
  if (!context.tenantId) return err("TENANT_REQUIRED", "A centre must be selected");
  const hasAccess = await hasActiveEntitlement(context);
  const payments = await listStudentPayments(context);
  const latest = payments[0];
  if (!latest) return ok({ registrationId: null, paymentStatus: null, checkoutUrl: null, hasAccess });
  return ok({
    registrationId: latest.registrationId,
    paymentStatus: latest.status,
    checkoutUrl: latest.checkoutUrl,
    hasAccess,
  });
}