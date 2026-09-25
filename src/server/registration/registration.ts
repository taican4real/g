import { randomBytes } from "node:crypto";
import { withSystem, type Sql } from "../db/client";
import { hashPassword } from "../security/passwords";
import { err, ok, type Result } from "../shared/result";
import type { RegistrationInput } from "../validation/registration.validation";
import { queueEmail } from "../notifications/outbox";

export type RegistrationOptions = {
  tenants: Record<string, unknown>[];
  examTypes: Record<string, unknown>[];
  examSessions: Record<string, unknown>[];
  subjects: Record<string, unknown>[];
  examSubjects: Record<string, unknown>[];
};

function codeSuffix() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function uniqueStudentCode(tx: Sql): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = `STU-${new Date().getUTCFullYear()}-${codeSuffix()}`;
    const rows = await tx`select 1 from student_registrations where student_code = ${code} limit 1`;
    if (!rows.length) return code;
  }
  throw new Error("Unable to generate a unique student code");
}

function confirmationCode() {
  return `EXF-${randomBytes(5).toString("hex").toUpperCase()}`;
}

export async function listRegistrationOptions(): Promise<RegistrationOptions> {
  return withSystem(async (tx) => {
    const [tenants, examTypes, examSessions, subjects, examSubjects] = await Promise.all([
      tx`select id, name, slug from tenants where status = 'active' order by name`,
      tx`select id, code, name from exam_types where status = 'active' order by name`,
      tx`select id, exam_type_id, code, name, starts_on, ends_on from exam_sessions where status = 'active' order by name`,
      tx`select distinct s.id, s.code, s.name from subjects s join exam_subjects es on es.subject_id = s.id and es.status = 'active' where s.status = 'active' order by s.name`,
      tx`select exam_session_id, subject_id from exam_subjects where status = 'active'`,
    ]);
    return { tenants: tenants as Record<string, unknown>[], examTypes: examTypes as Record<string, unknown>[], examSessions: examSessions as Record<string, unknown>[], subjects: subjects as Record<string, unknown>[], examSubjects: examSubjects as Record<string, unknown>[] };
  });
}

