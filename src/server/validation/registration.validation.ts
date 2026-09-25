import { z } from "zod";
import { emailSchema, passwordSchema } from "./auth.validation";

export const registrationSchema = z.object({
  tenantId: z.uuid(),
  firstName: z.string().trim().min(2).max(80),
  middleName: z.string().trim().max(80).optional().default(""),
  lastName: z.string().trim().min(2).max(80),
  email: emailSchema,
  phone: z.string().trim().min(7).max(30),
  dateOfBirth: z.string().date(),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"]),
  address: z.string().trim().min(5).max(300),
  state: z.string().trim().min(2).max(80),
  lga: z.string().trim().min(2).max(100),
  school: z.string().trim().min(2).max(180),
  classLevel: z.string().trim().min(1).max(80),
  academicInformation: z.string().trim().max(1000).optional().default(""),
  examTypeId: z.uuid(),
  examSessionId: z.uuid(),
  subjectIds: z.array(z.uuid()).min(1).max(20),
  password: passwordSchema,
}).superRefine((value, ctx) => {
  if (new Date(value.dateOfBirth) > new Date()) {
    ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "Date of birth cannot be in the future" });
  }
  if (new Set(value.subjectIds).size !== value.subjectIds.length) {
    ctx.addIssue({ code: "custom", path: ["subjectIds"], message: "Subjects must not be duplicated" });
  }
});

export type RegistrationInput = z.infer<typeof registrationSchema>;
