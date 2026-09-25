import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { loadEnv } from "./env";

loadEnv();

const APP_ROLE = process.env.APP_DB_ROLE?.trim();
const APP_ROLE_PASSWORD = process.env.APP_DB_PASSWORD ?? "examforge_app";

// Migrations must run as a role that can create tables and roles (in managed
// PostgreSQL this is normally the database owner). The application itself
// connects with the least-privilege role (APP_DB_ROLE) so that RLS policies
// actually apply — a superuser or table owner would silently bypass them.
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is required. Copy .env.example to .env.local and set it.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

async function main(): Promise<void> {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const dir = join(process.cwd(), "database", "migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const applied = await sql<{ name: string }[]>`select name from schema_migrations`;
  const appliedSet = new Set(applied.map((row) => row.name));

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`skip ${file} (already applied)`);
      continue;
    }
    console.log(`apply ${file}`);
    const content = readFileSync(join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
  }

  console.log("Migrations complete.");

  if (APP_ROLE) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(APP_ROLE)) {
      throw new Error(`Invalid APP_DB_ROLE identifier: ${APP_ROLE}`);
    }
    const passwordLiteral = `'${APP_ROLE_PASSWORD.replace(/'/g, "''")}'`;
    try {
      await sql.unsafe(`create role "${APP_ROLE}" login password ${passwordLiteral}`);
      console.log(`Provisioned application role: ${APP_ROLE}`);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.toLowerCase().includes("already exists")
      ) {
        throw error;
      }
      console.log(`Application role already exists: ${APP_ROLE}`);
    }
    await sql.unsafe(`
      grant usage on schema public to "${APP_ROLE}";
      grant select, insert, update, delete on all tables in schema public to "${APP_ROLE}";
      alter default privileges in schema public
        grant select, insert, update, delete on tables to "${APP_ROLE}";
    `);
    console.log(`Granted schema privileges to: ${APP_ROLE}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());