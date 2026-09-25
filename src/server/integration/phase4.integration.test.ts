import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

if (!process.env.DATABASE_URL && existsSync(join(process.cwd(), ".env.local"))) process.loadEnvFile(join(process.cwd(), ".env.local"));

import { withBootstrap } from "../db/client";
import { registerStudent } from "../registration/registration";
import { processQueuedEmails } from "../notifications/worker";

const skipAll = !process.env.DATABASE_URL;
const skipOrRun = skipAll ? { skip: "DATABASE_URL not set — run pnpm db:migrate first" } : undefined;

test("phase 4 integration: student registration transaction", { timeout: 60_000, ...(skipOrRun ?? {}) }, async (t) => {
  const marker = `p4-${Date.now().toString(36)}`;
  const [fixture] = await withBootstrap(async (tx) => {
    const [tenant] = await tx`insert into tenants (name, slug) values (${`Registration Centre ${marker}`}, ${`registration-${marker}`}) returning id`;
    const [examType] = await tx`insert into exam_types (code, name, status) values (${`EX-${marker}`}, 'Registration Exam', 'active') returning id`;
    const [session] = await tx`insert into exam_sessions (exam_type_id, code, name, status) values (${examType.id}, '2026', 'Registration Session', 'active') returning id`;
    const [subject] = await tx`insert into subjects (code, name, status) values (${`SUB-${marker}`}, 'Registration Subject', 'active') returning id`;
    const [examSubject] = await tx`insert into exam_subjects (exam_session_id, subject_id, status) values (${session.id}, ${subject.id}, 'active') returning id`;
    return [{ tenantId: tenant.id, examTypeId: examType.id, sessionId: session.id, subjectId: subject.id, examSubjectId: examSubject.id }];
  });
  const input = { tenantId: fixture.tenantId, firstName: "Ada", middleName: "", lastName: "Student", email: `${marker}@example.com`, phone: `080${Date.now().toString().slice(-8)}`, dateOfBirth: "2008-05-12", gender: "female" as const, address: "1 Learning Street", state: "Lagos", lga: "Ikeja", school: "Demo School", classLevel: "SS3", academicInformation: "Demo fixture", examTypeId: fixture.examTypeId, examSessionId: fixture.sessionId, subjectIds: [fixture.subjectId], password: "ValidPass1" };

  await t.test("creates account, profile, registration, code, and pending payment", async () => {
    const result = await registerStudent(input);
    assert.ok(result.ok, JSON.stringify(result));
    if (!result.ok) return;
    assert.match(result.value.studentCode, /^STU-\d{4}-[A-Z2-9]{6}$/);
    assert.match(result.value.confirmationCode, /^EXF-[A-F0-9]{10}$/);
    assert.equal(result.value.status, "payment_pending");
    const rows = await withBootstrap((tx) => tx`select sr.status, pr.status as payment_status, n.status as notification_status, n.payload from student_registrations sr join payment_requirements pr on pr.registration_id = sr.id join notifications n on n.user_id = sr.user_id where sr.id = ${result.value.registrationId} and n.notification_type = 'student.registration.confirmed'`);
    assert.equal(rows[0].status, "payment_pending");
    assert.equal(rows[0].payment_status, "pending");
    assert.equal(rows[0].notification_status, "queued");
    assert.equal(rows[0].payload.paymentUrl, "Payment link pending provider configuration");
    const delivery = await processQueuedEmails();
    assert.equal(delivery.sent, 0);
    const deferred = await withBootstrap((tx) => tx`select status, last_error from notifications where user_id = ${result.value.userId} and notification_type = 'student.registration.confirmed'`);
    assert.equal(deferred[0].status, "queued");
    assert.match(String(deferred[0].last_error), /provider/i);
  });

  await t.test("rejects duplicate email and duplicate registration", async () => {
    const duplicate = await registerStudent(input);
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.error.code, "CONFLICT");
  });

  await t.test("rejects an invalid subject for the session", async () => {
    const invalid = await registerStudent({ ...input, email: `invalid-${marker}@example.com`, subjectIds: ["00000000-0000-0000-0000-000000000000"] });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.error.code, "VALIDATION_ERROR");
  });

  await t.test("cleans up registration fixtures", async () => {
    await withBootstrap(async (tx) => {
      await tx`delete from payment_requirements where registration_id in (select id from student_registrations where tenant_id = ${fixture.tenantId})`;
      await tx`delete from registration_confirmations where registration_id in (select id from student_registrations where tenant_id = ${fixture.tenantId})`;
      await tx`delete from notifications where tenant_id = ${fixture.tenantId}`;
      await tx`delete from student_registrations where tenant_id = ${fixture.tenantId}`;
      await tx`delete from student_profiles where tenant_id = ${fixture.tenantId}`;
      await tx`delete from tenants where id = ${fixture.tenantId}`;
      await tx`delete from exam_subjects where id = ${fixture.examSubjectId}`;
      await tx`delete from exam_sessions where id = ${fixture.sessionId}`;
      await tx`delete from subjects where id = ${fixture.subjectId}`;
      await tx`delete from exam_types where id = ${fixture.examTypeId}`;
      await tx`delete from users where email = ${input.email}`;
    });
  });
});
