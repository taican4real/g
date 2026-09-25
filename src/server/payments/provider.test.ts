import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configuredProviderName,
  getPaymentProvider,
  signPayload,
  verifyPayload,
} from "./provider";

test("signPayload/verifyPayload round trip with HMAC-SHA512", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ event: "charge.success", data: { id: "1", reference: "PY-1", amount: 5000 } });
  const signature = signPayload(secret, body);
  assert.match(signature, /^[0-9a-f]{128}$/);
  assert.equal(verifyPayload(secret, body, signature), true);
  assert.equal(verifyPayload("wrong-secret", body, signature), false);
  assert.equal(verifyPayload(secret, `${body} `, signature), false);
  assert.equal(verifyPayload(secret, body, undefined), false);
  assert.equal(verifyPayload(secret, body, ""), false);
});

test("signatures are deterministic for the same secret and body", () => {
  const body = "raw-body";
  assert.equal(signPayload("s", body), signPayload("s", body));
});

test("provider selection honours PAYMENT_PROVIDER and expands defaults", () => {
  const previous = process.env.PAYMENT_PROVIDER;
  try {
    process.env.PAYMENT_PROVIDER = "development";
    assert.equal(configuredProviderName(), "development");
    assert.equal(getPaymentProvider(), null);
    process.env.PAYMENT_PROVIDER = "test";
    assert.equal(getPaymentProvider()?.name, "test");
    process.env.PAYMENT_PROVIDER = "paystack";
    assert.equal(getPaymentProvider()?.name, "paystack");
    process.env.PAYMENT_PROVIDER = "flutterwave";
    assert.equal(getPaymentProvider()?.name, "flutterwave");
  } finally {
    if (previous === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = previous;
  }
});

test("test adapter refuses to run under NODE_ENV=production", () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousProvider = env.PAYMENT_PROVIDER;
  try {
    env.NODE_ENV = "production";
    env.PAYMENT_PROVIDER = "test";
    assert.throws(() => getPaymentProvider(), /not allowed in production/);
  } finally {
    if (previousNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNodeEnv;
    if (previousProvider === undefined) delete env.PAYMENT_PROVIDER;
    else env.PAYMENT_PROVIDER = previousProvider;
  }
});

test("paystack webhook signature verification uses x-paystack-signature", () => {
  const previous = process.env.PAYSTACK_WEBHOOK_SECRET;
  try {
    process.env.PAYSTACK_WEBHOOK_SECRET = "paystack-secret";
    const provider = getPaymentProvider("paystack");
    assert.ok(provider);
    if (!provider) return;
    const body = JSON.stringify({ event: "charge.success", data: { id: 1, reference: "PY-1" } });
    const valid = { "x-paystack-signature": signPayload("paystack-secret", body) };
    assert.equal(provider.verifyWebhookSignature(body, valid), true);
    assert.equal(provider.verifyWebhookSignature(body, { "x-paystack-signature": "deadbeef" }), false);
    assert.equal(provider.verifyWebhookSignature(body, {}), false);
  } finally {
    if (previous === undefined) delete process.env.PAYSTACK_WEBHOOK_SECRET;
    else process.env.PAYSTACK_WEBHOOK_SECRET = previous;
  }
});

test("flutterwave webhook signature verification uses verif-hash", () => {
  const previous = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
  try {
    process.env.FLUTTERWAVE_WEBHOOK_SECRET = "flw-secret";
    const provider = getPaymentProvider("flutterwave");
    assert.ok(provider);
    if (!provider) return;
    const body = JSON.stringify({ event: "charge.success", data: { tx_ref: "EF123", id: 2 } });
    const valid = { "verif-hash": signPayload("flw-secret", body) };
    assert.equal(provider.verifyWebhookSignature(body, valid), true);
    // Header names are case-insensitive.
    assert.equal(provider.verifyWebhookSignature(body, { "VERIF-HASH": signPayload("flw-secret", body) }), true);
    assert.equal(provider.verifyWebhookSignature(body, { "verif-hash": "bad" }), false);
  } finally {
    if (previous === undefined) delete process.env.FLUTTERWAVE_WEBHOOK_SECRET;
    else process.env.FLUTTERWAVE_WEBHOOK_SECRET = previous;
  }
});

test("webhook payload parsing extracts references per provider", () => {
  const paystack = getPaymentProvider("paystack");
  const flutterwave = getPaymentProvider("flutterwave");
  const testProvider = getPaymentProvider("test");
  for (const provider of [paystack, flutterwave, testProvider]) {
    assert.ok(provider);
    if (!provider) continue;
    const parsed = provider.parseWebhook({
      event: "charge.success",
      data: { id: "api-1", reference: "PY-2026-ABC", tx_ref: "PY-2026-ABC", amount: 5000, currency: "NGN", status: "success" },
    });
    assert.ok(parsed, `${provider.name} should parse a charge.success event`);
    if (!parsed) continue;
    assert.equal(parsed.providerReference, "PY-2026-ABC");
    assert.equal(parsed.providerTransactionId, "api-1");
    assert.equal(parsed.amountMinor, 5000);
    assert.equal(parsed.currency, "NGN");
  }
  assert.equal(paystack?.parseWebhook({ event: "charge.failed", data: { id: 1, reference: "r" } }), null);
  assert.equal(paystack?.parseWebhook({ data: { reference: "r" } }), null);
  assert.equal(paystack?.parseWebhook(null), null);
});