# ExamForge architecture

## Scope

Phase 0 established the production-oriented application boundary for a multi-tenant SaaS serving Nigerian tutorial centres. The initial examination domains are UTME and WAEC. Phase 1 now implements the identity, tenancy, authentication, authorization, audit, and database-isolation foundation. Learning workflows, payment, AI generation, and examination content remain out of scope.

## Environment discovered

- Runtime: Node.js `v26.2.0`
- Package managers: npm `12.0.2` and pnpm available; pnpm is selected
- Framework: none existed; initialized as Next.js App Router with TypeScript and Turbopack
- Database: local PostgreSQL is provisioned in the `examforge-db` Docker container; migrations and RLS policies are applied by the project scripts
- Authentication: local email/password authentication is implemented with server-side sessions, password hashing, recovery tokens, and email-verification tokens; an external identity provider remains a future decision
- Server-side capability: Next.js server components, route handlers, and the `src/server` modules are active
- Secrets: `.env.local` is configured for local development and ignored by Git; server-only values are not exposed through `NEXT_PUBLIC_*`
- Deployment: no deployment target is configured; the application is compatible with a Node-capable managed deployment, subject to the final database and job-worker choices

The initial dependency installation timed out while fetching Next.js, but the lockfile is now installed and the application passes typecheck, lint, and the integration suite in the current environment.

## Selected architecture

A modular monolith is the Phase 0 choice: one Next.js application owns the web experience and synchronous API boundary, with explicit domain modules and a separate worker process added when asynchronous workloads arrive. PostgreSQL is the system of record. Redis-backed jobs and object storage are integration boundaries, not assumptions hidden in browser code.

The application is organized around these boundaries:

- `src/app`: routes, layouts, and HTTP composition only
- `src/server`: server-only use cases, authorization context, validation, and adapters
- `src/domain`: business types and policies with no framework imports
- `database`: migrations, constraints, indexes, and row-level security policies
- `docs`: architecture decisions and operational contracts

Current implementation status:

- Completed: tenant and identity schema, database roles, RLS policies, server-only database access, password authentication, sessions, logout, password change, password reset, email verification, tenant activation, RBAC, audit logging, admin tenant creation, and health checks.
- Phase 3: database-driven examination types, examination sessions, subjects, session-subject associations, syllabi, syllabus subjects, topics, subtopics, and learning objectives. Curriculum administration is platform-super-admin only, and public pages read active records from the database.
- Phase 4: public student registration with server-side validation, database-backed examination/session/subject selection, atomic account/profile/registration/payment-requirement creation, human-readable student codes, confirmation codes, and `payment_pending` status. Payment provider verification is not implemented.
- Phase 5: separate teacher registration with professional and qualification data, database-validated examination/subject selections, unique teacher codes, `pending_approval` status, and centre-admin approval/rejection/suspension. Teacher accounts have no active login or teacher role until approval; no payment requirement is created.
- Phase 6: transactional notification outbox with `notification_templates`, `notifications`, and `email_logs`; provider-neutral server-side email interface; queued student and teacher registration emails; and a worker command that records provider acceptance as `sent` while deferring unconfigured or failed delivery without corrupting registration.
- Deferred: learning resources, entitlements and payment-provider integration, assessments, notification channels beyond email, analytics, and AI jobs.

The modular monolith keeps transactions close to the relational data while preserving a future extraction path for workers and high-volume services.

## Major modules

1. Identity and access: users, sessions, roles, centre membership, and authentication-provider mapping.
2. Tenancy and centre administration: centres, membership, tenant status, settings, and audit events.
3. Examination configuration: examinations, subjects, syllabi, topics, and versioned publishing.
4. Learning resources: metadata, entitlement requirements, object-storage references, and moderation state.
5. Entitlements and billing: products, grants, subscriptions or purchases, payment records, and webhook events.
6. Assessment engine: question bank, tests, attempts, answers, grading, and result snapshots.
7. Progress and notifications: derived progress, delivery preferences, in-app notifications, and outbound events.
8. AI orchestration: prompt templates, generation jobs, moderation, provenance, and human approval. AI is never called directly by a browser.
9. Analytics: append-only events and tenant-scoped reporting projections.

## Data model strategy

