import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookieName } from "@/server/auth/sessions";
import {
  getSessionUser,
  resolveTenantContext,
} from "@/server/auth/context";
import { isPlatformAdmin } from "@/server/rbac/authorize";
import { listTenants } from "@/server/tenants/tenants";
import CreateTenantForm from "./create-tenant-form";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (!token) redirect("/login?next=/app/admin");

  const sessionUser = await getSessionUser(token);
  if (!sessionUser) redirect("/login?next=/app/admin");

  const contextResult = await resolveTenantContext(sessionUser.session);
  if (!contextResult.ok || !isPlatformAdmin(contextResult.value)) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Platform administration</h1>
        <p className="mt-2 text-red-600">
          Access denied: platform super admin role required.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/app" className="text-blue-600 hover:underline">
            Back to workspace
          </Link>
        </p>
      </main>
    );
  }

  const tenants = await listTenants();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">Platform administration</h1>
      <p className="mt-1 text-sm text-gray-600">
        Signed in as {sessionUser.user.email}. Actions are recorded in the
        audit log.
      </p>

      <section className="mt-6 rounded border p-4">
        <h2 className="font-semibold">Create a centre</h2>
        <CreateTenantForm />
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Centres ({tenants.length})</h2>
        <table className="mt-2 w-full border text-left text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Slug</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Members</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr key={tenant.id} className="border-b">
                <td className="px-3 py-2">{tenant.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{tenant.slug}</td>
                <td className="px-3 py-2">{tenant.status}</td>
                <td className="px-3 py-2">{tenant.memberCount}</td>
                <td className="px-3 py-2 text-xs">
                  {tenant.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="mt-6 text-sm">
        <Link href="/app" className="text-blue-600 hover:underline">
          Back to workspace
        </Link>
      </p>
    </main>
  );
}