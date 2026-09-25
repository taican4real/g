-- Phase 5: teacher registration and centre-admin approval workflow.

alter table teacher_profiles
  add column if not exists teacher_code text unique,
  add column if not exists full_name text,
  add column if not exists professional_information text,
  add column if not exists qualifications text,
  add column if not exists profile_photo_url text;

alter table users drop constraint if exists users_status_check;
alter table users add constraint users_status_check check (status in ('pending', 'active', 'suspended', 'deactivated'));

create table teacher_registrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  teacher_profile_id uuid not null references teacher_profiles(id) on delete restrict,
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected', 'suspended')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references users(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table teacher_registration_subjects (
  registration_id uuid not null references teacher_registrations(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (registration_id, subject_id)
);

create table teacher_registration_exams (
  registration_id uuid not null references teacher_registrations(id) on delete cascade,
  exam_type_id uuid not null references exam_types(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (registration_id, exam_type_id)
);

create index teacher_registrations_tenant_status_idx on teacher_registrations (tenant_id, status, created_at desc);
create index teacher_registration_subjects_subject_idx on teacher_registration_subjects (subject_id);
create index teacher_registration_exams_exam_idx on teacher_registration_exams (exam_type_id);
create trigger teacher_registrations_updated_at before update on teacher_registrations for each row execute function set_updated_at();

alter table teacher_registrations enable row level security;
alter table teacher_registrations force row level security;
alter table teacher_registration_subjects enable row level security;
alter table teacher_registration_subjects force row level security;
alter table teacher_registration_exams enable row level security;
alter table teacher_registration_exams force row level security;

create policy teacher_registrations_system_all on teacher_registrations for all using (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin') or app_tenant_id() = tenant_id) with check (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin') or app_tenant_id() = tenant_id);
create policy teacher_registration_subjects_system_all on teacher_registration_subjects for all using (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin') or exists (select 1 from teacher_registrations r where r.id = registration_id and r.tenant_id = app_tenant_id())) with check (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin'));
create policy teacher_registration_exams_system_all on teacher_registration_exams for all using (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin') or exists (select 1 from teacher_registrations r where r.id = registration_id and r.tenant_id = app_tenant_id())) with check (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin'));
create policy teacher_profiles_system_all on teacher_profiles for all using (app_is_true('app.is_system')) with check (app_is_true('app.is_system'));
