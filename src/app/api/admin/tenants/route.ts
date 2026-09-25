import { requireRequestContext } from "@/server/auth/context";
import { assertPlatformAdmin } from "@/server/rbac/authorize";
import { createTenant, listTenants } from "@/server/tenants/tenants";
import type { NextRequest } from "next/server";
import { clientMeta, jsonError, jsonOk, parseBody } from "@/server/shared/http";
import { createTenantSchema } from "@/server/validation/tenant.validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await requireRequestContext(request);
  if (!context.ok) return jsonError(context.error);
  const allowed = assertPlatformAdmin(context.value);
  if (!allowed.ok) return jsonError(allowed.error);

  return jsonOk({ tenants: await listTenants() });
}

export async function POST(request: NextRequest) {
  const context = await requireRequestContext(request);
  if (!context.ok) return jsonError(context.error);
  const allowed = assertPlatformAdmin(context.value);
  if (!allowed.ok) return jsonError(allowed.error);

  const body = await parseBody(request, createTenantSchema);
  if (!body.ok) return jsonError(body.error);

  const result = await createTenant({
    name: body.value.name,
    slug: body.value.slug,
    adminEmail: body.value.adminEmail,
    adminDisplayName: body.value.adminDisplayName,
    adminPassword: body.value.adminPassword,
    actorUserId: context.value.userId,
    ...clientMeta(request),
  });
  if (!result.ok) return jsonError(result.error);

  return jsonOk(result.value, 201);
}