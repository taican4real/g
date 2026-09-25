-- Phase 0 design migration. Apply only after selecting a PostgreSQL provider.
create extension if not exists pgcrypto;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  -- Identity-provider mapping: a subject is only unique within a provider,
  -- so the pair (auth_provider, external_subject) must be unique together.
  auth_provider text not null,
  external_subject text not null,
  email text,
  phone text,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_provider, external_subject)
);

create table tenant_memberships (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- Canonical least-privilege roles. Tenant-scoped roles: centre_admin,
  -- teacher, student, support. Global platform administration is expressed
  -- only through platform_admin. Adding roles requires a migration, so the
  -- set intentionally stays small.
  role text not null check (role in ('platform_admin', 'centre_admin', 'teacher', 'student', 'support')),
  membership_status text not null default 'active' check (membership_status in ('invited', 'active', 'suspended', 'removed')),
  human_code text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  unique (tenant_id, human_code)
);

create index tenant_memberships_user_idx on tenant_memberships (user_id);

-- Application transactions must set this value from a verified server-side context:
-- select set_config('app.tenant_id', '<tenant uuid>', true);
-- RLS policies will be enabled as tenant-owned tables are introduced.
