import { getAppContext, requireRole } from "@/server/auth/app-context";
import { listTeacherRegistrations } from "@/server/teacher-registration/teacher-registration";
import TeacherReviewTable from "./teacher-review-table";

export const dynamic = "force-dynamic";

export default async function TeacherRegistrationsPage() {
  const { context } = await getAppContext();
  requireRole(context, ["centre_admin"]);
  if (!context) return null;
  const registrations = await listTeacherRegistrations(context);
  return <div className="page-stack"><div className="page-heading"><div><span className="eyebrow">Centre administration</span><h2>Teacher applications</h2><p>Review applications before granting teacher access.</p></div></div><TeacherReviewTable initialItems={registrations.ok ? registrations.value : []} /></div>;
}
