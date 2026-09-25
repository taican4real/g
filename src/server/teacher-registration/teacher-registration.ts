import { randomBytes } from "node:crypto";
import { withSystem, withTenant, type Sql } from "../db/client";
import { hashPassword } from "../security/passwords";
import { err, ok, type Result } from "../shared/result";
import type { TenantContext } from "../types/access";
import type { TeacherRegistrationInput, TeacherReviewInput } from "../validation/teacher-registration.validation";
import { queueEmail } from "../notifications/outbox";

function codeSuffix() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join("");
}

async function uniqueTeacherCode(tx: Sql): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `TCH-${new Date().getUTCFullYear()}-${codeSuffix()}`;
    const rows = await tx`select 1 from teacher_profiles where teacher_code = ${code} limit 1`;
    if (!rows.length) return code;
  }
  throw new Error("Unable to generate a unique teacher code");
}

export async function registerTeacher(input: TeacherRegistrationInput): Promise<Result<{ registrationId: string; teacherCode: string; status: "pending_approval" }>> {
  return withSystem(async (tx) => {
    const [tenant] = await tx`select id from tenants where id = ${input.tenantId} and status = 'active' limit 1`;
    if (!tenant) return err("VALIDATION_ERROR", "Selected centre is not available");
    const [existingUser] = await tx`select id from users where lower(email) = ${input.email} limit 1`;
    if (existingUser) return err("CONFLICT", "An account already exists for this email address");

    const exams = await tx`select id from exam_types where id in ${tx(input.examTypeIds)} and status in ('active', 'draft')`;
    if (exams.length !== input.examTypeIds.length) return err("VALIDATION_ERROR", "One or more examination types are invalid");
    const subjects = await tx`select id from subjects where id in ${tx(input.subjectIds)} and status in ('active', 'draft')`;
    if (subjects.length !== input.subjectIds.length) return err("VALIDATION_ERROR", "One or more subjects are invalid");
    const validPairs = await tx`
      select distinct es.subject_id, et.id as exam_type_id
      from exam_subjects es
      join exam_sessions sess on sess.id = es.exam_session_id and sess.status in ('active', 'draft')
      join exam_types et on et.id = sess.exam_type_id and et.status in ('active', 'draft')
      where es.status = 'active' and es.subject_id in ${tx(input.subjectIds)} and et.id in ${tx(input.examTypeIds)}
    `;
    const hasSubjectForExam = input.examTypeIds.every((examId) => input.subjectIds.some((subjectId) => validPairs.some((pair) => pair.exam_type_id === examId && pair.subject_id === subjectId)));
    if (!hasSubjectForExam) return err("VALIDATION_ERROR", "Selected subjects are not valid for every examination type");

    const passwordHash = await hashPassword(input.password);
    const [user] = await tx`insert into users (auth_provider, external_subject, email, phone, display_name, password_hash, status) values ('local', ${input.email}, ${input.email}, ${input.phone}, ${input.fullName}, ${passwordHash}, 'pending') returning id`;
    const teacherCode = await uniqueTeacherCode(tx);
    const [profile] = await tx`insert into teacher_profiles (tenant_id, user_id, teacher_code, full_name, specialization, qualifications, status) values (${input.tenantId}, ${user.id}, ${teacherCode}, ${input.fullName}, ${input.professionalInformation}, ${input.qualifications}, 'invited') returning id`;
    const [registration] = await tx`insert into teacher_registrations (tenant_id, user_id, teacher_profile_id, status) values (${input.tenantId}, ${user.id}, ${profile.id}, 'pending_approval') returning id`;
    await tx`insert into teacher_registration_subjects (registration_id, subject_id) select ${registration.id}, id from subjects where id in ${tx(input.subjectIds)}`;
    await tx`insert into teacher_registration_exams (registration_id, exam_type_id) select ${registration.id}, id from exam_types where id in ${tx(input.examTypeIds)}`;
    const [details] = await tx`
      select
        (select string_agg(name, ', ' order by name) from exam_types where id in ${tx(input.examTypeIds)}) as examination_types,
        (select string_agg(name, ', ' order by name) from subjects where id in ${tx(input.subjectIds)}) as subjects
    `;
    await queueEmail(tx, {
      tenantId: input.tenantId,
      userId: user.id,
      recipientEmail: input.email,
      notificationType: "teacher.registration.submitted",
      templateCode: "teacher.registration.submitted",
      payload: {
        fullName: input.fullName,
        teacherCode,
        examinationTypes: details.examination_types,
        subjects: details.subjects,
        loginUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/login`,
      },
    });
    return ok({ registrationId: registration.id, teacherCode, status: "pending_approval" as const });
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Teacher registration could not be completed";
    return err(message.includes("unique") || message.includes("duplicate") ? "CONFLICT" : "INTERNAL_ERROR", message.includes("unique") || message.includes("duplicate") ? "This teacher registration already exists" : "Teacher registration could not be completed");
  });
}

export async function listTeacherRegistrationOptions() {
  return withSystem(async (tx) => {
    const [tenants, exams, subjects, pairs] = await Promise.all([
      tx`select id, name from tenants where status = 'active' order by name`,
      tx`select id, code, name from exam_types where status = 'active' order by name`,
      tx`select id, code, name from subjects where status = 'active' order by name`,
      tx`select distinct sess.exam_type_id, es.subject_id from exam_subjects es join exam_sessions sess on sess.id = es.exam_session_id where es.status = 'active' and sess.status = 'active'`,
    ]);
    return { tenants, exams, subjects, pairs };
  });
}

export async function listTeacherRegistrations(context: TenantContext): Promise<Result<Record<string, unknown>[]>> {
  if (!context.tenantId || (!context.roles.includes("centre_admin") && !context.roles.includes("platform_super_admin"))) return err("FORBIDDEN", "Centre administrator access is required");
  const rows = await withTenant(context.tenantId, context.userId, (tx) => tx`
    select tr.id, tr.status, tr.submitted_at, tr.reviewed_at, tr.review_note, u.email,
      tp.teacher_code, tp.full_name, tp.phone, tp.qualifications, tp.professional_information
    from teacher_registrations tr
    join users u on u.id = tr.user_id
    join teacher_profiles tp on tp.id = tr.teacher_profile_id
    where tr.tenant_id = ${context.tenantId}
    order by tr.created_at desc
  `);
  return ok(rows as Record<string, unknown>[]);
}

export async function reviewTeacherRegistration(context: TenantContext, registrationId: string, input: TeacherReviewInput): Promise<Result<{ status: string; teacherCode?: string }>> {
  if (!context.tenantId || !context.roles.includes("centre_admin")) return err("FORBIDDEN", "Centre administrator access is required");
  return withTenant(context.tenantId, context.userId, async (tx) => {
    const [registration] = await tx`select tr.id, tr.user_id, tr.teacher_profile_id from teacher_registrations tr where tr.id = ${registrationId} and tr.tenant_id = ${context.tenantId} for update`;
    if (!registration) return err("NOT_FOUND", "Teacher registration not found");
    if (input.status === "approved") {
      await tx`insert into tenant_memberships (tenant_id, user_id, membership_status, human_code) values (${context.tenantId}, ${registration.user_id}, 'active', ${`TCH-${new Date().getUTCFullYear()}-${codeSuffix()}`}) on conflict (tenant_id, user_id) do update set membership_status = 'active'`;
      const [role] = await tx`select id from roles where code = 'teacher' limit 1`;
      if (role) await tx`insert into user_roles (tenant_id, user_id, role_id, granted_by) values (${context.tenantId}, ${registration.user_id}, ${role.id}, ${context.userId}) on conflict do nothing`;
      await tx`update users set status = 'active', updated_by = ${context.userId} where id = ${registration.user_id}`;
      await tx`update teacher_profiles set status = 'active', updated_by = ${context.userId} where id = ${registration.teacher_profile_id}`;
    } else {
      await tx`update users set status = ${input.status === "suspended" ? "suspended" : "deactivated"}, updated_by = ${context.userId} where id = ${registration.user_id}`;
      await tx`update teacher_profiles set status = ${input.status === "suspended" ? "suspended" : "removed"}, updated_by = ${context.userId} where id = ${registration.teacher_profile_id}`;
    }
    await tx`update teacher_registrations set status = ${input.status}, reviewed_at = now(), reviewed_by = ${context.userId}, review_note = ${input.reviewNote || null} where id = ${registrationId}`;
    return ok({ status: input.status });
  });
}
