import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Payment provider abstraction.
//
// Business workflows depend only on this interface. Paystack and Flutterwave
// are concrete adapters behind it; a "test" adapter exists so the full
// webhook -> verification -> entitlement pipeline can be exercised without a
// live vendor or real money. Production success is never faked: the test
// adapter refuses to run when NODE_ENV is production, and a provider that is
// not explicitly configured is reported as unavailable rather than success.
// ---------------------------------------------------------------------------

export type PaymentProviderName = "paystack" | "flutterwave" | "test" | "development";

export type CreateCheckoutInput = {
  siteName: string;
  tenantName: string;
  email: string;
  description: string;
  amountMinor: number;
  currency: string;
  providerReference: string;
  callbackUrl: string;
  webhookUrl: string;
  metadata: Record<string, string>;
};

export type CreateCheckoutResult = {
  provider: string;
  providerReference: string;
  checkoutUrl: string;
};

export type VerifiedTransaction = {
  status: "success" | "failed" | "pending";
  providerTransactionId: string;
  amountMinor: number;
  currency: string;
  paidAt: Date | null;
};

export type ParsedWebhook = {
  providerTransactionId: string;
  providerReference: string;
  status: string;
  amountMinor?: number;
  currency?: string;
};

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
  verifyTransaction(reference: string, expectedAmountMinor: number, expectedCurrency: string): Promise<VerifiedTransaction>;
  verifyWebhookSignature(rawBody: string, headers: Readonly<Record<string, string | undefined>>): boolean;
  parseWebhook(payload: unknown): ParsedWebhook | null;
}

// ---------------------------------------------------------------------------
// Signature primitives. Both supported vendors sign the raw request body with
// an HMAC-SHA512 using the webhook secret. Exported for unit tests.
// ---------------------------------------------------------------------------

export function signPayload(secret: string | undefined, rawBody: string): string {
  return createHmac("sha512", secret ?? "").update(rawBody, "utf8").digest("hex");
}

export function verifyPayload(
  secret: string | undefined,
  rawBody: string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = signPayload(secret, rawBody);
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function webhookHeader(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

export function headerSecret(names: string[]): string | undefined {
  const resolved: string[] = [];
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) resolved.push(value);
  }
  return resolved.length ? resolved.join(";") : undefined;
}
// ---------------------------------------------------------------------------
// Paystack
// ---------------------------------------------------------------------------

export const PAYSTACK_API = "https://api.paystack.co";

class PaystackProvider implements PaymentProvider {
  readonly name = "paystack";

  private secretKey(): string {
    const key = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured");
    return key;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    const response = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.secretKey()}`,
      },
      body: JSON.stringify({
        email: input.email,
        amount: input.amountMinor,
        currency: input.currency,
        reference: input.providerReference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== true || !payload.data?.reference) {
      throw new Error(payload.message ?? "Paystack checkout initialization failed");
    }
    return {
      provider: this.name,
      providerReference: String(payload.data.reference),
      checkoutUrl: String(payload.data.authorization_url),
    };
  }

  async verifyTransaction(
    reference: string,
    expectedAmountMinor: number,
    expectedCurrency: string,
  ): Promise<VerifiedTransaction> {
    const response = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { authorization: `Bearer ${this.secretKey()}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== true) {
      throw new Error("Paystack transaction verification failed");
    }
    const data = payload.data ?? {};
    return {
      status: normaliseStatus(String(data.status ?? "pending")),
      providerTransactionId: String(data.id),
      amountMinor: Number(data.amount ?? -1),
      currency: String(data.currency ?? ""),
      paidAt: data.paid_at ? new Date(String(data.paid_at)) : null,
    };
  }

  verifyWebhookSignature(rawBody: string, headers: Readonly<Record<string, string | undefined>>): boolean {
    return verifyPayload(process.env.PAYSTACK_WEBHOOK_SECRET, rawBody, webhookHeader(headers, "x-paystack-signature"));
  }

  parseWebhook(payload: unknown): ParsedWebhook | null {
    const data = eventData(payload, "charge.success");
    if (!data) return null;
    const reference = valueOf(data.reference);
    if (!reference) return null;
    return {
      providerTransactionId: valueOf(data.id) ?? reference,
      providerReference: reference,
      status: String(data.status ?? "pending"),
      amountMinor: toMinor(data.amount),
      currency: valueOf(data.currency),
    };
  }
}
// ---------------------------------------------------------------------------
// Flutterwave
// ---------------------------------------------------------------------------

export const FLUTTERWAVE_API = "https://api.flutterwave.com/v3";

class FlutterwaveProvider implements PaymentProvider {
  readonly name = "flutterwave";

  private secretKey(): string {
    const key = process.env.FLUTTERWAVE_SECRET_KEY?.trim();
    if (!key) throw new Error("FLUTTERWAVE_SECRET_KEY is not configured");
    return key;
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    // tx_ref is visible to the customer and limited to 12 characters.
    const txRef = `EF${randomBytes(5).toString("hex").toUpperCase()}`;
    const response = await fetch(`${FLUTTERWAVE_API}/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.secretKey()}`,
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: input.amountMinor / 100,
        currency: input.currency,
        redirect_url: input.callbackUrl,
        customer: { email: input.email },
        customizations: {
          title: input.siteName,
          description: input.description,
        },
        meta: input.metadata,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== "success" || !payload.data?.link) {
      throw new Error(payload.message ?? "Flutterwave checkout initialization failed");
    }
    return {
      provider: this.name,
      providerReference: txRef,
      checkoutUrl: String(payload.data.link),
    };
  }

