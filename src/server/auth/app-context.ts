import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, listActiveMemberships, resolveTenantContext } from "./context";
import { sessionCookieName } from "./sessions";
import type { TenantContext, UserRole } from "../types/access";

export async function getAppContext() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (!token) redirect("/login?next=/app");
  const sessionUser = await getSessionUser(token);
  if (!sessionUser) redirect("/login?next=/app");
  const contextResult = await resolveTenantContext(sessionUser.session);
  const memberships = await listActiveMemberships(sessionUser.user.id);
  const context = contextResult.ok ? contextResult.value : null;
  const tenant = context ? memberships.find((item) => item.tenantId === context.tenantId) ?? null : null;
  return { user: sessionUser.user, context, memberships, tenant };
}

export function requireRole(context: TenantContext | null, roles: readonly UserRole[], destination = "/app") {
  if (!context || !roles.some((role) => context.roles.includes(role))) redirect(destination);
}
