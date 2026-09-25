-- Phase 4: student registration and payment requirement foundation.

alter table student_profiles
  add column if not exists first_name text,
  add column if not exists middle_name text,
  add column if not exists last_name text,
  add column if not exists gender text check (gender is null or gender in ('female', 'male', 'non_binary', 'prefer_not_to_say')),
  add column if not exists state text,
  add column if not exists lga text,
  add column if not exists school text,
  add column if not exists class_level text,
  add column if not exists academic_information text,
  add column if not exists profile_photo_url text;

create table student_registrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  student_profile_id uuid not null references student_profiles(id) on delete restrict,
  exam_type_id uuid not null references exam_types(id) on delete restrict,
  exam_session_id uuid not null references exam_sessions(id) on delete restrict,
  student_code text not null unique,
  status text not null default 'payment_pending' check (status in ('draft', 'submitted', 'completed', 'payment_pending', 'cancelled')),
  confirmation_code text not null unique,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exam_session_id),
  unique (tenant_id, user_id, exam_session_id),
  constraint registrations_session_type_check check (exam_session_id is not null and exam_type_id is not null)
);

create table registration_subjects (
  registration_id uuid not null references student_registrations(id) on delete cascade,
  exam_subject_id uuid not null references exam_subjects(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (registration_id, exam_subject_id)
);

create table payment_requirements (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references student_registrations(id) on delete restrict,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'NGN',
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  provider text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table registration_confirmations (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references student_registrations(id) on delete cascade,
  confirmation_code text not null unique,
  issued_at timestamptz not null default now()
);

create index registrations_tenant_idx on student_registrations (tenant_id, status);
create index registrations_user_idx on student_registrations (user_id, created_at desc);
create index registration_subjects_subject_idx on registration_subjects (exam_subject_id);

create trigger registrations_updated_at before update on student_registrations for each row execute function set_updated_at();
create trigger payment_requirements_updated_at before update on payment_requirements for each row execute function set_updated_at();

-- The application rechecks all relationships in the registration transaction.
-- These constraints add database-level protection against invalid selections.
alter table student_registrations enable row level security;
alter table student_registrations force row level security;
alter table registration_subjects enable row level security;
alter table registration_subjects force row level security;
alter table payment_requirements enable row level security;
alter table payment_requirements force row level security;
alter table registration_confirmations enable row level security;
alter table registration_confirmations force row level security;

create policy registrations_system_insert on student_registrations for all using (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin') or app_user_id() = user_id or app_tenant_id() = tenant_id) with check (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin') or app_user_id() = user_id or app_tenant_id() = tenant_id);
create policy registration_subjects_system_all on registration_subjects for all using (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin') or exists (select 1 from student_registrations r where r.id = registration_id and (r.user_id = app_user_id() or r.tenant_id = app_tenant_id()))) with check (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin'));
create policy payment_requirements_system_all on payment_requirements for all using (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin') or exists (select 1 from student_registrations r where r.id = registration_id and r.user_id = app_user_id())) with check (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin'));
create policy registration_confirmations_system_all on registration_confirmations for all using (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin') or exists (select 1 from student_registrations r where r.id = registration_id and r.user_id = app_user_id())) with check (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin'));

create policy tenant_memberships_registration_system on tenant_memberships for all using (app_is_true('app.is_system')) with check (app_is_true('app.is_system'));
create policy user_roles_registration_system on user_roles for all using (app_is_true('app.is_system')) with check (app_is_true('app.is_system'));
create policy student_profiles_registration_system on student_profiles for all using (app_is_true('app.is_system')) with check (app_is_true('app.is_system'));

create or replace function enforce_registration_context() returns trigger as $$
begin
  if not exists (
    select 1 from exam_sessions es
    where es.id = new.exam_session_id and es.exam_type_id = new.exam_type_id
  ) then
    raise exception 'registration exam session does not belong to exam type';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger registration_context_check before insert or update on student_registrations
  for each row execute function enforce_registration_context();

-- Public registration uses an explicit system transaction context. Add that
-- context to the existing identity/profile policies without weakening tenant
-- isolation for ordinary requests.
create or replace function app_is_system() returns boolean as $$ select app_is_true('app.is_system'); $$ language sql stable;
