import { z } from "zod";

const code = z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, hyphens, or underscores");
const name = z.string().trim().min(2).max(160);
const description = z.string().trim().max(2000).optional().nullable();
const status = z.enum(["draft", "active", "inactive", "archived"]);
const activeStatus = z.enum(["active", "inactive"]);
const uuid = z.uuid();

export const curriculumCreateSchema = z.discriminatedUnion("entity", [
  z.object({ entity: z.literal("examType"), code, name, description, status: status.default("draft") }),
  z.object({ entity: z.literal("examSession"), examTypeId: uuid, code, name, startsOn: z.string().date().optional().nullable(), endsOn: z.string().date().optional().nullable(), status: status.default("draft") }),
  z.object({ entity: z.literal("subject"), code, name, description, status: status.default("draft") }),
  z.object({ entity: z.literal("examSubject"), examSessionId: uuid, subjectId: uuid, status: activeStatus.default("active") }),
  z.object({ entity: z.literal("syllabus"), examSessionId: uuid, name, version: z.string().trim().min(1).max(40), description, status: status.default("draft"), isDemoData: z.boolean().default(false) }),
  z.object({ entity: z.literal("syllabusSubject"), syllabusId: uuid, subjectId: uuid, status: activeStatus.default("active") }),
  z.object({ entity: z.literal("topic"), syllabusSubjectId: uuid, name, description, sortOrder: z.number().int().min(0).default(0), status: status.default("draft") }),
  z.object({ entity: z.literal("subtopic"), topicId: uuid, name, description, sortOrder: z.number().int().min(0).default(0), status: status.default("draft") }),
  z.object({ entity: z.literal("learningObjective"), subtopicId: uuid, statement: z.string().trim().min(2).max(1000), sortOrder: z.number().int().min(0).default(0), status: status.default("draft") }),
]);

export const curriculumUpdateSchema = z.object({
  name: name.optional(), description: description.optional(), status: status.optional(),
  startsOn: z.string().date().optional().nullable(), endsOn: z.string().date().optional().nullable(),
  version: z.string().trim().min(1).max(40).optional(), sortOrder: z.number().int().min(0).optional(),
  statement: z.string().trim().min(2).max(1000).optional(), isDemoData: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

export type CurriculumCreateInput = z.infer<typeof curriculumCreateSchema>;
export type CurriculumUpdateInput = z.infer<typeof curriculumUpdateSchema>;
