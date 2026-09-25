import { z } from "zod";

/** Starting a payment session for a registration (optional — defaults to the latest pending one). */
export const createPaymentSessionSchema = z.object({
  registrationId: z.uuid().optional(),
});

export type CreatePaymentSessionInput = z.infer<typeof createPaymentSessionSchema>;

/** Provider path segment for webhook routes. */
export const webhookProviderSchema = z.enum(["paystack", "flutterwave", "test"]);