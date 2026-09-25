import Link from "next/link";
import { getAppContext } from "@/server/auth/app-context";
import { EmptyState, Card, Badge } from "../components/ui";
import TenantSwitcher from "./tenant-switcher";

export default async function WorkspacePage() {
  const { user, context, memberships, tenant } = await getAppContext();
  return <div className="page-stack">
    <div className="page-heading"><div><span className="eyebrow">Workspace overview</span><h2>Good to see you, {user.displayName.split(" ")[0]}</h2><p>Choose a workspace area from the navigation when you are ready.</p></div><Badge tone={context ? "green" : "amber"}>{context ? "Access verified" : "Centre selection needed"}</Badge></div>
    {!context && memberships.length > 1 ? <Card><h3>Select a centre</h3><p className="muted">Your account belongs to multiple centres. Select the centre you want to work in.</p><TenantSwitcher memberships={memberships} /></Card> : null}
    {!context && memberships.length === 0 ? <Card><EmptyState title="No centre assigned yet">Your account is authenticated, but it has not been assigned to a tutorial centre.</EmptyState></Card> : null}
    {context ? <div className="dashboard-grid"><Card><span className="eyebrow">Current role</span><h3>{context.roles.join(", ")}</h3><p className="muted">Your permissions are resolved from the server-side role assignments.</p></Card><Card><span className="eyebrow">Active centre</span><h3>{tenant?.name ?? "Platform administration"}</h3><p className="muted">{tenant ? tenant.slug : "No centre context is selected."}</p></Card></div> : null}
    <Card><div className="section-heading"><div><span className="eyebrow">Getting started</span><h3>Product areas are being prepared</h3></div><Link href="/about" className="text-link">About ExamForge →</Link></div><EmptyState title="No learning activity yet">Examinations, subjects, resources, and progress will appear here once those modules are enabled for your centre.</EmptyState></Card>
  </div>;
}