import { z } from "zod";

export const uuidSchema = z.uuid("Must be a valid UUID");

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .max(254, "Email is too long")
  .email("Enter a valid email address")
  .transform((value) => value.toLowerCase());

/**
 * Password policy. The 72-byte limit is a bcrypt constraint; the rest is a
 * reasonable minimum for a foundation that will be extended with a password
 * strength policy later.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .refine(
    (value) => /[a-zA-Z]/.test(value) && /\d/.test(value),
    "Password must contain at least one letter and one number",
  );

export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Email is required")
    .email("Enter a valid email address")
    .max(254),
  password: z.string().min(1, "Password is required"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "New password must differ from the current password",
    path: ["newPassword"],
  });

export const resetRequestSchema = z.object({ email: emailSchema });

export const resetConfirmSchema = z.object({
  token: z.string().min(16, "Token is invalid"),
  newPassword: passwordSchema,
});

export const verifyEmailRequestSchema = z.object({ email: emailSchema });

export const verifyEmailConfirmSchema = z.object({
  token: z.string().min(16, "Token is invalid"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;
export type ResetConfirmInput = z.infer<typeof resetConfirmSchema>;
export type VerifyEmailRequestInput = z.infer<typeof verifyEmailRequestSchema>;
export type VerifyEmailConfirmInput = z.infer<typeof verifyEmailConfirmSchema>;