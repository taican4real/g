import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./passwords";
import { generatePassword } from "./tokens";

test("hashPassword produces a bcrypt hash that verifies", async () => {
  const hash = await hashPassword("StrongPass123");
  assert.match(hash, /^\$2[aby]\$\d{2}\$/);
  assert.equal(await verifyPassword("StrongPass123", hash), true);
});

test("verifyPassword rejects wrong passwords", async () => {
  const hash = await hashPassword("StrongPass123");
  assert.equal(await verifyPassword("WrongPass123", hash), false);
});

test("identical passwords produce different hashes (salted)", async () => {
  const first = await hashPassword("SamePass456");
  const second = await hashPassword("SamePass456");
  assert.notEqual(first, second);
});

test("verifyPassword tolerates malformed hashes without throwing", async () => {
  assert.equal(await verifyPassword("whatever", "not-a-hash"), false);
  assert.equal(await verifyPassword("whatever", ""), false);
});

test("generatePassword satisfies the password policy", () => {
  for (let i = 0; i < 20; i++) {
    const password = generatePassword();
    assert.ok(password.length >= 8 && password.length <= 72);
    assert.match(password, /[a-zA-Z]/);
    assert.match(password, /\d/);
  }
});