import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

if (!process.env.DATABASE_URL && existsSync(join(process.cwd(), ".env.local"))) process.loadEnvFile(join(process.cwd(), ".env.local"));

import { withBootstrap } from "../db/client";
import { createTenant } from "../tenants/tenants";
import { login } from "../auth/authentication";
import { resolveTenantContext } from "../auth/context";
import { registerTeacher, reviewTeacherRegistration } from "../teacher-registration/teacher-registration";
import { teacherRegistrationSchema } from "../validation/teacher-registration.validation";

const skipAll = !process.env.DATABASE_URL;
const skipOrRun = skipAll ? { skip: "DATABASE_URL not set — run pnpm db:migrate first" } : undefined;

test("phase 5 integration: teacher registration and approval", { timeout: 60_000, ...(skipOrRun ?? {}) }, async (t) => {
  const marker = `p5-${Date.now().toString(36)}`;
  const centre = await createTenant({ name: `Teacher Centre ${marker}`, slug: `teacher-${marker}`, adminEmail: `admin-${marker}@example.com`, adminDisplayName: "Centre Admin", adminPassword: "CentrePass1", actorUserId: null });
  assert.ok(centre.ok);
  if (!centre.ok) return;
  const adminLogin = await login({ identifier: `admin-${marker}@example.com`, password: "CentrePass1" });
  assert.ok(adminLogin.ok);
  if (!adminLogin.ok) return;
  const context = await resolveTenantContext({ sessionId: "test", userId: centre.value.admin.id, activeTenantId: centre.value.tenant.id, authMethod: "password" });
  assert.ok(context.ok);
  if (!context.ok) return;

  const curriculum = await withBootstrap(async (tx) => {
    const [exam] = await tx`insert into exam_types (code, name, status) values (${`TE-${marker}`}, 'Teacher Exam', 'active') returning id`;
    const [session] = await tx`insert into exam_sessions (exam_type_id, code, name, status) values (${exam.id}, '2026', 'Teacher Session', 'active') returning id`;
    const [subject] = await tx`insert into subjects (code, name, status) values (${`TS-${marker}`}, 'Teacher Subject', 'active') returning id`;
    await tx`insert into exam_subjects (exam_session_id, subject_id, status) values (${session.id}, ${subject.id}, 'active')`;
    const [otherExam] = await tx`insert into exam_types (code, name, status) values (${`TO-${marker}`}, 'Other Exam', 'active') returning id`;
    return { examId: exam.id, subjectId: subject.id, otherExamId: otherExam.id };
  });

  const input = (suffix: string) => ({ tenantId: centre.value.tenant.id, fullName: `Teacher ${suffix}`, email: `teacher-${suffix}-${marker}@example.com`, phone: `081${Date.now().toString().slice(-8)}`, professionalInformation: "Experienced educator", qualifications: "B.Ed Education", examTypeIds: [curriculum.examId], subjectIds: [curriculum.subjectId], password: "TeacherPass1" });
  const registrations: string[] = [];

  await t.test("valid registration is pending and has no teacher access", async () => {
    const result = await registerTeacher(input("approve"));
    assert.ok(result.ok, JSON.stringify(result));
    if (!result.ok) return;
    registrations.push(result.value.registrationId);
    assert.match(result.value.teacherCode, /^TCH-\d{4}-[A-Z2-9]{6}$/);
    assert.equal(result.value.status, "pending_approval");
    const teacherEmail = await withBootstrap((tx) => tx`select payload from notifications n join teacher_registrations tr on tr.id = ${result.value.registrationId} where n.user_id = tr.user_id`);
    assert.ok(teacherEmail[0]);
    assert.equal("paymentUrl" in teacherEmail[0].payload, false);
    const pendingLogin = await login({ identifier: input("approve").email, password: "TeacherPass1" });
    assert.equal(pendingLogin.ok, false);
    if (!pendingLogin.ok) assert.equal(pendingLogin.error.code, "ACCOUNT_INACTIVE");
  });

  await t.test("missing selections and invalid combinations are rejected", async () => {
    const missing = teacherRegistrationSchema.safeParse({ ...input("missing"), examTypeIds: [], subjectIds: [] });
    assert.equal(missing.success, false);
    const invalid = await registerTeacher({ ...input("invalid"), examTypeIds: [curriculum.otherExamId] });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.error.code, "VALIDATION_ERROR");
  });

  await t.test("duplicate email is rejected", async () => {
    const duplicate = await registerTeacher(input("approve"));
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.error.code, "CONFLICT");
  });

  await t.test("centre admin can approve, reject, and suspend", async () => {
    for (const action of ["rejected", "suspended"] as const) {
      const created = await registerTeacher(input(action));
      assert.ok(created.ok);
      if (created.ok) {
        registrations.push(created.value.registrationId);
        const reviewed = await reviewTeacherRegistration(context.value, created.value.registrationId, { status: action, reviewNote: "Reviewed in integration test" });
        assert.ok(reviewed.ok, JSON.stringify(reviewed));
      }
    }
    const approved = await reviewTeacherRegistration(context.value, registrations[0], { status: "approved", reviewNote: "Approved in integration test" });
    assert.ok(approved.ok, JSON.stringify(approved));
    const approvedLogin = await login({ identifier: input("approve").email, password: "TeacherPass1" });
    assert.ok(approvedLogin.ok, JSON.stringify(approvedLogin));
  });

  await t.test("unauthorized context cannot review", async () => {
    const denied = await reviewTeacherRegistration({ ...context.value, roles: ["student"], permissions: ["self.profile.manage"] }, registrations[0], { status: "suspended", reviewNote: "" });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.code, "FORBIDDEN");
  });

  await t.test("cleanup integration fixtures", async () => {
    await withBootstrap(async (tx) => {
      await tx`delete from teacher_registrations where tenant_id = ${centre.value.tenant.id}`;
      await tx`delete from notifications where tenant_id = ${centre.value.tenant.id}`;
      await tx`delete from teacher_profiles where tenant_id = ${centre.value.tenant.id}`;
      await tx`delete from users where email like ${`teacher-%-${marker}@example.com`}`;
      await tx`delete from tenants where id = ${centre.value.tenant.id}`;
      await tx`delete from exam_subjects where subject_id = ${curriculum.subjectId}`;
      await tx`delete from exam_sessions where exam_type_id in (${curriculum.examId}, ${curriculum.otherExamId})`;
      await tx`delete from subjects where id = ${curriculum.subjectId}`;
      await tx`delete from exam_types where id in (${curriculum.examId}, ${curriculum.otherExamId})`;
    });
  });
});
