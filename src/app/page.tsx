import Link from "next/link";
import { cookies } from "next/headers";
import { sessionCookieName } from "@/server/auth/sessions";
import { PublicPage } from "./components/public-page";

export default async function Home() {
  const cookieStore = await cookies();
  const hasSession = Boolean(cookieStore.get(sessionCookieName())?.value);

  return <PublicPage><section className="hero"><div><span className="eyebrow">Prepared for progress</span><h1>A clearer route to exam readiness.</h1><p>ExamForge gives Nigerian tutorial centres a focused place to organise preparation for UTME and WAEC, with learning access shaped by the centre that supports each student.</p><div className="header-actions"><Link className="button button-primary" href={hasSession ? "/app" : "/registration"}>{hasSession ? "Open workspace" : "Register interest"}</Link><Link className="button button-secondary" href="/examinations">Explore examinations</Link></div></div><div className="hero-panel"><span className="eyebrow">Built for centres</span><h2>One foundation for students, teachers, and administrators.</h2><p>Secure access, centre-aware workspaces, and a place for examination content to grow without pretending the work is already done.</p></div></section><section className="page-section"><span className="eyebrow">A practical starting point</span><h2>Made for the work between enrolment and exam day.</h2><div className="feature-grid"><div className="feature"><span className="eyebrow">01</span><h3>Centre-led</h3><p>Each centre has its own workspace, membership, and access boundaries.</p></div><div className="feature"><span className="eyebrow">02</span><h3>Exam-aware</h3><p>UTME and WAEC configuration will be driven by published examination data.</p></div><div className="feature"><span className="eyebrow">03</span><h3>Ready to grow</h3><p>Learning resources, practice, results, and progress can arrive as honest modules.</p></div></div></section></PublicPage>;
}
