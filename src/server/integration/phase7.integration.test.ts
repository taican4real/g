import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

if (!process.env.DATABASE_URL && existsSync(join(process.cwd(), ".env.local"))) process.loadEnvFile(join(process.cwd(), ".env.local"));

// The test adapter drives the full pipeline without a live vendor. Signatures
// are created with the same HMAC primitive the adapters verify, so the
// verification path is exercised honestly.
process.env.PAYMENT_PROVIDER = "test";
process.env.TEST_PAYMENT_ACCEPTANCE = "accept";
process.env.TEST_PAYMENT_WEBHOOK_SECRET = "integration-test-webhook-secret";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import { withBootstrap } from "../db/client";
import { registerStudent } from "../registration/registration";
import { createTenant } from "../tenants/tenants";
import { login } from "../auth/authentication";
import { resolveTenantContext } from "../auth/context";
import { createPaymentSession, handlePaymentWebhook } from "../payments/payments";
import { checkEntitlement, hasActiveEntitlement, refreshEntitlementStatuses, listMyEntitlements } from "../payments/entitlements";
import { signPayload } from "../payments/provider";

const skipAll = !process.env.DATABASE_URL;
const skipOrRun = skipAll ? { skip: "DATABASE_URL not set — run pnpm db:migrate first" } : undefined;

function providerHeaders(rawBody: string): Record<string, string> {
  return { "x-test-signature": signPayload("integration-test-webhook-secret", rawBody) };
}

