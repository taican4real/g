import { getAppContext, requireRole } from "@/server/auth/app-context";
import { listTenants } from "@/server/tenants/tenants";
import { Badge, Card, DataTable, EmptyState } from "../../components/ui";
import CreateTenantForm from "../admin/create-tenant-form";

export default async function SuperAdminWorkspace() {
  const { context } = await getAppContext();
  requireRole(context, ["platform_super_admin"]);

  const tenants = await listTenants();

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Platform administration</span>
          <h2>Centres and platform access</h2>
          <p>Manage tutorial centres, review membership, and create new tenant workspaces.</p>
        </div>
        <Badge tone="blue">{tenants.length} centre{tenants.length === 1 ? "" : "s"}</Badge>
      </div>

      <Card>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Create centre</span>
            <h3>Register a new tutorial centre</h3>
          </div>
        </div>
        <CreateTenantForm />
      </Card>

      <Card>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Centres</span>
            <h3>Tenant overview</h3>
          </div>
        </div>

        {tenants.length === 0 ? (
          <EmptyState title="No centres yet">
            No tutorial centres have been created. Use the form above to create the first tenant and its admin account.
          </EmptyState>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Members</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td>{tenant.name}</td>
                  <td>{tenant.slug}</td>
                  <td>{tenant.status}</td>
                  <td>{tenant.memberCount}</td>
                  <td>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(tenant.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </div>
  );
}
