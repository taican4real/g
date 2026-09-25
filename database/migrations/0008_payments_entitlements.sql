-- Phase 7: payment, verification, and entitlement engine.
-- Payments are always verified server-side. A success state is reached only
-- through a signature-verified provider webhook that is reconciled against
-- the provider's own transaction verification API. Nothing in a browser
-- redirect, query parameter, or client state ever activates access.

-- 1. Payment plans ------------------------------------------------
-- Tenant-owned pricing plans. A plan may be scoped to one examination type
-- and optionally one subject; a plan with a null exam scope covers every
-- examination the tenant offers. `entitlement_duration_days` is the default
-- access duration granted after a verified payment (null = unresolved until
-- configured).
create table payment_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  plan_type text not null default 'one_time'
    check (plan_type in ('one_time', 'subscription')),
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'NGN',
  exam_type_id uuid references exam_types(id) on delete set null,
  subject_id uuid references subjects(id) on delete set null,
  entitlement_duration_days integer
    check (entitlement_duration_days is null or entitlement_duration_days > 0),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index payment_plans_tenant_idx on payment_plans (tenant_id, status);
-- 2. Payments ------------------------------------------------------
-- A payment is one check-out session for a payment requirement. The state
-- machine is driven exclusively by server-side verification.
create table payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  user_id uuid not null references users(id) on delete restrict,
  registration_id uuid references student_registrations(id) on delete set null,
  payment_requirement_id uuid references payment_requirements(id) on delete set null,
  plan_id uuid references payment_plans(id) on delete set null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency char(3) not null default 'NGN',
  status text not null default 'pending'
    check (status in (
      'pending', 'processing', 'success', 'failed', 'cancelled', 'refunded', 'expired'
    )),
  provider text,
  provider_reference text,
  checkout_url text,
  -- Opaque one-time token returned to the student's browser; it authorizes
  -- nothing by itself. Only the verified webhook path changes payment state.
  checkout_token_hash text unique,
  paid_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  provider_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference)
);

create index payments_tenant_user_idx on payments (tenant_id, user_id, created_at desc);
create index payments_requirement_idx on payments (payment_requirement_id);
create trigger payments_updated_at before update on payments for each row execute function set_updated_at();

-- 3. Payment transactions (webhook events) -------------------------
-- Append-only record of raw provider webhooks. (provider, provider_transaction_id)
-- is the idempotency anchor: a duplicate webhook is acknowledged without
-- re-applying any effect. The raw payload is kept so delivery can be
-- replayed and audited.
create table payment_transactions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_transaction_id text not null,
  payment_id uuid references payments(id) on delete set null,
  event_type text,
  raw_payload jsonb not null default '{}'::jsonb,
  signature_verified boolean not null default false,
  verification_status text not null default 'received'
    check (verification_status in ('received', 'verified', 'failed', 'ignored')),
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

-- 4. Entitlements --------------------------------------------------
-- Access grants derived from verified payments. This is the ONLY source of
-- access truth; a `student.paid` boolean must never be used.
create table entitlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  payment_id uuid references payments(id) on delete set null,
  plan_id uuid references payment_plans(id) on delete set null,
  registration_id uuid references student_registrations(id) on delete set null,
  exam_type_id uuid references exam_types(id) on delete set null,
  subject_id uuid references subjects(id) on delete set null,
  status text not null default 'pending'
    check (status in (
      'pending', 'active', 'expiring', 'expired', 'suspended', 'cancelled'
    )),
  starts_at timestamptz,
  expires_at timestamptz,
  granted_at timestamptz,
  cancelled_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or starts_at is null or expires_at >= starts_at)
);

create index entitlements_tenant_user_idx on entitlements (tenant_id, user_id, status);
create index entitlements_expiry_idx on entitlements (status, expires_at);
create trigger entitlements_updated_at before update on entitlements for each row execute function set_updated_at();

-- 6. Confirmation template for verified payments -------------------
insert into notification_templates (code, version, subject_template, html_template, text_template)
values (
  'student.payment.confirmed',
  1,
  'ExamForge payment confirmed',
  '<!doctype html><html><body style="margin:0;background:#f6f8fa;font-family:Arial,sans-serif;color:#17324d"><main style="max-width:620px;margin:32px auto;background:#fff;padding:32px;border:1px solid #d8e2ea"><h1 style="font-size:24px">Payment confirmed</h1><p>Hi {{firstName}}, your payment of {{amount}} {{currency}} has been verified.</p><p><strong>Student code:</strong> {{studentCode}}<br><strong>Examination:</strong> {{examination}}<br><strong>Reference:</strong> {{providerReference}}</p><p>Your workspace access is now active until {{expiresAt}}.</p><p>Sign in at <a href="{{loginUrl}}">{{loginUrl}}</a> to continue learning.</p></main></body></html>',
  'Payment confirmed\n\nHi {{firstName}}, your payment of {{amount}} {{currency}} has been verified.\nStudent code: {{studentCode}}\nExamination: {{examination}}\nReference: {{providerReference}}\nWorkspace access is active until {{expiresAt}}.\nSign in: {{loginUrl}}'
)
on conflict (code) do nothing;

-- 7. Row-level security ---------------------------------------------
-- Reads expose the owning student and tenant administration; writes are
-- confined to system workflows (webhooks, workers) and platform tooling.
alter table payment_plans enable row level security;
alter table payment_plans force row level security;
alter table payments enable row level security;
alter table payments force row level security;
alter table payment_transactions enable row level security;
alter table payment_transactions force row level security;
alter table entitlements enable row level security;
alter table entitlements force row level security;

create policy payment_plans_system_all on payment_plans for all using (
  app_is_true('app.is_system') or app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin') or app_tenant_id() = tenant_id
) with check (
  app_is_true('app.is_system') or app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
);

create policy payments_system_all on payments for all using (
  app_is_true('app.is_system') or app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or app_user_id() = user_id or app_tenant_id() = tenant_id
) with check (
  app_is_true('app.is_system') or app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
);

create policy payment_transactions_system_all on payment_transactions for all using (
  app_is_true('app.is_system') or app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
) with check (
  app_is_true('app.is_system') or app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
);

create policy entitlements_system_all on entitlements for all using (
  app_is_true('app.is_system') or app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
  or app_user_id() = user_id or app_tenant_id() = tenant_id
) with check (
  app_is_true('app.is_system') or app_is_true('app.is_bootstrapping')
  or app_is_true('app.is_platform_admin')
);
-- 5. Link payment requirements to plans ----------------------------
alter table payment_requirements
  add column if not exists plan_id uuid references payment_plans(id) on delete set null;
create index payment_transactions_payment_idx on payment_transactions (payment_id);
create index payment_transactions_created_idx on payment_transactions (created_at desc);