Every tenant-owned table carries `tenant_id` and uses UUID primary keys. Human-readable student and teacher codes are separate unique values scoped to a centre; they are not identifiers or authorization credentials. Foreign keys, unique constraints, check constraints, and indexes enforce invariants in PostgreSQL.

One tenant is exactly one tutorial centre in this model. Every tenant-owned row is therefore scoped to exactly one centre through its `tenant_id`, which supports many centres in the same database while keeping foreign keys and row-level security simple. Franchise or group hierarchies above centres are deferred; if they are needed later they arrive as data (for example a nullable `parent_tenant_id`) added by migration, not by restructuring tenant keys.

Examinations and syllabi are database records with effective versions and publication state. No UTME or WAEC subject list is hard-coded in application code. Content is immutable after publication; corrections create a new version and preserve an audit trail.

Tenant isolation is defense in depth:

1. Every repository/use case requires a resolved tenant context.
2. Authorization is checked on the server for every command and query.
3. PostgreSQL row-level security is the planned final enforcement layer, using a transaction-local tenant setting.
4. Background jobs carry an explicit tenant id and re-establish that context before database access.

## Security strategy

- Validate all external input at route boundaries with a schema library such as Zod.
- Keep database, auth, payment, AI, and storage secrets server-only.
- Use short-lived sessions with secure, httpOnly, same-site cookies and provider-managed password handling where possible.
- Apply least-privilege roles from the canonical set defined in the tenancy migration: `centre_admin`, `content_admin`, `teacher`, and `student` for tenant memberships, plus `platform_super_admin` for global platform operation.
- Enforce the server boundary at compile time: security-critical modules under `src/server` import `server-only`, so importing them from client code fails the build. No secret is ever exposed through a `NEXT_PUBLIC_*` variable.
- Require idempotency keys for payment and other retried commands.
- Verify payment webhook signatures and persist the raw event plus processing status before applying effects.
- Record security-sensitive actions in an append-only audit log.
- Redact secrets and personal data from logs; define retention and deletion workflows before launch.
- Add rate limits, CSRF protections where cookie-authenticated mutations need them, and security headers at the edge.

## Authentication strategy

Authentication is provider-backed and application-owned authorization is separate. A provider establishes identity; the application maps that identity to a local user, centre memberships, roles, and status. The final provider is unresolved because it depends on Nigerian phone/email requirements, support for centre-managed accounts, and deployment constraints. No auth state is faked in the browser.

## Future payment architecture

A payment adapter will create a pending payment intent on the server. The browser may redirect to a provider, but it cannot grant access. A server-side webhook verifies the provider signature, stores an idempotent event, reconciles the transaction, and creates an entitlement in one database transaction. Entitlements have explicit scope, status, start/end times, and an audit source. Provider selection is unresolved; Paystack and Flutterwave are candidates for Nigerian coverage.

## Future AI architecture

AI requests enter a server-side generation job table and queue. A worker loads tenant and examination context, invokes an approved provider, validates structured output, records model/prompt/version provenance, and sends the result through moderation and approval before publication. Generated lessons, questions, or videos are ordinary versioned resources after approval. Long-running video generation uses object storage and callback/polling jobs; no API key or provider call is placed in the client bundle.

## Deployment and operations

The initial deployment should use a managed Node-compatible host, managed PostgreSQL with backups and point-in-time recovery, object storage for media, and a managed queue/Redis service when jobs are introduced. CI must run typecheck, lint, migration checks, and tests. Observability should include structured logs, request ids, error tracking, queue metrics, payment reconciliation alerts, and tenant-safe dashboards.

## Unresolved architectural decisions

- Auth provider and whether phone-first login is required.
- Managed PostgreSQL vendor and row-level security operational policy.
- Payment provider, settlement/reconciliation process, and tax/invoice requirements.
- Queue and worker hosting model.
- Object storage/CDN and media transcoding provider.
- Data residency, retention, parental consent, and Nigerian regulatory requirements.
- First Phase 1 vertical slice and its acceptance criteria.

Curriculum content policy: the seed script creates only draft UTME and WAEC demonstration configurations. No official subjects, topics, or learning objectives are claimed or embedded; authoritative curriculum data must be entered and verified by an administrator before activation.
