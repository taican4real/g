import { getDb } from "../db/client";
import { revokeAllSessions } from "./sessions";
import { recordAudit } from "../audit/audit";
import { hashPassword } from "../security/passwords";
import { hashToken, randomToken } from "../security/tokens";
import { err, ok, type Result } from "../shared/result";

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***@***";
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

/**
 * Creates a one-time password-reset token (60 minute validity). Responses are
 * identical whether or not the email exists, preventing account enumeration.
 * In non-production environments the reset link is returned so the flow can be
 * exercised; in production an email provider must deliver it.
 */
export async function requestPasswordReset(
  email: string,
): Promise<Result<{ resetUrl?: string }>> {
  const sql = getDb();
  const normalized = email.trim().toLowerCase();
  const [user] = await sql`
    select id from users where lower(email) = ${normalized} limit 1
  `;

  if (!user) {
    await recordAudit({
      action: "auth.password_reset_requested",
      details: { email: maskEmail(normalized), known: false },
    });
    return ok({});
  }

  const token = randomToken();
  await sql`
    insert into password_reset_tokens (user_id, token_hash, expires_at)
    values (${user.id}, ${hashToken(token)}, now() + interval '60 minutes')
  `;

  await recordAudit({
    action: "auth.password_reset_requested",
    actorUserId: user.id,
    details: { email: maskEmail(normalized), known: true },
  });

  const resetUrl =
    process.env.NODE_ENV === "production"
      ? undefined
      : `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;

  return ok({ resetUrl });
}

export async function confirmPasswordReset(input: {
  token: string;
  newPassword: string;
}): Promise<Result<void>> {
  const sql = getDb();
  const [tokenRow] = await sql`
    select id, user_id from password_reset_tokens
    where token_hash = ${hashToken(input.token)}
      and used_at is null
      and expires_at > now()
    limit 1
  `;
  if (!tokenRow) {
    return err("TOKEN_INVALID", "This reset link is invalid or has expired");
  }

  const nextHash = await hashPassword(input.newPassword);
  await sql.begin(async (tx) => {
    await tx`
      update users set password_hash = ${nextHash}, updated_by = ${tokenRow.user_id}
      where id = ${tokenRow.user_id}
    `;
    await tx`
      update password_reset_tokens set used_at = now()
      where id = ${tokenRow.id}
    `;
  });
  await revokeAllSessions(tokenRow.user_id);

  await recordAudit({
    action: "auth.password_reset_completed",
    actorUserId: tokenRow.user_id,
  });
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

/**
 * Creates a one-time email-verification token (24 hour validity). The response
 * is identical whether or not the address exists.
 */
export async function requestEmailVerification(
  email: string,
): Promise<Result<{ verificationUrl?: string }>> {
  const sql = getDb();
  const normalized = email.trim().toLowerCase();
  const [user] = await sql`
    select id, email_verified_at from users where lower(email) = ${normalized} limit 1
  `;
  if (!user) {
    await recordAudit({
      action: "auth.email_verification_requested",
      details: { email: maskEmail(normalized), known: false },
    });
    return ok({});
  }
  if (user.email_verified_at) {
    return err("CONFLICT", "This email is already verified");
  }

  const token = randomToken();
  await sql`
    insert into email_verification_tokens (user_id, token_hash, expires_at)
    values (${user.id}, ${hashToken(token)}, now() + interval '24 hours')
  `;

  await recordAudit({
    action: "auth.email_verification_requested",
    actorUserId: user.id,
    details: { email: maskEmail(normalized) },
  });

  const verificationUrl =
    process.env.NODE_ENV === "production"
      ? undefined
      : `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;

  return ok({ verificationUrl });
}

export async function confirmEmailVerification(
  token: string,
): Promise<Result<void>> {
  const sql = getDb();
  const [tokenRow] = await sql`
    select t.id, t.user_id, u.email_verified_at
    from email_verification_tokens t
    join users u on u.id = t.user_id
    where t.token_hash = ${hashToken(token)}
      and t.used_at is null
      and t.expires_at > now()
    limit 1
  `;
  if (!tokenRow) {
    return err("TOKEN_INVALID", "This verification link is invalid or has expired");
  }
  if (tokenRow.email_verified_at) {
    return err("CONFLICT", "This email is already verified");
  }

  await sql.begin(async (tx) => {
    await tx`
      update users set email_verified_at = now()
      where id = ${tokenRow.user_id}
    `;
    await tx`
      update email_verification_tokens set used_at = now()
      where id = ${tokenRow.id}
    `;
  });

  await recordAudit({
    action: "auth.email_verified",
    actorUserId: tokenRow.user_id,
  });
  return ok(undefined);
}