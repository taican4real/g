-- Phase 6: transactional notifications and email outbox.

create table notification_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  version integer not null default 1,
  subject_template text not null,
  html_template text not null,
  text_template text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (code, version)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  channel text not null default 'email' check (channel in ('email')),
  notification_type text not null,
  recipient_email text not null,
  template_code text not null references notification_templates(code) on delete restrict,
  template_version integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'bounced')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  bounced_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table email_logs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications(id) on delete cascade,
  provider text not null,
  provider_message_id text,
  status text not null check (status in ('queued', 'sent', 'failed', 'bounced')),
  response_code text,
  response_message text,
  created_at timestamptz not null default now()
);

create index notifications_queue_idx on notifications (status, available_at, created_at);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index email_logs_notification_idx on email_logs (notification_id, created_at desc);
create trigger notifications_updated_at before update on notifications for each row execute function set_updated_at();

insert into notification_templates (code, version, subject_template, html_template, text_template)
values
  (
    'student.registration.confirmed', 1,
    'ExamForge registration confirmation',
    '<!doctype html><html><body style="margin:0;background:#f6f8fa;font-family:Arial,sans-serif;color:#17324d"><main style="max-width:620px;margin:32px auto;background:#fff;padding:32px;border:1px solid #d8e2ea"><h1 style="font-size:24px">Registration confirmation</h1><p>Hi {{firstName}}, your ExamForge registration has been received.</p><p><strong>Student code:</strong> {{studentCode}}<br><strong>Examination:</strong> {{examination}}<br><strong>Subjects:</strong> {{subjects}}</p><p><strong>Payment instructions:</strong> {{paymentInstructions}}</p><p><strong>Payment URL:</strong> {{paymentUrl}}</p><p>Sign in at <a href="{{loginUrl}}">{{loginUrl}}</a> to access your dashboard.</p></main></body></html>',
    'Registration confirmation\n\nHi {{firstName}}, your ExamForge registration has been received.\nStudent code: {{studentCode}}\nExamination: {{examination}}\nSubjects: {{subjects}}\nPayment instructions: {{paymentInstructions}}\nPayment URL: {{paymentUrl}}\nSign in: {{loginUrl}}'
  ),
  (
    'teacher.registration.submitted', 1,
    'ExamForge teacher application received',
    '<!doctype html><html><body style="margin:0;background:#f6f8fa;font-family:Arial,sans-serif;color:#17324d"><main style="max-width:620px;margin:32px auto;background:#fff;padding:32px;border:1px solid #d8e2ea"><h1 style="font-size:24px">Teacher application received</h1><p>Hi {{fullName}}, your application is awaiting centre-admin approval.</p><p><strong>Teacher code:</strong> {{teacherCode}}<br><strong>Examination types:</strong> {{examinationTypes}}<br><strong>Subjects:</strong> {{subjects}}</p><p>No payment is required for this teacher application. We will notify you when your centre reviews it.</p><p>Sign in at <a href="{{loginUrl}}">{{loginUrl}}</a> after approval.</p></main></body></html>',
    'Teacher application received\n\nHi {{fullName}}, your application is awaiting centre-admin approval.\nTeacher code: {{teacherCode}}\nExamination types: {{examinationTypes}}\nSubjects: {{subjects}}\nNo payment is required.\nSign in after approval: {{loginUrl}}'
  )
 on conflict (code) do nothing;

alter table notification_templates enable row level security;
alter table notification_templates force row level security;
alter table notifications enable row level security;
alter table notifications force row level security;
alter table email_logs enable row level security;
alter table email_logs force row level security;

create policy notification_templates_system_all on notification_templates for all using (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin')) with check (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin'));
create policy notifications_system_all on notifications for all using (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin') or app_user_id() = user_id or app_tenant_id() = tenant_id) with check (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin'));
create policy email_logs_system_all on email_logs for all using (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin')) with check (app_is_true('app.is_system') or app_is_true('app.is_bootstrapping') or app_is_true('app.is_platform_admin'));
