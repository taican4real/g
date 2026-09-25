import { PublicPage } from "../components/public-page";
import { Card, EmptyState } from "../components/ui";
import { listPublicExaminations } from "@/server/curriculum/curriculum";

export const dynamic = "force-dynamic";

export default async function ExaminationsPage() {
	const examinations = await listPublicExaminations();
	const grouped = new Map<string, { name: string; sessions: Map<string, { name: string; subjects: string[] }> }>();
	for (const row of examinations) {
		let exam = grouped.get(row.exam_type_id);
		if (!exam) { exam = { name: row.exam_type_name, sessions: new Map() }; grouped.set(row.exam_type_id, exam); }
		let session = exam.sessions.get(row.exam_session_id);
		if (!session) { session = { name: row.exam_session_name, subjects: [] }; exam.sessions.set(row.exam_session_id, session); }
		if (row.subject_name) session.subjects.push(row.subject_name);
	}
	return <PublicPage><section className="page-section"><span className="eyebrow">Examinations</span><h2>Preparation begins with the right exam context.</h2><p>Published examination configuration comes from the platform curriculum catalogue.</p>{grouped.size === 0 ? <EmptyState title="No examinations published">The public examination catalogue is empty. Administrators must activate verified examination sessions before they appear here.</EmptyState> : <div className="dashboard-grid">{[...grouped.values()].map((exam) => <Card key={exam.name}><h3>{exam.name}</h3>{[...exam.sessions.values()].map((session) => <div key={session.name}><h4>{session.name}</h4>{session.subjects.length ? <p>{session.subjects.join(", ")}</p> : <p className="muted">No active subjects published.</p>}</div>)}</Card>)}</div>}</section></PublicPage>;
}
