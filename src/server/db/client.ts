import postgres, { type Sql } from "postgres";

export type { Sql } from "postgres";

let singleton: Sql | null = null;

/**
 * Application database client. Exists only inside the Node.js server process;
 * browser code can never import it (server-side imports only).
 */
export function getDb(): Sql {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not configured");
  }
  singleton = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // ssl defaults to disabled for local; managed providers should pass ssl.
  });
  return singleton;
}

export function createDb(url: string): Sql {
  return postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

export async function closeDb(): Promise<void> {
  if (singleton) {
    await singleton.end();
    singleton = null;
  }
}

/**
 * Runs `fn` inside a transaction with the given transaction-local application
 * settings, then commits. Row-level-security policies read these settings, so
 * every tenant-scoped database access must go through one of the scoped
 * helpers below — never through raw `getDb()`.
 */
export async function sqlContext<T>(
  settings: Record<string, string>,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  const sql = getDb();
  return sql.begin(async (tx) => {
    for (const [name, value] of Object.entries(settings)) {
      await tx`select set_config(${name}, ${value}, true)`;
    }
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}

/** Operations acting as a specific user (their own data across tenants). */
export function withUser<T>(
  userId: string,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  return sqlContext({ "app.user_id": userId }, fn);
}

/** Operations scoped to one tenant as a specific user. */
export function withTenant<T>(
  tenantId: string,
  userId: string,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  return sqlContext(
    { "app.tenant_id": tenantId, "app.user_id": userId },
    fn,
  );
}

/** Platform-level operations (platform super admin). */
export function withPlatform<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sqlContext({ "app.is_platform_admin": "true" }, fn);
}

/** Bootstrapping operations (migrations/seed tooling only). */
export function withBootstrap<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sqlContext(
    {
      "app.is_bootstrapping": "true",
      "app.is_platform_admin": "true",
    },
    fn,
  );
}

/** Public system workflows that create records after their own validation. */
export function withSystem<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sqlContext({ "app.is_system": "true" }, fn);
}