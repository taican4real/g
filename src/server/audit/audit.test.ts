import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAuditDetailsSafe } from "./audit";

test("assertAuditDetailsSafe passes for benign details", () => {
  assert.doesNotThrow(() =>
    assertAuditDetailsSafe({ reason: "bad_password", role: "student" }),
  );
});

test("assertAuditDetailsSafe refuses secrets", () => {
  for (const key of [
    "password",
    "passwordHash",
    "token",
    "resetToken",
    "secret",
    "apiKey",
    "api_key",
    "authorization",
    "cookie",
    "passwd",
  ]) {
    assert.throws(
      () => assertAuditDetailsSafe({ [key]: "super-secret-value" }),
      new RegExp(key),
      `expected rejection for key '${key}'`,
    );
  }
});

test("assertAuditDetailsSafe ignores undefined details", () => {
  assert.doesNotThrow(() => assertAuditDetailsSafe(undefined));
});