  async verifyTransaction(
    reference: string,
    expectedAmountMinor: number,
    expectedCurrency: string,
  ): Promise<VerifiedTransaction> {
    const quoted = encodeURIComponent(reference);
    const response = await fetch(`${FLUTTERWAVE_API}/transactions/verify_by_reference?txref=${quoted}`, {
      headers: { authorization: `Bearer ${this.secretKey()}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status !== "success") {
      throw new Error("Flutterwave transaction verification failed");
    }
    const data = payload.data ?? {};
    return {
      status: normaliseStatus(String(data.status ?? "pending")),
      providerTransactionId: valueOf(data.id) ?? reference,
      // Flutterwave reports amounts in major units; normalise to minor.
      amountMinor: Math.round(Number(data.amount ?? -1) * 100),
      currency: String(data.currency ?? ""),
      paidAt: data.created_at ? new Date(String(data.created_at)) : null,
    };
  }

  verifyWebhookSignature(rawBody: string, headers: Readonly<Record<string, string | undefined>>): boolean {
    const secret = headerSecret(["FLUTTERWAVE_WEBHOOK_SECRET"]);
    if (!secret) return false;
    const signature = webhookHeader(headers, "verif-hash") ?? webhookHeader(headers, "verify-hash");
    return verifyPayload(secret, rawBody, signature);
  }

  parseWebhook(payload: unknown): ParsedWebhook | null {
    const data = eventData(payload, "charge.success");
    if (!data) return null;
    const reference = valueOf(data.tx_ref);
    if (!reference) return null;
    return {
      providerTransactionId: valueOf(data.id) ?? reference,
      providerReference: reference,
      status: String(data.status ?? "pending"),
      amountMinor: toMinor(data.amount),
      currency: valueOf(data.currency),
    };
  }
}
// ---------------------------------------------------------------------------
// Test adapter — the safe development/suite path. NEVER active in production.
// ---------------------------------------------------------------------------

export type TestAcceptance = "accept" | "decline" | "pending";

export function testAcceptance(): TestAcceptance {
  switch (process.env.TEST_PAYMENT_ACCEPTANCE?.trim().toLowerCase()) {
    case "accept":
      return "accept";
    case "decline":
      return "decline";
    default:
      return "pending";
  }
}

class TestProvider implements PaymentProvider {
  readonly name = "test";

  async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
    return {
      provider: this.name,
      providerReference: input.providerReference,
      // A plain, unauthenticated URL. Visiting it never changes payment state;
      // only a signature-verified webhook does.
      checkoutUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/payments/test-checkout?reference=${encodeURIComponent(input.providerReference)}`,
    };
  }

  async verifyTransaction(
    reference: string,
    expectedAmountMinor: number,
    expectedCurrency: string,
  ): Promise<VerifiedTransaction> {
    const overrideRaw = process.env.TEST_PAYMENT_MISMATCH_AMOUNT_MINOR?.trim();
    const amountMinor = overrideRaw && Number.isFinite(Number(overrideRaw)) ? Number(overrideRaw) : expectedAmountMinor;
    switch (testAcceptance()) {
      case "accept":
        return {
          status: "success",
          providerTransactionId: `API-${reference}`,
          amountMinor: Math.round(amountMinor),
          currency: expectedCurrency,
          paidAt: new Date(),
        };
      case "decline":
        return {
          status: "failed",
          providerTransactionId: `API-${reference}`,
          amountMinor: Math.round(amountMinor),
          currency: expectedCurrency,
          paidAt: null,
        };
      default:
        return {
          status: "pending",
          providerTransactionId: `API-${reference}`,
          amountMinor: Math.round(amountMinor),
          currency: expectedCurrency,
          paidAt: null,
        };
    }
  }

  verifyWebhookSignature(rawBody: string, headers: Readonly<Record<string, string | undefined>>): boolean {
    const secret = headerSecret(["TEST_PAYMENT_WEBHOOK_SECRET"]);
    if (!secret) return false;
    return verifyPayload(secret, rawBody, webhookHeader(headers, "x-test-signature"));
  }

  parseWebhook(payload: unknown): ParsedWebhook | null {
    const data = eventData(payload, "charge.success");
    if (!data) return null;
    const reference = valueOf(data.reference);
    if (!reference) return null;
    return {
      providerTransactionId: valueOf(data.id) ?? reference,
      providerReference: reference,
      status: String(data.status ?? "pending"),
      amountMinor: toMinor(data.amount),
      currency: valueOf(data.currency),
    };
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function configuredProviderName(): string {
  return (process.env.PAYMENT_PROVIDER ?? "development").trim().toLowerCase();
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function assertNotFake(provider: string): void {
  if (isProduction() && provider !== "production") {
    throw new Error("A payment provider that can fake success is not allowed in production");
  }
}

/** Returns the active provider, or null so callers can report "unavailable". */
export function getPaymentProvider(name?: string): PaymentProvider | null {
  const provider = (name ?? configuredProviderName()).toLowerCase();
  assertNotFake(provider);
  switch (provider) {
    case "paystack":
      return new PaystackProvider();
    case "flutterwave":
      return new FlutterwaveProvider();
    case "test":
      return new TestProvider();
    case "development":
    case "none":
    case "":
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers shared by adapters.
// ---------------------------------------------------------------------------

function eventData(payload: unknown, expectedEvent: string): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const event = String(record.event ?? "");
  if (event !== expectedEvent) return null;
  const data = record.data;
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

function normaliseStatus(status: string): "success" | "failed" | "pending" {
  switch (status.toLowerCase()) {
    case "success":
    case "successful":
    case "completed":
      return "success";
    case "failed":
    case "cancelled":
    case "abandoned":
    case "declined":
    case "error":
      return "failed";
    default:
      return "pending";
  }
}

function valueOf(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function toMinor(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}