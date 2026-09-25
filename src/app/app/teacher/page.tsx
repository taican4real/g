import { getAppContext, requireRole } from "@/server/auth/app-context";
import { Card, EmptyState } from "../../components/ui";

export default async function TeacherWorkspace() {
  const { context } = await getAppContext();
  requireRole(context, ["teacher", "content_admin"]);
  return <div className="page-stack"><div className="page-heading"><div><span className="eyebrow">Teaching workspace</span><h2>Content and assessments</h2><p>Create and review learning material when the content module is enabled.</p></div></div><Card><EmptyState title="No content yet">Your centre has not published any teaching resources or assessment workspaces.</EmptyState></Card></div>;
}
