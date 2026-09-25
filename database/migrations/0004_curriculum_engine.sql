-- Phase 3: database-driven examination, subject, and syllabus engine.
-- Curriculum is platform-owned reference data. Tenant entitlements arrive later.

create table exam_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table exam_sessions (
  id uuid primary key default gen_random_uuid(),
  exam_type_id uuid not null references exam_types(id) on delete restrict,
  code text not null,
  name text not null,
  starts_on date,
  ends_on date,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive', 'archived')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_type_id, code),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table exam_subjects (
  id uuid primary key default gen_random_uuid(),
  exam_session_id uuid not null references exam_sessions(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (exam_session_id, subject_id)
);

create table syllabi (
  id uuid primary key default gen_random_uuid(),
  exam_session_id uuid not null references exam_sessions(id) on delete cascade,
  name text not null,
  version text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive', 'archived')),
  is_demo_data boolean not null default false,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_session_id, name, version)
);

create table syllabus_subjects (
  id uuid primary key default gen_random_uuid(),
  syllabus_id uuid not null references syllabi(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (syllabus_id, subject_id)
);

create table topics (
  id uuid primary key default gen_random_uuid(),
  syllabus_subject_id uuid not null references syllabus_subjects(id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (syllabus_subject_id, name)
);

create table subtopics (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id, name)
);

create table learning_objectives (
  id uuid primary key default gen_random_uuid(),
  subtopic_id uuid not null references subtopics(id) on delete cascade,
  statement text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subtopic_id, statement)
);

create index exam_sessions_type_idx on exam_sessions (exam_type_id, status);
create index exam_subjects_subject_idx on exam_subjects (subject_id);
create index syllabi_session_idx on syllabi (exam_session_id, status);
create index syllabus_subjects_subject_idx on syllabus_subjects (subject_id);
create index topics_context_idx on topics (syllabus_subject_id, status);
create index subtopics_topic_idx on subtopics (topic_id, status);
create index learning_objectives_subtopic_idx on learning_objectives (subtopic_id, status);

create trigger exam_types_updated_at before update on exam_types for each row execute function set_updated_at();
create trigger exam_sessions_updated_at before update on exam_sessions for each row execute function set_updated_at();
create trigger subjects_updated_at before update on subjects for each row execute function set_updated_at();
create trigger syllabi_updated_at before update on syllabi for each row execute function set_updated_at();
create trigger syllabus_subjects_updated_at before update on syllabus_subjects for each row execute function set_updated_at();
create trigger topics_updated_at before update on topics for each row execute function set_updated_at();
create trigger subtopics_updated_at before update on subtopics for each row execute function set_updated_at();
create trigger learning_objectives_updated_at before update on learning_objectives for each row execute function set_updated_at();

-- The relationships below prevent a subject from being attached to a syllabus
-- or session outside its declared examination context.
create or replace function enforce_curriculum_context() returns trigger as $$
begin
  if tg_table_name = 'syllabus_subjects' and not exists (
    select 1 from syllabi s
    join exam_subjects es on es.exam_session_id = s.exam_session_id and es.subject_id = new.subject_id
    where s.id = new.syllabus_id and es.status = 'active'
  ) then
    raise exception 'subject is not active for the syllabus examination session';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger syllabus_subject_context before insert or update on syllabus_subjects
  for each row execute function enforce_curriculum_context();

-- Demonstration records are intentionally absent. Official UTME/WAEC
-- curriculum content must be supplied and verified by an administrator.
