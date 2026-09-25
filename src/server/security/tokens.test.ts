import { test } from "node:test";
import assert from "node:assert/strict";
import { hashToken, randomToken } from "./tokens";

test("randomToken is url-safe base64 of the requested size", () => {
  const token = randomToken();
  assert.ok(token.length >= 40);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(randomToken(), randomToken());
});

test("hashToken is a deterministic sha256 hex digest", () => {
  const token = randomToken();
  const hash = hashToken(token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashToken(token), hash);
  assert.notEqual(hashToken(token), hashToken(randomToken()));
});

test("tokens are never equal to their hash", () => {
  const token = randomToken();
  assert.notEqual(token, hashToken(token));
});