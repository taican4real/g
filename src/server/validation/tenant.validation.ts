import { z } from "zod";
import { emailSchema, passwordSchema } from "./auth.validation";

export const activateTenantSchema = z.object({
  tenantId: z.uuid("tenantId must be a valid UUID"),
});

export const createTenantSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(63)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug must use lowercase letters, numbers, and hyphens",
    ),
  adminEmail: emailSchema,
  adminDisplayName: z.string().trim().min(1).max(120),
  adminPassword: passwordSchema.optional(),
});

export type ActivateTenantInput = z.infer<typeof activateTenantSchema>;
export type CreateTenantInput = z.infer<typeof createTenantSchema>;