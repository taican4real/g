import { test } from "node:test";
import assert from "node:assert/strict";
import type { PermissionCode, TenantContext } from "../types/access";
import {
  assertPermission,
  assertPlatformAdmin,
  assertRole,
  assertTenantScoped,
  hasAnyPermission,
  hasPermission,
  isPlatformAdmin,
} from "./authorize";

const tenantContext: TenantContext = {
  tenantId: "tenant-a",
  userId: "user-1",
  roles: ["centre_admin"],
  permissions: ["tenant.settings.manage", "tenant.members.manage"],
};

const studentContext: TenantContext = {
  tenantId: "tenant-a",
  userId: "user-2",
  roles: ["student"],
  permissions: ["self.profile.manage"],
};

const contentAdminContext: TenantContext = {
  tenantId: "tenant-a",
  userId: "user-3",
  roles: ["content_admin"],
  permissions: ["tenant.content.manage", "tenant.cbt.manage"],
};

const platformContext: TenantContext = {
  tenantId: null,
  userId: "user-0",
  roles: ["platform_super_admin"],
  permissions: [],
};

test("hasPermission checks the explicit permission set", () => {
  assert.equal(hasPermission(tenantContext, "tenant.settings.manage"), true);
  assert.equal(
    hasPermission(tenantContext, "tenant.settings.manage" satisfies PermissionCode),
    true,
  );
  assert.equal(hasPermission(studentContext, "tenant.settings.manage"), false);
});

test("platform super admin bypasses the permission matrix", () => {
  assert.equal(isPlatformAdmin(platformContext), true);
  assert.equal(hasPermission(platformContext, "platform.tenants.manage"), true);
  assert.equal(
    hasPermission(platformContext, "tenant.billing.manage"),
    true,
  );
  assert.equal(hasAnyPermission(studentContext, ["tenant.billing.manage"]), false);
});

test("assertPermission returns Result errors with a structured code", () => {
  const allowed = assertPermission(tenantContext, "tenant.settings.manage");
  assert.ok(allowed.ok);
  const denied = assertPermission(studentContext, "tenant.cbt.manage");
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "FORBIDDEN");
  assert.match(denied.error.message, /tenant\.cbt\.manage/);
});

test("assertTenantScoped rejects platform-only contexts", () => {
  assert.ok(assertTenantScoped(tenantContext).ok);
  const denied = assertTenantScoped(platformContext);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "TENANT_REQUIRED");
});

test("assertPlatformAdmin requires elevated role", () => {
  assert.ok(assertPlatformAdmin(platformContext).ok);
  const denied = assertPlatformAdmin(tenantContext);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "FORBIDDEN");
});

test("content admin is limited to content permissions", () => {
  assert.equal(hasPermission(contentAdminContext, "tenant.content.manage"), true);
  assert.equal(hasPermission(contentAdminContext, "tenant.members.manage"), false);
  assert.ok(assertRole(contentAdminContext, "content_admin").ok);
});

test("assertRole checks membership in the role set", () => {
  assert.ok(assertRole(tenantContext, "centre_admin").ok);
  const denied = assertRole(studentContext, "centre_admin");
  assert.equal(denied.ok, false);
});