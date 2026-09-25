import { getDb } from "../db/client";
import { hashToken, randomToken } from "../security/tokens";

export const DEFAULT_SESSION_COOKIE_NAME = "examforge_session";

export function sessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME ?? DEFAULT_SESSION_COOKIE_NAME;
}

export function sessionTtlSeconds(): number {
  const raw = Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 60 * 60 * 24 * 7;
}

/**
 * Cookie attributes for the session bearer token: httpOnly (JavaScript never
 * reads it), sameSite=lax (CSRF-resistant for top-level navigations), secure
 * in production, path-scoped to the whole app.
 */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export type SessionRecord = {
  sessionId: string;
  userId: string;
  activeTenantId: string | null;
  authMethod: string;
  expiresAt: Date;
};

export type ActiveSession = Omit<SessionRecord, "expiresAt">;

type SessionInsertOptions = {
  userId: string;
  activeTenantId?: string | null;
  authMethod?: string;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * Creates a DB-backed session and returns the opaque bearer token. Only the
 * token hash is persisted; the raw token leaves the server exactly once via
 * the response cookie.
 */
export async function createSession(
  options: SessionInsertOptions,
): Promise<{ token: string; record: SessionRecord }> {
  const token = randomToken();
  const sql = getDb();
  const [row] = await sql`
    insert into sessions (
      user_id, token_hash, active_tenant_id, auth_method,
      expires_at, ip_address, user_agent
    ) values (
      ${options.userId}, ${hashToken(token)}, ${options.activeTenantId ?? null},
      ${options.authMethod ?? "password"},
      now() + make_interval(secs => ${sessionTtlSeconds()}),
      ${options.ipAddress ?? null}, ${options.userAgent ?? null}
    )
    returning id, user_id, active_tenant_id, auth_method, expires_at
  `;
  return { token, record: toSessionRecord(row) };
}

export async function findSessionRecord(
  token: string,
): Promise<SessionRecord | null> {
  const sql = getDb();
  const rows = await sql`
    select id, user_id, active_tenant_id, auth_method, expires_at
    from sessions
    where token_hash = ${hashToken(token)}
      and revoked_at is null
      and expires_at > now()
    limit 1
  `;
  if (rows.length === 0) return null;
  // Opportunistic last-seen update; never fails a request.
  await sql`update sessions set last_seen_at = now() where id = ${rows[0].id}`.catch(
    () => undefined,
  );
  return toSessionRecord(rows[0]);
}

export async function revokeSession(token: string): Promise<void> {
  const sql = getDb();
  await sql`
    update sessions set revoked_at = now()
    where token_hash = ${hashToken(token)} and revoked_at is null
  `;
}

/** Revokes every session for a user except the given one. */
export async function revokeOtherSessions(
  userId: string,
  keepSessionId: string,
): Promise<void> {
  const sql = getDb();
  await sql`
    update sessions set revoked_at = now()
    where user_id = ${userId} and id <> ${keepSessionId} and revoked_at is null
  `;
}

/** Revokes every session for a user. */
export async function revokeAllSessions(userId: string): Promise<void> {
  const sql = getDb();
  await sql`
    update sessions set revoked_at = now()
    where user_id = ${userId} and revoked_at is null
  `;
}

export async function updateSessionActiveTenant(
  sessionId: string,
  tenantId: string | null,
): Promise<void> {
  const sql = getDb();
  await sql`
    update sessions set active_tenant_id = ${tenantId}
    where id = ${sessionId}
  `;
}

function toSessionRecord(row: Record<string, unknown>): SessionRecord {
  return {
    sessionId: String(row.id),
    userId: String(row.user_id),
    activeTenantId: (row.active_tenant_id as string | null) ?? null,
    authMethod: String(row.auth_method),
    expiresAt: row.expires_at as Date,
  };
}