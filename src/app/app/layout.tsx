import type { ReactNode } from "react";
import AppShell from "../components/app-shell";
import { getAppContext } from "@/server/auth/app-context";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const { user, context, tenant } = await getAppContext();
  return <AppShell displayName={user.displayName} tenantName={tenant?.name ?? null} roles={context?.roles ?? []}>{children}</AppShell>;
}
