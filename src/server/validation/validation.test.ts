import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activateTenantSchema,
  createTenantSchema,
} from "./tenant.validation";
import {
  changePasswordSchema,
  loginSchema,
  passwordSchema,
  resetConfirmSchema,
} from "./auth.validation";

test("loginSchema accepts valid credentials", () => {
  const result = loginSchema.safeParse({
    identifier: " User@Example.com ",
    password: "secret",
  });
  assert.ok(result.success);
  if (result.success) {
    assert.equal(result.data.identifier, "User@Example.com".trim());
  }
});

test("loginSchema rejects invalid email and missing password", () => {
  const result = loginSchema.safeParse({
    identifier: "not-an-email",
    password: "",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((i) => i.path.join(".") === "identifier"));
    assert.ok(result.error.issues.some((i) => i.path.join(".") === "password"));
  }
});

test("password policy enforces length and character mix", () => {
  assert.ok(passwordSchema.safeParse("Password12").success);
  assert.equal(passwordSchema.safeParse("short").success, false);
  assert.equal(passwordSchema.safeParse("allletters").success, false);
  assert.equal(passwordSchema.safeParse("12345678").success, false);
  assert.equal(passwordSchema.safeParse("x".repeat(73)).success, false);
});

test("changePasswordSchema rejects equal old and new passwords", () => {
  const result = changePasswordSchema.safeParse({
    currentPassword: "SamePass123",
    newPassword: "SamePass123",
  });
  assert.equal(result.success, false);
});

test("activateTenantSchema requires a UUID", () => {
  assert.ok(
    activateTenantSchema.safeParse({
      tenantId: "3f3b0f1a-4a6b-4b1e-9a9a-123456789abc",
    }).success,
  );
  assert.equal(
    activateTenantSchema.safeParse({ tenantId: "not-a-uuid" }).success,
    false,
  );
});

test("createTenantSchema validates slug format", () => {
  assert.ok(
    createTenantSchema.safeParse({
      name: "My Centre",
      slug: "my-centre",
      adminEmail: "admin@example.com",
      adminDisplayName: "Admin",
    }).success,
  );
  assert.equal(
    createTenantSchema.safeParse({
      name: "My Centre",
      slug: "Not Valid",
      adminEmail: "admin@example.com",
      adminDisplayName: "Admin",
    }).success,
    false,
  );
});

test("resetConfirmSchema requires a token and policy-compliant password", () => {
  assert.equal(
    resetConfirmSchema.safeParse({
      token: "abc",
      newPassword: "Weak1",
    }).success,
    false,
  );
  assert.ok(
    resetConfirmSchema.safeParse({
      token: "abc".repeat(8),
      newPassword: "StrongPass1",
    }).success,
  );
});