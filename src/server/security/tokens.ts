import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque random bearer token. Never persisted in plaintext: only the sha256
 * hash is stored (see {@link hashToken}), so a database leak does not expose
 * live session, reset, or verification tokens.
 */
export function randomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Development-only human-readable password generator. Produces a password
 * that satisfies the registered policy (min 8, letters and digits).
 */
export function generatePassword(length = 16): string {
  const alphabet =
    "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let password = "";
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += alphabet[bytes[i] % alphabet.length];
  }
  // Guarantee at least one letter and one digit regardless of sampling.
  if (!/[a-zA-Z]/.test(password)) {
    password = password.slice(0, -1) + "a";
  }
  if (!/\d/.test(password)) {
    password = password.slice(0, -1) + "7";
  }
  return password;
}