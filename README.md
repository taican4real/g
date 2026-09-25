# ExamForge Platform

Production-oriented foundation for a multi-tenant examination-preparation SaaS for Nigerian tutorial centres, initially targeting UTME and WAEC.

This repository currently contains the Phase 0 architecture, the Phase 1 identity and tenancy foundation, the Phase 2 RBAC/application shell, the Phase 3 database-driven curriculum engine, the Phase 4 student registration transaction, the Phase 5 teacher registration approval workflow, and the Phase 6 notification outbox. Learning workflows, payment provider integration, and AI generation are not implemented yet.

## Local development

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local` only after provisioning the corresponding services; never commit `.env.local`. Local development currently uses the `examforge-db` PostgreSQL Docker container.

## Architecture

Read [docs/architecture.md](docs/architecture.md) for the selected architecture, module boundaries, tenancy and security model, data strategy, and unresolved decisions.

The database contract begins at [database/migrations/0001_initial_tenant_boundary.sql](database/migrations/0001_initial_tenant_boundary.sql) and is extended by the Phase 1 identity migration. Use `pnpm db:migrate` for a configured database and `pnpm db:seed` for local bootstrap data.

Phase 2 provides public routes for home, about, examinations, subjects, pricing, registration, login, and contact. Authenticated role shells are available at `/app/student`, `/app/teacher`, `/app/centre-admin`, and `/app/super-admin`; every role route resolves access on the server. Phase 3 adds `/app/super-admin/curriculum` and protected curriculum CRUD APIs. Phase 4 adds the database-driven student registration flow at `/registration`. Phase 5 adds teacher registration at `/teacher-registration` and centre-admin review at `/app/centre-admin/teacher-registrations`; teachers remain pending and receive no access until approval. Phase 6 queues transactional email notifications and processes them with `pnpm email:worker`; unconfigured development delivery remains queued and is never reported as sent. Seeded UTME and WAEC records are draft demonstration configuration only.

## Commands

- `pnpm dev` starts the Next.js development server.
- `pnpm lint` runs ESLint.
- `pnpm typecheck` runs TypeScript without emitting files.
- `pnpm build` creates a production build once dependencies are available.

## Deployment

The selected deployment model is a managed Node-compatible host with managed
PostgreSQL; see `docs/architecture.md`. No `NEXT_PUBLIC_*` environment
variable may contain a secret; security-critical modules under `src/server`
import `server-only` and are rejected by the build if used from client code.
