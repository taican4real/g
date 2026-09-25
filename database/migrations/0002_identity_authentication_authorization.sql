-- Phase 1: Identity, authentication, authorization, and audit foundation.
-- Builds on 0001_initial_tenant_boundary.sql.

-- 1. Evolve the Phase 0 boundary -------------------------------

-- RBAC moves to user_roles; memberships keep tenure/status only.
alter table tenant_memberships drop column role;

alter table users
  add column password_hash text,
  add column email_verified_at timestamptz,
  add column status text not null default 'active'
    check (status in ('pending', 'active', 'suspended', 'deactivated')),
  add column created_by uuid references users(id) on delete set null,
  add column updated_by uuid references users(id) on delete set null;

create unique index users_email_unique on users (lower(email)) where email is not null;
create unique index users_phone_unique on users (phone) where phone is not null;

alter table tenants
  add column slug text,
  add column settings jsonb not null default '{}'::jsonb,
  add column created_by uuid references users(id) on delete set null,
  add column updated_by uuid references users(id) on delete set null;

create unique index tenants_slug_unique on tenants (slug) where slug is not null;

-- 2. RBAC core --------------------------------------------------

create table roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  scope text not null check (scope in ('platform', 'tenant')),
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  scope text not null check (scope in ('platform', 'tenant')),
  created_at timestamptz not null default now()
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

-- A user_roles row is the assignment of one role to one user.
-- tenant_id is null for platform-scope roles and set for tenant-scope roles.
-- UNIQUE NULLS NOT DISTINCT (PG15+) enforces one assignment per scope while
-- allowing many platform-scope (null tenant) rows with different roles.
create table user_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  granted_by uuid references users(id) on delete set null,
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, user_id, role_id)
);

create index user_roles_user_idx on user_roles (user_id);
create index user_roles_tenant_idx on user_roles (tenant_id);

-- 3. Sessions ----------------------------------------------------

-- DB-backed sessions with opaque bearer tokens. Only the sha256 hash of
-- the token is stored; the token itself is delivered to the browser in an
-- httpOnly, same-site cookie and never persisted on the server.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  active_tenant_id uuid references tenants(id) on delete set null,
  auth_method text not null default 'password',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint sessions_expiry_check check (expires_at > created_at)
);

create index sessions_user_idx on sessions (user_id);
create index sessions_active_tenant_idx on sessions (active_tenant_id);

-- 4. Profiles -----------------------------------------------------

create table student_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  admission_no text,
  date_of_birth date,
  guardian_name text,
  guardian_phone text,
  address text,
  status text not null default 'provisional'
    check (status in ('provisional', 'active', 'graduated', 'suspended')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (tenant_id, admission_no)
);

create table teacher_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  staff_no text,
  specialization text,
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended', 'removed')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (tenant_id, staff_no)
);

create index student_profiles_tenant_idx on student_profiles (tenant_id);
create index teacher_profiles_tenant_idx on teacher_profiles (tenant_id);

-- 5. Authentication recovery and verification tokens --------------

create table password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index password_reset_tokens_user_idx on password_reset_tokens (user_id);

create table email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index email_verification_tokens_user_idx on email_verification_tokens (user_id);

-- 6. Audit log ----------------------------------------------------

-- Append-only by convention: application code never updates or deletes audit
-- rows. Passwords, tokens, and secrets must never be written to `details`.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete set null,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id uuid,
  ip_address text,
  user_agent text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_tenant_created_idx on audit_logs (tenant_id, created_at desc);
create index audit_logs_actor_idx on audit_logs (actor_user_id);
create index audit_logs_action_idx on audit_logs (action);

-- 7. Timestamp maintenance ---------------------------------------

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tenants_updated_at before update on tenants
  for each row execute function set_updated_at();
create trigger users_updated_at before update on users
  for each row execute function set_updated_at();
create trigger student_profiles_updated_at before update on student_profiles
  for each row execute function set_updated_at();
create trigger teacher_profiles_updated_at before update on teacher_profiles
  for each row execute function set_updated_at();

-- 8. RBAC invariants ----------------------------------------------

-- Enforces role scope and membership invariants at the database boundary:
-- platform roles are never tenant-scoped, tenant roles always are, and a
-- user must be a tenant member before receiving a tenant-scope role.
create or replace function enforce_user_roles_invariants() returns trigger as $$
declare
  r_scope text;
begin
  select scope into r_scope from roles where id = new.role_id;
  if r_scope is null then
    raise exception 'role % does not exist', new.role_id;
  end if;

  if r_scope = 'platform' and new.tenant_id is not null then
    raise exception 'platform-scope role cannot be scoped to a tenant';
  end if;

  if r_scope = 'tenant' and new.tenant_id is null then
    raise exception 'tenant-scope role requires a tenant';
  end if;

  if r_scope = 'tenant' and not exists (
    select 1 from tenant_memberships tm
    where tm.tenant_id = new.tenant_id and tm.user_id = new.user_id
  ) then
    raise exception 'user must be a tenant member before receiving a tenant-scope role';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger user_roles_invariants before insert or update on user_roles
  for each row execute function enforce_user_roles_invariants();

-- 9. Seed roles and permissions -----------------------------------

insert into roles (code, name, description, scope, is_system) values
  ('platform_super_admin', 'Platform Super Admin', 'Unrestricted platform administrator', 'platform', true),
  ('centre_admin', 'Centre Admin', 'Administers one tutorial centre', 'tenant', true),
  ('teacher', 'Teacher', 'Creates and manages content and assessments for a centre', 'tenant', true),
  ('student', 'Student', 'Takes examinations and accesses own learner data', 'tenant', true),
  ('support', 'Support', 'Centre support with read and member administration access', 'tenant', true)
