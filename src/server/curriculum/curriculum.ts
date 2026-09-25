import { withPlatform, type Sql } from "../db/client";
import { err, ok, type Result } from "../shared/result";
import type { CurriculumCreateInput, CurriculumUpdateInput } from "../validation/curriculum.validation";

export type CurriculumEntity = "examType" | "examSession" | "subject" | "examSubject" | "syllabus" | "syllabusSubject" | "topic" | "subtopic" | "learningObjective";

export type CurriculumCatalogue = {
  examTypes: Record<string, unknown>[];
  examSessions: Record<string, unknown>[];
  subjects: Record<string, unknown>[];
  examSubjects: Record<string, unknown>[];
  syllabi: Record<string, unknown>[];
  syllabusSubjects: Record<string, unknown>[];
  topics: Record<string, unknown>[];
  subtopics: Record<string, unknown>[];
  learningObjectives: Record<string, unknown>[];
};

async function exists(tx: Sql, table: string, id: string): Promise<boolean> {
  const allowed = new Set(["exam_types", "exam_sessions", "subjects", "exam_subjects", "syllabi", "syllabus_subjects", "topics", "subtopics", "learning_objectives"]);
  if (!allowed.has(table)) throw new Error("Invalid curriculum table");
  const rows = await tx.unsafe(`select 1 from ${table} where id = $1 limit 1`, [id]);
  return rows.length > 0;
}

export async function listCurriculum(): Promise<CurriculumCatalogue> {
  return withPlatform(async (tx) => {
    const [examTypes, examSessions, subjects, examSubjects, syllabi, syllabusSubjects, topics, subtopics, learningObjectives] = await Promise.all([
      tx`select id, code, name, description, status, created_at from exam_types order by name`,
      tx`select es.id, es.exam_type_id, et.name as exam_type_name, es.code, es.name, es.starts_on, es.ends_on, es.status from exam_sessions es join exam_types et on et.id = es.exam_type_id order by et.name, es.name`,
      tx`select id, code, name, description, status from subjects order by name`,
      tx`select exs.id, exs.exam_session_id, es.name as exam_session_name, exs.subject_id, s.name as subject_name, exs.status from exam_subjects exs join exam_sessions es on es.id = exs.exam_session_id join subjects s on s.id = exs.subject_id order by es.name, s.name`,
      tx`select sy.id, sy.exam_session_id, es.name as exam_session_name, sy.name, sy.version, sy.description, sy.status, sy.is_demo_data from syllabi sy join exam_sessions es on es.id = sy.exam_session_id order by es.name, sy.name, sy.version`,
      tx`select ss.id, ss.syllabus_id, sy.name as syllabus_name, ss.subject_id, s.name as subject_name, ss.status from syllabus_subjects ss join syllabi sy on sy.id = ss.syllabus_id join subjects s on s.id = ss.subject_id order by sy.name, s.name`,
      tx`select t.id, t.syllabus_subject_id, t.name, t.description, t.sort_order, t.status from topics t order by t.sort_order, t.name`,
      tx`select st.id, st.topic_id, st.name, st.description, st.sort_order, st.status from subtopics st order by st.sort_order, st.name`,
      tx`select lo.id, lo.subtopic_id, lo.statement, lo.sort_order, lo.status from learning_objectives lo order by lo.sort_order, lo.statement`,
    ]);
    return { examTypes: examTypes as Record<string, unknown>[], examSessions: examSessions as Record<string, unknown>[], subjects: subjects as Record<string, unknown>[], examSubjects: examSubjects as Record<string, unknown>[], syllabi: syllabi as Record<string, unknown>[], syllabusSubjects: syllabusSubjects as Record<string, unknown>[], topics: topics as Record<string, unknown>[], subtopics: subtopics as Record<string, unknown>[], learningObjectives: learningObjectives as Record<string, unknown>[] };
  });
}

export async function listPublicExaminations() {
  return withPlatform(async (tx) => tx`
    select et.id as exam_type_id, et.code as exam_type_code, et.name as exam_type_name,
      es.id as exam_session_id, es.code as exam_session_code, es.name as exam_session_name,
      s.id as subject_id, s.code as subject_code, s.name as subject_name
    from exam_types et
    join exam_sessions es on es.exam_type_id = et.id and es.status = 'active'
    left join exam_subjects exs on exs.exam_session_id = es.id and exs.status = 'active'
    left join subjects s on s.id = exs.subject_id and s.status = 'active'
    where et.status = 'active'
    order by et.name, es.name, s.name
  `);
}

