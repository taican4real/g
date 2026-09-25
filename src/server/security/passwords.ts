import * as bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

/**
 * Password hashing using bcrypt (cost 12). Hashes are salted, so identical
 * passwords never produce identical hashes. Plaintext passwords are never
 * stored or logged anywhere.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Constant-time verification of a plaintext password against a stored hash.
 * Any error (malformed hash, unexpected input) is treated as a failed match
 * rather than being surfaced to callers.
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}