function webhookBody(reference: string, txId: string, amountMinor: number, status = "success"): { raw: string; payload: unknown } {
  const payload = { event: "charge.success", data: { id: txId, reference, amount: amountMinor, currency: "NGN", status } };
  return { raw: JSON.stringify(payload), payload };
}
test("phase 7 integration: payment verification and entitlements", { timeout: 90_000, ...(skipOrRun ?? {}) }, async (t) => {
  const marker = `p7-${Date.now().toString(36)}`;
  const centre = await createTenant({
    name: `Pay Centre ${marker}`,
    slug: `pay-${marker}`,
    adminEmail: `admin-${marker}@example.com`,
    adminDisplayName: "Pay Centre Admin",
    adminPassword: "CentrePass1",
    actorUserId: null,
  });
  assert.ok(centre.ok);
  if (!centre.ok) return;
  const centreId = centre.value.tenant.id;

  const curriculum = await withBootstrap(async (tx) => {
    const [exam] = await tx`insert into exam_types (code, name, status) values (${`PE-${marker}`}, 'Pay Exam', 'active') returning id`;
    const [session] = await tx`insert into exam_sessions (exam_type_id, code, name, status) values (${exam.id}, '2026', 'Pay Session', 'active') returning id`;
    const [subject] = await tx`insert into subjects (code, name, status) values (${`PS-${marker}`}, 'Pay Subject', 'active') returning id`;
    await tx`insert into exam_subjects (exam_session_id, subject_id, status) values (${session.id}, ${subject.id}, 'active')`;
    const [plan] = await tx`
      insert into payment_plans (tenant_id, code, name, plan_type, amount_minor, currency, entitlement_duration_days, status)
      values (${centreId}, ${`PLAN-${marker}`}, 'Pay Plan', 'one_time', 500000, 'NGN', 365, 'active')
      returning id
    `;
    return { examId: exam.id, sessionId: session.id, subjectId: subject.id, planId: plan.id };
  });

  async function registerStudentFixture(suffix: string) {
    const email = `pay-${suffix}-${marker}@example.com`;
    const result = await registerStudent({
      tenantId: centreId,
      firstName: `Pay ${suffix}`,
      middleName: "",
      lastName: "Student",
      email,
      phone: `080${Date.now().toString().slice(-8)}`,
      dateOfBirth: "2008-05-12",
      gender: "female",
      address: "1 Pay Street",
      state: "Lagos",
      lga: "Ikeja",
      school: "Pay School",
      classLevel: "SS3",
      academicInformation: "",
      examTypeId: curriculum.examId,
      examSessionId: curriculum.sessionId,
      subjectIds: [curriculum.subjectId],
      password: "ValidPass1",
    });
    assert.ok(result.ok, JSON.stringify(result));
    return result.ok ? result.value : null;
  }

  async function studentContext(email: string) {
    const auth = await login({ identifier: email, password: "ValidPass1" });
    assert.ok(auth.ok);
    if (!auth.ok) return null;
    const [user] = await withBootstrap((tx) => tx`select id from users where lower(email) = ${email} limit 1`);
    const context = await resolveTenantContext({ sessionId: "test", userId: String(user.id), activeTenantId: centreId, authMethod: "password" });
    assert.ok(context.ok);
    return context.ok ? context.value : null;
  }
await t.test("successful payment activates an entitlement and unlocks access", async () => {
    const registration = await registerStudentFixture("ok");
    assert.ok(registration);
    if (!registration) return;
    const context = await studentContext(`pay-ok-${marker}@example.com`);
    assert.ok(context);
    if (!context) return;

    // No access before payment.
    assert.equal(await hasActiveEntitlement(context), false);
    const denied = await checkEntitlement(context);
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.code, "ENTITLEMENT_REQUIRED");

    const session = await createPaymentSession(context);
    assert.ok(session.ok, JSON.stringify(session));
    if (!session.ok) return;
    assert.equal(session.value.status, "processing");
    assert.match(session.value.checkoutUrl, /test-checkout/);

    const [payment] = await withBootstrap((tx) => tx`select provider_reference from payments where id = ${session.value.paymentId} limit 1`);
    assert.ok(payment);
    if (!payment) return;

    const webhook = webhookBody(String(payment.provider_reference), `tx-ok-${marker}`, 500000);
    const result = await handlePaymentWebhook("test", webhook.raw, providerHeaders(webhook.raw), webhook.payload);
    assert.ok(result.ok, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.value.outcome, "processed");

    assert.equal(await hasActiveEntitlement(context), true);
    const entitled = await checkEntitlement(context);
    assert.ok(entitled.ok);
    if (entitled.ok) assert.equal(entitled.value.status, "active");
    const entitlements = await listMyEntitlements(context);
    assert.ok(entitlements.some((e) => e.status === "active"));

    const [rows] = await withBootstrap((tx) => tx`
      select p.status as payment_status, pr.status as requirement_status, sr.status as registration_status, e.status as entitlement_status
      from payments p
      join payment_requirements pr on pr.id = p.payment_requirement_id
      join student_registrations sr on sr.id = p.registration_id
      join entitlements e on e.payment_id = p.id
      where p.id = ${session.value.paymentId}
    `);
    assert.equal(rows.payment_status, "success");
    assert.equal(rows.requirement_status, "paid");
    assert.equal(rows.registration_status, "completed");
    assert.equal(rows.entitlement_status, "active");

    const [email] = await withBootstrap((tx) => tx`select template_code from notifications where user_id = ${context.userId} and notification_type = 'student.payment.confirmed'`);
    assert.equal(email.template_code, "student.payment.confirmed");
  });

  await t.test("failed payment never activates an entitlement", async () => {
    const registration = await registerStudentFixture("decline");
    assert.ok(registration);
    if (!registration) return;
    const context = await studentContext(`pay-decline-${marker}@example.com`);
    assert.ok(context);
    if (!context) return;

    process.env.TEST_PAYMENT_ACCEPTANCE = "decline";
    try {
      const session = await createPaymentSession(context);
      assert.ok(session.ok, JSON.stringify(session));
      if (!session.ok) return;
      const [payment] = await withBootstrap((tx) => tx`select provider_reference from payments where id = ${session.value.paymentId} limit 1`);
      const webhook = webhookBody(String(payment.provider_reference), `tx-decline-${marker}`, 500000);
      const result = await handlePaymentWebhook("test", webhook.raw, providerHeaders(webhook.raw), webhook.payload);
      assert.ok(result.ok, JSON.stringify(result));
      if (result.ok) assert.equal(result.value.outcome, "processed");
      assert.equal(await hasActiveEntitlement(context), false);
      const [state] = await withBootstrap((tx) => tx`select status from payments where id = ${session.value.paymentId}`);
      assert.equal(state.status, "failed");
    } finally {
      process.env.TEST_PAYMENT_ACCEPTANCE = "accept";
    }
  });
await t.test("fake payment (unknown reference) is recorded but never activates", async () => {
    const context = await studentContext(`pay-ok-${marker}@example.com`);
    assert.ok(context);
    if (!context) return;

    const webhook = webhookBody(`FAKE-${marker}`, `tx-fake-${marker}`, 500000);
    const result = await handlePaymentWebhook("test", webhook.raw, providerHeaders(webhook.raw), webhook.payload);
    assert.ok(result.ok, JSON.stringify(result));
    if (result.ok) assert.equal(result.value.outcome, "unmatched");
    const [recorded] = await withBootstrap((tx) => tx`select verification_status from payment_transactions where provider = 'test' and provider_transaction_id = ${`tx-fake-${marker}`}`);
    assert.equal(recorded.verification_status, "ignored");
    // The existing verified entitlement is untouched.
    assert.equal(await hasActiveEntitlement(context), true);
  });

  await t.test("invalid webhook signature is rejected before any state change", async () => {
    const registration = await registerStudentFixture("tamper");
    assert.ok(registration);
    if (!registration) return;
    const context = await studentContext(`pay-tamper-${marker}@example.com`);
    assert.ok(context);
    if (!context) return;

    const session = await createPaymentSession(context);
    assert.ok(session.ok, JSON.stringify(session));
    if (!session.ok) return;
    const [payment] = await withBootstrap((tx) => tx`select provider_reference from payments where id = ${session.value.paymentId} limit 1`);

    const webhook = webhookBody(String(payment.provider_reference), `tx-tamper-${marker}`, 500000);
    const tamperedHeaders = { "x-test-signature": "deadbeef" };
    const result = await handlePaymentWebhook("test", webhook.raw, tamperedHeaders, webhook.payload);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "VALIDATION_ERROR");

    const [state] = await withBootstrap((tx) => tx`select status from payments where id = ${session.value.paymentId}`);
    assert.equal(state.status, "processing");
    assert.equal(await hasActiveEntitlement(context), false);
    const [txRow] = await withBootstrap((tx) => tx`select id from payment_transactions where provider = 'test' and provider_transaction_id = ${`tx-tamper-${marker}`} limit 1`);
    assert.equal(txRow, undefined);
  });

  await t.test("duplicate webhook does not activate access twice", async () => {
    const context = await studentContext(`pay-ok-${marker}@example.com`);
    assert.ok(context);
    if (!context) return;
    const [payment] = await withBootstrap((tx) => tx`
      select p.provider_reference from payments p
      join entitlements e on e.payment_id = p.id
      where p.tenant_id = ${centreId} and p.user_id = ${context.userId}
      limit 1
    `);
    assert.ok(payment);
    if (!payment) return;

    const webhook = webhookBody(String(payment.provider_reference), `tx-ok-${marker}`, 500000);
    const result = await handlePaymentWebhook("test", webhook.raw, providerHeaders(webhook.raw), webhook.payload);
    assert.ok(result.ok, JSON.stringify(result));
    if (result.ok) assert.equal(result.value.outcome, "duplicate");

    const [counts] = await withBootstrap((tx) => tx`
      select count(*) as entitlement_count from entitlements where user_id = ${context.userId} and status = 'active'
    `);
    assert.equal(Number(counts.entitlement_count), 1);
    const [emails] = await withBootstrap((tx) => tx`
      select count(*) as email_count from notifications where user_id = ${context.userId} and notification_type = 'student.payment.confirmed'
    `);
    assert.equal(Number(emails.email_count), 1);

    await refreshEntitlementStatuses();
    assert.equal(await hasActiveEntitlement(context), true);
  });