export async function createCurriculum(input: CurriculumCreateInput, actorUserId: string | null): Promise<Result<Record<string, unknown>>> {
  return withPlatform(async (tx) => {
    let row: Record<string, unknown>;
    switch (input.entity) {
      case "examType": [row] = await tx`insert into exam_types (code, name, description, status, created_by) values (${input.code}, ${input.name}, ${input.description ?? null}, ${input.status}, ${actorUserId}) returning *`; break;
      case "examSession":
        if (!await exists(tx, "exam_types", input.examTypeId)) return err("NOT_FOUND", "Examination type not found");
        [row] = await tx`insert into exam_sessions (exam_type_id, code, name, starts_on, ends_on, status, created_by) values (${input.examTypeId}, ${input.code}, ${input.name}, ${input.startsOn ?? null}, ${input.endsOn ?? null}, ${input.status}, ${actorUserId}) returning *`; break;
      case "subject": [row] = await tx`insert into subjects (code, name, description, status, created_by) values (${input.code}, ${input.name}, ${input.description ?? null}, ${input.status}, ${actorUserId}) returning *`; break;
      case "examSubject":
        if (!await exists(tx, "exam_sessions", input.examSessionId) || !await exists(tx, "subjects", input.subjectId)) return err("NOT_FOUND", "Examination session or subject not found");
        [row] = await tx`insert into exam_subjects (exam_session_id, subject_id, status, created_by) values (${input.examSessionId}, ${input.subjectId}, ${input.status}, ${actorUserId}) returning *`; break;
      case "syllabus":
        if (!await exists(tx, "exam_sessions", input.examSessionId)) return err("NOT_FOUND", "Examination session not found");
        [row] = await tx`insert into syllabi (exam_session_id, name, version, description, status, is_demo_data, created_by) values (${input.examSessionId}, ${input.name}, ${input.version}, ${input.description ?? null}, ${input.status}, ${input.isDemoData}, ${actorUserId}) returning *`; break;
      case "syllabusSubject":
        if (!await exists(tx, "syllabi", input.syllabusId) || !await exists(tx, "subjects", input.subjectId)) return err("NOT_FOUND", "Syllabus or subject not found");
        [row] = await tx`insert into syllabus_subjects (syllabus_id, subject_id, status, created_by) values (${input.syllabusId}, ${input.subjectId}, ${input.status}, ${actorUserId}) returning *`; break;
      case "topic":
        if (!await exists(tx, "syllabus_subjects", input.syllabusSubjectId)) return err("NOT_FOUND", "Syllabus subject not found");
        [row] = await tx`insert into topics (syllabus_subject_id, name, description, sort_order, status, created_by) values (${input.syllabusSubjectId}, ${input.name}, ${input.description ?? null}, ${input.sortOrder}, ${input.status}, ${actorUserId}) returning *`; break;
      case "subtopic":
        if (!await exists(tx, "topics", input.topicId)) return err("NOT_FOUND", "Topic not found");
        [row] = await tx`insert into subtopics (topic_id, name, description, sort_order, status, created_by) values (${input.topicId}, ${input.name}, ${input.description ?? null}, ${input.sortOrder}, ${input.status}, ${actorUserId}) returning *`; break;
      case "learningObjective":
        if (!await exists(tx, "subtopics", input.subtopicId)) return err("NOT_FOUND", "Subtopic not found");
        [row] = await tx`insert into learning_objectives (subtopic_id, statement, sort_order, status, created_by) values (${input.subtopicId}, ${input.statement}, ${input.sortOrder}, ${input.status}, ${actorUserId}) returning *`; break;
    }
    return ok(row);
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Curriculum item could not be created";
    if (message.includes("duplicate") || message.includes("unique")) return err("CONFLICT", "This curriculum item already exists");
    if (message.includes("subject is not active")) return err("VALIDATION_ERROR", "The subject is not associated with this examination session");
    return err("VALIDATION_ERROR", "Curriculum item could not be created");
  });
}

export async function updateCurriculum(entity: CurriculumEntity, id: string, input: CurriculumUpdateInput, actorUserId: string | null): Promise<Result<Record<string, unknown>>> {
  return withPlatform(async (tx) => {
    let row: Record<string, unknown>;
    if (entity === "examType") [row] = await tx`update exam_types set name = coalesce(${input.name ?? null}, name), description = coalesce(${input.description ?? null}, description), status = coalesce(${input.status ?? null}, status), updated_by = ${actorUserId} where id = ${id} returning *`;
    else if (entity === "examSession") [row] = await tx`update exam_sessions set name = coalesce(${input.name ?? null}, name), starts_on = coalesce(${input.startsOn ?? null}, starts_on), ends_on = coalesce(${input.endsOn ?? null}, ends_on), status = coalesce(${input.status ?? null}, status), updated_by = ${actorUserId} where id = ${id} returning *`;
    else if (entity === "subject") [row] = await tx`update subjects set name = coalesce(${input.name ?? null}, name), description = coalesce(${input.description ?? null}, description), status = coalesce(${input.status ?? null}, status), updated_by = ${actorUserId} where id = ${id} returning *`;
    else if (entity === "syllabus") [row] = await tx`update syllabi set name = coalesce(${input.name ?? null}, name), version = coalesce(${input.version ?? null}, version), description = coalesce(${input.description ?? null}, description), status = coalesce(${input.status ?? null}, status), is_demo_data = coalesce(${input.isDemoData ?? null}, is_demo_data), updated_by = ${actorUserId} where id = ${id} returning *`;
    else if (entity === "topic") [row] = await tx`update topics set name = coalesce(${input.name ?? null}, name), description = coalesce(${input.description ?? null}, description), sort_order = coalesce(${input.sortOrder ?? null}, sort_order), status = coalesce(${input.status ?? null}, status), updated_by = ${actorUserId} where id = ${id} returning *`;
    else if (entity === "subtopic") [row] = await tx`update subtopics set name = coalesce(${input.name ?? null}, name), description = coalesce(${input.description ?? null}, description), sort_order = coalesce(${input.sortOrder ?? null}, sort_order), status = coalesce(${input.status ?? null}, status), updated_by = ${actorUserId} where id = ${id} returning *`;
    else if (entity === "learningObjective") [row] = await tx`update learning_objectives set statement = coalesce(${input.statement ?? null}, statement), sort_order = coalesce(${input.sortOrder ?? null}, sort_order), status = coalesce(${input.status ?? null}, status), updated_by = ${actorUserId} where id = ${id} returning *`;
    else if (entity === "examSubject") [row] = await tx`update exam_subjects set status = coalesce(${input.status ?? null}, status) where id = ${id} returning *`;
    else [row] = await tx`update syllabus_subjects set status = coalesce(${input.status ?? null}, status) where id = ${id} returning *`;
    return row ? ok(row) : err("NOT_FOUND", "Curriculum item not found");
  });
}
