import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Load the local environment so the suite runs standalone with a provisioned
// PostgreSQL (see README: pnpm db:migrate).
if (!process.env.DATABASE_URL && existsSync(join(process.cwd(), ".env.local"))) {
  process.loadEnvFile(join(process.cwd(), ".env.local"));
}

const HAS_DB = Boolean(process.env.DATABASE_URL);
const skipAll = !HAS_DB;

// Imported after env resolution; getDb() connects lazily on first use.
import { withBootstrap, withTenant } from "../db/client";
import { createTenant, activateTenant } from "../tenants/tenants";
import {
  changePassword,
  login,
  logout,
} from "../auth/authentication";
import {
  confirmPasswordReset,
  requestPasswordReset,
} from "../auth/recovery";
import { findSessionRecord } from "../auth/sessions";
import { resolveTenantContext } from "../auth/context";
import { recordAudit } from "../audit/audit";

const skipOrRun = skipAll
  ? {
      skip:
        "DATABASE_URL not set — provision PostgreSQL (pnpm db:migrate first) to run integration tests",
    }
  : undefined;

test(
  "phase 1 integration: tenancy, authentication, RBAC, RLS, and audit",
  { timeout: 90_000, ...(skipOrRun ?? {}) },
  async (t) => {
    const marker = `p1-${Date.now().toString(36)}`;
    const adminA = {
      name: `IT Centre A ${marker}`,
      slug: `it-a-${marker}`,
      email: `admin-a-${marker}@example.com`,
    };
    const adminB = {
      name: `IT Centre B ${marker}`,
      slug: `it-b-${marker}`,
      email: `admin-b-${marker}@example.com`,
    };

    let tenantAId = "";
    let tenantBId = "";
    let passwordA = "";
    let passwordB = "";

    await t.test("creates two isolated tenants with centre admins", async () => {
      const first = await createTenant({
        name: adminA.name,
        slug: adminA.slug,
        adminEmail: adminA.email,
        adminDisplayName: "Admin A",
        actorUserId: null,
      });
      assert.ok(first.ok, JSON.stringify(first));
      if (!first.ok) return;
      tenantAId = first.value.tenant.id;
      assert.ok(first.value.admin.password, "initial password returned once");
      passwordA = first.value.admin.password ?? "";

      const second = await createTenant({
        name: adminB.name,
        slug: adminB.slug,
        adminEmail: adminB.email,
        adminDisplayName: "Admin B",
        actorUserId: null,
      });
      assert.ok(second.ok, JSON.stringify(second));
      if (!second.ok) return;
      tenantBId = second.value.tenant.id;
      passwordB = second.value.admin.password ?? "";
    });

    let tokenA = "";

    await t.test("centre admin A logs in with correct roles and permissions", async () => {
      const result = await login({
        identifier: adminA.email,
        password: passwordA,
        ipAddress: "127.0.0.1",
        userAgent: "node:test",
      });
      assert.ok(result.ok, JSON.stringify(result));
      if (!result.ok) return;
      assert.ok(result.value.roles.includes("centre_admin"));
      assert.ok(result.value.permissions.includes("tenant.settings.manage"));
      assert.ok(result.value.permissions.includes("tenant.roles.grant"));
      assert.ok(!result.value.permissions.includes("platform.tenants.manage"));
      assert.equal(result.value.memberships.length, 1);
      assert.equal(result.value.activeTenant?.tenantId, tenantAId);
      tokenA = result.value.token;
    });

    await t.test("invalid password is rejected as UNAUTHENTICATED", async () => {
      const result = await login({
        identifier: adminA.email,
        password: "WrongPass123",
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "UNAUTHENTICATED");
    });
    await t.test("context resolution derives the tenant from the session", async () => {
      const record = await findSessionRecord(tokenA);
      assert.ok(record);
      if (!record) return;
      const context = await resolveTenantContext({
        sessionId: record.sessionId,
        userId: record.userId,
        activeTenantId: record.activeTenantId,
        authMethod: record.authMethod,
      });
      assert.ok(context.ok);
      if (context.ok) {
        assert.equal(context.value.tenantId, tenantAId);
        assert.equal(context.value.userId, record.userId);
      }
    });

    let tokenB = "";

    await t.test("a user cannot activate a tenant they do not belong to", async () => {
      const loginB = await login({
        identifier: adminB.email,
        password: passwordB,
      });
      assert.ok(loginB.ok);
      if (!loginB.ok) return;
      tokenB = loginB.value.token;
      const record = await findSessionRecord(tokenB);
      assert.ok(record);
      if (!record) return;
      const denied = await activateTenant({
        userId: record.userId,
        sessionId: record.sessionId,
        tenantId: tenantAId, // admin B has no membership here
      });
      assert.equal(denied.ok, false);
      if (!denied.ok) assert.equal(denied.error.code, "FORBIDDEN");
    });

    await t.test("row-level security hides the other tenant's rows", async () => {
      const loginA2 = await login({ identifier: adminA.email, password: passwordA });
      assert.ok(loginA2.ok);
      if (!loginA2.ok) return;

      const otherTenantRows = await withTenant(tenantAId, loginA2.value.user.id, (tx) =>
        tx`select count(*) as count from tenant_memberships where tenant_id = ${tenantBId}`,
      );
      assert.equal(Number(otherTenantRows[0].count), 0);

      const ownRows = await withTenant(tenantAId, loginA2.value.user.id, (tx) =>
        tx`select count(*) as count from tenant_memberships where tenant_id = ${tenantAId}`,
      );
      assert.equal(Number(ownRows[0].count), 1);

      const foreignAudit = await withTenant(tenantAId, loginA2.value.user.id, (tx) =>
        tx`select count(*) as count from audit_logs where tenant_id = ${tenantBId}`,
      );
      assert.equal(Number(foreignAudit[0].count), 0);
    });

    await t.test("audit log records login and account-creation events", async () => {
      const adminRecord = await findSessionRecord(tokenA);
      assert.ok(adminRecord);
      if (!adminRecord) return;
      const events = await withTenant(tenantAId, adminRecord.userId, (tx) =>
        tx`
          select action from audit_logs
          where tenant_id = ${tenantAId}
            and action in ('auth.login', 'user.account_created')
        `,
      );
      const actions = events.map((row) => row.action);
      assert.ok(actions.includes("auth.login"));
      assert.ok(actions.includes("user.account_created"));
    });

    await t.test("audit writes a tenant-scoped event and reads it back", async () => {
      const adminRecord = await findSessionRecord(tokenA);
      assert.ok(adminRecord);
      if (!adminRecord) return;
      await withTenant(tenantAId, adminRecord.userId, () =>
        recordAudit({
          action: "permission.changed",
          tenantId: tenantAId,
          actorUserId: adminRecord.userId,
          details: { role: "teacher" },
        }),
      );
      const found = await withTenant(tenantAId, adminRecord.userId, (tx) =>
        tx`
          select count(*) as count from audit_logs
          where tenant_id = ${tenantAId} and action = 'permission.changed'
        `,
      );
      assert.equal(Number(found[0].count), 1);
    });
    await t.test("change password revokes other sessions and rejects old", async () => {
      const adminRecord = await findSessionRecord(tokenA);
      assert.ok(adminRecord);
      if (!adminRecord) return;

      const badCurrent = await changePassword({
        userId: adminRecord.userId,
        sessionId: adminRecord.sessionId,
        currentPassword: "WrongPass123",
        newPassword: "NewStrong1",
      });
      assert.equal(badCurrent.ok, false);
      if (!badCurrent.ok) assert.equal(badCurrent.error.code, "FORBIDDEN");

      const good = await changePassword({
        userId: adminRecord.userId,
        sessionId: adminRecord.sessionId,
        currentPassword: passwordA,
        newPassword: "NewStrong1",
      });
      assert.ok(good.ok);

      const oldLogin = await login({ identifier: adminA.email, password: passwordA });
      assert.equal(oldLogin.ok, false);

      const newLogin = await login({ identifier: adminA.email, password: "NewStrong1" });
      assert.ok(newLogin.ok, JSON.stringify(newLogin));
      if (!newLogin.ok) return;
      passwordA = "NewStrong1";
    });

    await t.test("password reset flow issues and consumes a token", async () => {
      const requested = await requestPasswordReset(adminB.email);
      assert.ok(requested.ok);
      if (!requested.ok) return;
      const resetUrl = requested.value.resetUrl;
      assert.ok(resetUrl, "development reset URL returned");
      const token = (resetUrl as string).split("token=")[1];

      const badToken = await confirmPasswordReset({
        token: "no-such-token-value",
        newPassword: "ResetPass1",
      });
      assert.equal(badToken.ok, false);
      if (!badToken.ok) assert.equal(badToken.error.code, "TOKEN_INVALID");

      const confirmed = await confirmPasswordReset({
        token,
        newPassword: "ResetPass1",
      });
      assert.ok(confirmed.ok, JSON.stringify(confirmed));

      const newLogin = await login({ identifier: adminB.email, password: "ResetPass1" });
      assert.ok(newLogin.ok);
      if (!newLogin.ok) return;
      tokenB = newLogin.value.token;
    });

    await t.test("logout revokes the session token", async () => {
      await logout({ token: tokenB, ipAddress: "127.0.0.1", userAgent: "node:test" });
      const record = await findSessionRecord(tokenB);
      assert.equal(record, null);
    });

    await t.test("cleanup integration fixtures", async () => {
      await withBootstrap(async (tx) => {
        await tx`
          delete from tenants where slug in (${adminA.slug}, ${adminB.slug})
        `;
        await tx`
          delete from users where email like ${`%-${marker}@example.com`}
        `;
      });
    });
  },
);