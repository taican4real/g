import { getAppContext, requireRole } from "@/server/auth/app-context";
import { listCurriculum } from "@/server/curriculum/curriculum";
import CurriculumManager from "./curriculum-manager";

export const dynamic = "force-dynamic";

export default async function CurriculumAdminPage() {
  const { context } = await getAppContext();
  requireRole(context, ["platform_super_admin"]);
  const catalogue = await listCurriculum();
  return <div className="page-stack"><div className="page-heading"><div><span className="eyebrow">Platform administration</span><h2>Curriculum engine</h2><p>Manage examination configuration and syllabus structure. Only verified curriculum records should be activated.</p></div></div><CurriculumManager initialCatalogue={catalogue} /></div>;
}
