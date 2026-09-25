import { PublicPage } from "../components/public-page";
import { EmptyState } from "../components/ui";
import { listPublicExaminations } from "@/server/curriculum/curriculum";

export const dynamic = "force-dynamic";

export default async function SubjectsPage() {
	const rows = await listPublicExaminations();
	const subjects = new Map<string, { name: string; exams: Set<string> }>();
	for (const row of rows) {
		if (!row.subject_id || !row.subject_name) continue;
		const current = subjects.get(row.subject_id) ?? { name: row.subject_name, exams: new Set<string>() };
		current.exams.add(row.exam_type_name);
		subjects.set(row.subject_id, current);
	}
	return <PublicPage><section className="page-section"><span className="eyebrow">Subjects</span><h2>Subject choices follow published examination configuration.</h2><p>Subject availability is database-driven. A subject can appear under more than one examination when administrators associate it with active sessions.</p>{subjects.size === 0 ? <EmptyState title="No subjects published">The subject catalogue will appear here after an administrator activates examination and subject records.</EmptyState> : <div className="feature-grid">{[...subjects.values()].map((subject) => <div className="feature" key={subject.name}><h3>{subject.name}</h3><p>{[...subject.exams].join(", ")}</p></div>)}</div>}</section></PublicPage>;
}
