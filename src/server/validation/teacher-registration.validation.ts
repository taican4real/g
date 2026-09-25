import { z } from "zod";
import { emailSchema, passwordSchema } from "./auth.validation";

export const teacherRegistrationSchema = z.object({
  tenantId: z.uuid(),
  fullName: z.string().trim().min(2).max(160),
  email: emailSchema,
  phone: z.string().trim().min(7).max(30),
  professionalInformation: z.string().trim().min(2).max(2000),
  qualifications: z.string().trim().min(2).max(2000),
  examTypeIds: z.array(z.uuid()).min(1).max(10),
  subjectIds: z.array(z.uuid()).min(1).max(30),
  password: passwordSchema,
}).superRefine((value, ctx) => {
  if (new Set(value.examTypeIds).size !== value.examTypeIds.length) ctx.addIssue({ code: "custom", path: ["examTypeIds"], message: "Examination types must not be duplicated" });
  if (new Set(value.subjectIds).size !== value.subjectIds.length) ctx.addIssue({ code: "custom", path: ["subjectIds"], message: "Subjects must not be duplicated" });
});

export const teacherReviewSchema = z.object({
  status: z.enum(["approved", "rejected", "suspended"]),
  reviewNote: z.string().trim().max(1000).optional().default(""),
});

export type TeacherRegistrationInput = z.infer<typeof teacherRegistrationSchema>;
export type TeacherReviewInput = z.infer<typeof teacherReviewSchema>;