await t.test("amount mismatch is rejected without activation", async () => {
    const registration = await registerStudentFixture("mismatch");
    assert.ok(registration);
    if (!registration) return;
    const context = await studentContext(`pay-mismatch-${marker}@example.com`);
    assert.ok(context);
    if (!context) return;

    const session = await createPaymentSession(context);
    assert.ok(session.ok, JSON.stringify(session));
    if (!session.ok) return;
    const [payment] = await withBootstrap((tx) => tx`select provider_reference from payments where id = ${session.value.paymentId} limit 1`);

    // Simulate a provider that reports a different amount than the charge.
    process.env.TEST_PAYMENT_MISMATCH_AMOUNT_MINOR = "100";
    try {
      const webhook = webhookBody(String(payment.provider_reference), `tx-mismatch-${marker}`, 500000, "success");
      const result = await handlePaymentWebhook("test", webhook.raw, providerHeaders(webhook.raw), webhook.payload);
      assert.ok(result.ok, JSON.stringify(result));
      if (result.ok) assert.equal(result.value.outcome, "processed");
      assert.equal(await hasActiveEntitlement(context), false);
    } finally {
      delete process.env.TEST_PAYMENT_MISMATCH_AMOUNT_MINOR;
    }
  });

  await t.test("expired entitlement denies access even with a status row present", async () => {
    const context = await studentContext(`pay-ok-${marker}@example.com`);
    assert.ok(context);
    if (!context) return;

    await withBootstrap((tx) => tx`
      update entitlements set status = 'expired', starts_at = now() - interval '40 days', expires_at = now() - interval '1 day'
      where user_id = ${context.userId} and status = 'active'
    `);
    assert.equal(await hasActiveEntitlement(context), false);
    const denied = await checkEntitlement(context);
    assert.equal(denied.ok, false);
    // The maintenance path also honours the expiry synchronously.
    await refreshEntitlementStatuses();
    assert.equal(await hasActiveEntitlement(context), false);
  });

  await t.test("unauthorized access cannot read another tenant's entitlement", async () => {
    const other = await createTenant({
      name: `Pay Other ${marker}`,
      slug: `pay-other-${marker}`,
      adminEmail: `admin-other-${marker}@example.com`,
      adminDisplayName: "Other Admin",
      adminPassword: "CentrePass1",
      actorUserId: null,
    });
    assert.ok(other.ok);
    if (!other.ok) return;
    const okContext = await studentContext(`pay-ok-${marker}@example.com`);
    assert.ok(okContext);
    if (!okContext) return;

    // A context from the other centre cannot resolve access against the
    // entitlement even when the user id matches.
    const foreignContext = { ...okContext, tenantId: other.value.tenant.id };
    const result = await checkEntitlement(foreignContext);
    assert.equal(result.ok, false);
    assert.equal(await hasActiveEntitlement(foreignContext), false);
    const mine = await listMyEntitlements(okContext);
    assert.ok(mine.some((e) => e.userId === okContext.userId));
  });
