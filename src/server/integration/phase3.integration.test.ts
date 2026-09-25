import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

if (!process.env.DATABASE_URL && existsSync(join(process.cwd(), ".env.local"))) {
  process.loadEnvFile(join(process.cwd(), ".env.local"));
}

import { withBootstrap } from "../db/client";
import { createCurriculum, listPublicExaminations, updateCurriculum } from "../curriculum/curriculum";

const skipAll = !process.env.DATABASE_URL;
const skipOrRun = skipAll ? { skip: "DATABASE_URL not set — run pnpm db:migrate first" } : undefined;

test("phase 3 integration: curriculum hierarchy and lifecycle", { timeout: 60_000, ...(skipOrRun ?? {}) }, async (t) => {
  const marker = `p3-${Date.now().toString(36)}`;
  const actor = null;
  const ids: Record<string, string> = {};

  await t.test("creates an examination type and session", async () => {
    const exam = await createCurriculum({ entity: "examType", code: marker, name: `Demo Examination ${marker}`, description: "Demonstration data only", status: "draft" }, actor);
    assert.ok(exam.ok, JSON.stringify(exam));
    if (!exam.ok) return;
    ids.examType = String(exam.value.id);
    const session = await createCurriculum({ entity: "examSession", examTypeId: ids.examType, code: "DEMO-2026", name: "Demonstration Session 2026", status: "draft" }, actor);
    assert.ok(session.ok, JSON.stringify(session));
    if (session.ok) ids.examSession = String(session.value.id);
  });

  await t.test("adds and associates a subject", async () => {
    const subject = await createCurriculum({ entity: "subject", code: `${marker}-SUB`, name: `Demo Subject ${marker}`, description: "Demonstration data only", status: "draft" }, actor);
    assert.ok(subject.ok, JSON.stringify(subject));
    if (!subject.ok) return;
    ids.subject = String(subject.value.id);
    const association = await createCurriculum({ entity: "examSubject", examSessionId: ids.examSession, subjectId: ids.subject, status: "active" }, actor);
    assert.ok(association.ok, JSON.stringify(association));
    if (association.ok) ids.examSubject = String(association.value.id);
  });

  await t.test("creates a syllabus and topic hierarchy", async () => {
    const syllabus = await createCurriculum({ entity: "syllabus", examSessionId: ids.examSession, name: `Demo Syllabus ${marker}`, version: "1.0", description: "Demonstration data only", status: "draft", isDemoData: true }, actor);
    assert.ok(syllabus.ok, JSON.stringify(syllabus));
    if (!syllabus.ok) return;
    ids.syllabus = String(syllabus.value.id);
    const syllabusSubject = await createCurriculum({ entity: "syllabusSubject", syllabusId: ids.syllabus, subjectId: ids.subject, status: "active" }, actor);
    assert.ok(syllabusSubject.ok, JSON.stringify(syllabusSubject));
    if (!syllabusSubject.ok) return;
    ids.syllabusSubject = String(syllabusSubject.value.id);
    const topic = await createCurriculum({ entity: "topic", syllabusSubjectId: ids.syllabusSubject, name: `Demo Topic ${marker}`, description: "Demonstration data only", sortOrder: 0, status: "draft" }, actor);
    assert.ok(topic.ok, JSON.stringify(topic));
    if (topic.ok) ids.topic = String(topic.value.id);
  });

  await t.test("edits and activates a topic", async () => {
    const edited = await updateCurriculum("topic", ids.topic, { name: `Edited Topic ${marker}`, status: "active" }, actor);
    assert.ok(edited.ok, JSON.stringify(edited));
    if (edited.ok) assert.equal(edited.value.status, "active");
    const deactivated = await updateCurriculum("topic", ids.topic, { status: "inactive" }, actor);
    assert.ok(deactivated.ok, JSON.stringify(deactivated));
    if (deactivated.ok) assert.equal(deactivated.value.status, "inactive");
  });

  await t.test("rejects an invalid examination subject combination", async () => {
    const otherSubject = await createCurriculum({ entity: "subject", code: `${marker}-OTHER`, name: `Other Subject ${marker}`, status: "draft" }, actor);
    assert.ok(otherSubject.ok);
    if (!otherSubject.ok) return;
    ids.otherSubject = String(otherSubject.value.id);
    const invalid = await createCurriculum({ entity: "syllabusSubject", syllabusId: ids.syllabus, subjectId: ids.otherSubject, status: "active" }, actor);
    assert.equal(invalid.ok, false);
  });

  await t.test("only active records appear publicly", async () => {
    const rows = await listPublicExaminations();
    assert.equal(rows.some((row) => row.exam_type_id === ids.examType), false);
    const activatedType = await updateCurriculum("examType", ids.examType, { status: "active" }, actor);
    assert.ok(activatedType.ok);
    const activatedSession = await updateCurriculum("examSession", ids.examSession, { status: "active" }, actor);
    assert.ok(activatedSession.ok);
    const activatedSubject = await updateCurriculum("subject", ids.subject, { status: "active" }, actor);
    assert.ok(activatedSubject.ok);
    const publicRows = await listPublicExaminations();
    assert.ok(publicRows.some((row) => row.exam_type_id === ids.examType && row.subject_id === ids.subject));
  });

  await t.test("cleanup integration fixtures", async () => {
    await withBootstrap(async (tx) => {
      await tx`delete from learning_objectives where subtopic_id in (select st.id from subtopics st join topics t on t.id = st.topic_id join syllabus_subjects ss on ss.id = t.syllabus_subject_id join syllabi sy on sy.id = ss.syllabus_id where sy.id = ${ids.syllabus})`;
      await tx`delete from subtopics where topic_id in (select t.id from topics t join syllabus_subjects ss on ss.id = t.syllabus_subject_id where ss.syllabus_id = ${ids.syllabus})`;
      await tx`delete from topics where syllabus_subject_id in (select id from syllabus_subjects where syllabus_id = ${ids.syllabus})`;
      await tx`delete from syllabus_subjects where syllabus_id = ${ids.syllabus}`;
      await tx`delete from syllabi where id = ${ids.syllabus}`;
      await tx`delete from exam_subjects where exam_session_id = ${ids.examSession}`;
      await tx`delete from exam_sessions where id = ${ids.examSession}`;
      await tx`delete from exam_types where id = ${ids.examType}`;
      await tx`delete from subjects where id in (${ids.subject}, ${ids.otherSubject ?? "00000000-0000-0000-0000-000000000000"})`;
    });
  });
});