on conflict (code) do nothing;

insert into permissions (code, name, description, scope) values
  ('platform.tenants.manage', 'Manage Tenants', 'Create and manage all tenants', 'platform'),
  ('platform.users.manage', 'Manage Users', 'Manage platform users', 'platform'),
  ('platform.roles.manage', 'Manage Roles', 'Manage roles and permissions', 'platform'),
  ('platform.audit.view', 'View Platform Audit', 'Read the audit log across all tenants', 'platform'),
  ('tenant.settings.manage', 'Manage Centre Settings', 'Manage centre settings', 'tenant'),
  ('tenant.members.manage', 'Manage Members', 'Manage centre members and profiles', 'tenant'),
  ('tenant.roles.grant', 'Grant Roles', 'Assign tenant-scope roles to members', 'tenant'),
  ('tenant.content.manage', 'Manage Content', 'Manage centre learning content', 'tenant'),
  ('tenant.cbt.manage', 'Manage CBT', 'Manage question banks and CBT sessions', 'tenant'),
  ('tenant.reports.view', 'View Reports', 'View centre reports', 'tenant'),
  ('tenant.billing.manage', 'Manage Billing', 'Manage centre billing and entitlements', 'tenant'),
  ('tenant.audit.view', 'View Centre Audit', 'Read centre audit log', 'tenant'),
  ('self.profile.manage', 'Manage Own Profile', 'View and update own profile', 'tenant')
on conflict (code) do nothing;

-- Platform super admin receives every permission.
insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r cross join permissions p
where r.code = 'platform_super_admin'
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r join permissions p on true
where r.code = 'centre_admin' and p.code in (
  'tenant.settings.manage', 'tenant.members.manage', 'tenant.roles.grant',
  'tenant.content.manage', 'tenant.cbt.manage', 'tenant.reports.view',
  'tenant.billing.manage', 'tenant.audit.view'
)
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r join permissions p on true
where r.code = 'teacher' and p.code in (
  'tenant.content.manage', 'tenant.cbt.manage', 'tenant.reports.view', 'self.profile.manage'
)
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r join permissions p on true
where r.code = 'student' and p.code in ('self.profile.manage')
on conflict do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r join permissions p on true
where r.code = 'support' and p.code in (
  'tenant.members.manage', 'tenant.reports.view', 'tenant.audit.view', 'self.profile.manage'
)
on conflict do nothing;

-- 10. Row-level security (defense in depth) -----------------------

-- RLS is the final enforcement layer. Application access runs inside one of
-- the scoped helpers in src/server/db/client.ts, which sets the transaction-
-- local settings read by these policies:
--   app.tenant_id          the active tenant uuid, or empty
--   app.user_id            the authenticated user uuid, or empty
--   app.is_platform_admin  'true' for platform-level operations
--   app.is_bootstrapping   'true' only for migrations/seed tooling
-- RLS never replaces the application authorization layer; it contains damage
-- if a query escapes the application boundary.

create or replace function app_is_true(name text) returns boolean as $$
  select coalesce(current_setting(name, true), '') = 'true';
$$ language sql stable;

create or replace function app_tenant_id() returns uuid as $$
begin
  return nullif(current_setting('app.tenant_id', true), '')::uuid;
exception
  when others then return null;
end;
$$ language plpgsql stable;

create or replace function app_user_id() returns uuid as $$
begin
  return nullif(current_setting('app.user_id', true), '')::uuid;
exception
  when others then return null;
end;
$$ language plpgsql stable;

-- user_roles -------------------------------------------------------
alter table user_roles enable row level security;
alter table user_roles force row level security;

create policy user_roles_select on user_roles for select using (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or app_user_id() = user_id
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
);

create policy user_roles_write on user_roles for all using (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
) with check (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
);

-- tenant_memberships ------------------------------------------------
alter table tenant_memberships enable row level security;
alter table tenant_memberships force row level security;

create policy tenant_memberships_select on tenant_memberships for select using (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or app_user_id() = user_id
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
);

create policy tenant_memberships_write on tenant_memberships for all using (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
) with check (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
);

-- student_profiles --------------------------------------------------
alter table student_profiles enable row level security;
alter table student_profiles force row level security;

create policy student_profiles_select on student_profiles for select using (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or app_user_id() = user_id
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
);

create policy student_profiles_write on student_profiles for all using (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
) with check (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
);

-- teacher_profiles --------------------------------------------------
alter table teacher_profiles enable row level security;
alter table teacher_profiles force row level security;

create policy teacher_profiles_select on teacher_profiles for select using (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or app_user_id() = user_id
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
);

create policy teacher_profiles_write on teacher_profiles for all using (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
) with check (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
);

-- audit_logs ---------------------------------------------------------
-- Inserts are always allowed so every event is recorded even when actor or
-- tenant context is missing (for example, a failed login). Reads are limited
-- to the actor, the enclosing tenant, or platform administrators.
alter table audit_logs enable row level security;
alter table audit_logs force row level security;

create policy audit_logs_insert on audit_logs for insert with check (true);

create policy audit_logs_select on audit_logs for select using (
  app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or app_user_id() = actor_user_id
  or (app_tenant_id() is not null and app_tenant_id() = tenant_id)
);