await t.test("cleanup integration fixtures", async () => {
    await withBootstrap(async (tx) => {
      await tx`delete from payment_transactions where provider = 'test'`;
      await tx`delete from entitlements where tenant_id = ${centreId}`;
      await tx`delete from payments where tenant_id = ${centreId}`;
      await tx`delete from registration_confirmations where registration_id in (select id from student_registrations where tenant_id = ${centreId})`;
      await tx`delete from registration_subjects where registration_id in (select id from student_registrations where tenant_id = ${centreId})`;
      await tx`delete from payment_requirements where registration_id in (select id from student_registrations where tenant_id = ${centreId})`;
      await tx`delete from student_registrations where tenant_id = ${centreId}`;
      await tx`delete from student_profiles where tenant_id = ${centreId}`;
      await tx`delete from notifications where tenant_id = ${centreId}`;
      await tx`delete from payment_plans where tenant_id = ${centreId}`;
      await tx`delete from tenant_memberships where tenant_id = ${centreId}`;
      await tx`delete from user_roles where tenant_id = ${centreId}`;
      await tx`delete from users where email like ${`pay-%-${marker}@example.com`} or email like ${`admin-%-${marker}@example.com`}`;
      await tx`delete from users where email like ${`admin-other-${marker}@example.com`}`;
      await tx`delete from tenants where id = ${centreId} or slug = ${`pay-other-${marker}`}`;
      await tx`delete from exam_subjects where exam_session_id = ${curriculum.sessionId}`;
      await tx`delete from exam_sessions where id = ${curriculum.sessionId}`;
      await tx`delete from subjects where id = ${curriculum.subjectId}`;
      await tx`delete from exam_types where id = ${curriculum.examId}`;
    });
  });
});