export async function registerStudent(input: RegistrationInput): Promise<Result<{
  registrationId: string;
  userId: string;
  studentCode: string;
  confirmationCode: string;
  status: "payment_pending";
  paymentRequirementId: string;
}>> {
  return withSystem(async (tx) => {
    const [tenant] = await tx`select id from tenants where id = ${input.tenantId} and status = 'active' limit 1`;
    if (!tenant) return err("VALIDATION_ERROR", "Selected centre is not available");

    const [session] = await tx`select id, exam_type_id from exam_sessions where id = ${input.examSessionId} and exam_type_id = ${input.examTypeId} and status = 'active' limit 1`;
    if (!session) return err("VALIDATION_ERROR", "Selected examination session is not valid for this examination");

    const allowedSubjects = await tx`
      select subject_id from exam_subjects
      where exam_session_id = ${input.examSessionId}
        and status = 'active'
        and subject_id in ${tx(input.subjectIds)}
    `;
    if (allowedSubjects.length !== input.subjectIds.length) return err("VALIDATION_ERROR", "One or more selected subjects are not permitted for this examination session");

    const [existingUser] = await tx`select id from users where lower(email) = ${input.email} limit 1`;
    if (existingUser) return err("CONFLICT", "An account already exists for this email address");

    const [existingRegistration] = await tx`
      select 1 from student_registrations sr
      join users u on u.id = sr.user_id
      where lower(u.email) = ${input.email} and sr.exam_session_id = ${input.examSessionId}
      limit 1
    `;
    if (existingRegistration) return err("CONFLICT", "A registration already exists for this email and examination session");

    const passwordHash = await hashPassword(input.password);
    const [user] = await tx`
      insert into users (auth_provider, external_subject, email, phone, display_name, password_hash, status)
      values ('local', ${input.email}, ${input.email}, ${input.phone}, ${`${input.firstName} ${input.lastName}`}, ${passwordHash}, 'active')
      returning id
    `;
    const [profile] = await tx`
      insert into student_profiles (
        tenant_id, user_id, first_name, middle_name, last_name, date_of_birth,
        gender, address, state, lga, school, class_level, academic_information, status
      ) values (
        ${input.tenantId}, ${user.id}, ${input.firstName}, ${input.middleName || null}, ${input.lastName}, ${input.dateOfBirth},
        ${input.gender}, ${input.address}, ${input.state}, ${input.lga}, ${input.school}, ${input.classLevel}, ${input.academicInformation || null}, 'provisional'
      ) returning id
    `;
    await tx`insert into tenant_memberships (tenant_id, user_id, membership_status, human_code) values (${input.tenantId}, ${user.id}, 'active', ${`STU-${new Date().getUTCFullYear()}-${codeSuffix()}`})`;
    const [studentRole] = await tx`select id from roles where code = 'student' limit 1`;
    if (studentRole) await tx`insert into user_roles (tenant_id, user_id, role_id) values (${input.tenantId}, ${user.id}, ${studentRole.id})`;

    const studentCode = await uniqueStudentCode(tx);
    const confirmation = confirmationCode();
    const [registration] = await tx`
      insert into student_registrations (tenant_id, user_id, student_profile_id, exam_type_id, exam_session_id, student_code, status, confirmation_code)
      values (${input.tenantId}, ${user.id}, ${profile.id}, ${input.examTypeId}, ${input.examSessionId}, ${studentCode}, 'payment_pending', ${confirmation})
      returning id, status
    `;
    // Link the tenant's active payment plan for this examination. A plan
    // scoped to the exam type is preferred; an unscoped active plan is the
    // fallback. When no plan exists (legacy fixtures, draft curriculum),
    // registration still succeeds with a zero-amount requirement — the
    // payment session flow will not invent a charge.
    const [plan] = await tx`
      select id, amount_minor, entitlement_duration_days
      from payment_plans
      where tenant_id = ${input.tenantId}
        and status = 'active'
        and (exam_type_id is null or exam_type_id = ${input.examTypeId})
      order by (exam_type_id is not null) desc, created_at asc
      limit 1
    `;
    const pendingAmount = { planId: plan?.id as string | null, amountMinor: Number(plan?.amount_minor ?? 0) };

    const [payment] = await tx`
      insert into payment_requirements (registration_id, amount_minor, currency, status, plan_id)
      values (${registration.id}, ${pendingAmount.amountMinor}, 'NGN', 'pending', ${pendingAmount.planId ?? null}) returning id
    `;
    await tx`insert into registration_subjects (registration_id, exam_subject_id) select ${registration.id}, id from exam_subjects where exam_session_id = ${input.examSessionId} and subject_id in ${tx(input.subjectIds)}`;
    await tx`insert into registration_confirmations (registration_id, confirmation_code) values (${registration.id}, ${confirmation})`;
    const [details] = await tx`
      select et.name as examination, string_agg(s.name, ', ' order by s.name) as subjects
      from exam_sessions es
      join exam_types et on et.id = es.exam_type_id
      join exam_subjects exs on exs.exam_session_id = es.id
      join subjects s on s.id = exs.subject_id
      where es.id = ${input.examSessionId} and exs.subject_id in ${tx(input.subjectIds)}
      group by et.name
    `;
    await queueEmail(tx, {
      tenantId: input.tenantId,
      userId: user.id,
      recipientEmail: input.email,
      notificationType: "student.registration.confirmed",
      templateCode: "student.registration.confirmed",
      payload: {
        firstName: input.firstName,
        studentCode,
        examination: details.examination,
        subjects: details.subjects,
        paymentInstructions: "Your centre will provide payment instructions. Payment is not confirmed by this email.",
        paymentUrl: "Payment link pending provider configuration",
        loginUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/login`,
      },
    });

    return ok({ registrationId: registration.id, userId: user.id, studentCode, confirmationCode: confirmation, status: "payment_pending" as const, paymentRequirementId: payment.id });
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Registration could not be completed";
    if (message.includes("duplicate") || message.includes("unique")) {
      return err("CONFLICT", "This registration already exists");
    }
    return err("INTERNAL_ERROR", "Registration could not be completed");
  });
}
