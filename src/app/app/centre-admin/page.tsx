import { getAppContext, requireRole } from "@/server/auth/app-context";
import { Card, EmptyState } from "../../components/ui";

export default async function CentreAdminWorkspace() {
  const { context } = await getAppContext();
  requireRole(context, ["centre_admin"]);
  return <div className="page-stack"><div className="page-heading"><div><span className="eyebrow">Centre administration</span><h2>Run your centre</h2><p>Memberships, settings, and centre operations will be managed here.</p></div></div><Card><EmptyState title="No administration tasks">There are no pending centre administration tasks.</EmptyState></Card></div>;
}
