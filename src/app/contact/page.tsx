import { PublicPage } from "../components/public-page";
import { Card, EmptyState } from "../components/ui";

export default function ContactPage() { return <PublicPage><section className="page-section"><span className="eyebrow">Contact</span><h2>Talk to the team building the platform.</h2><p>Centre onboarding and support channels will be published before registrations open.</p><Card><EmptyState title="Support channel coming soon">For now, continue through your centre administrator or return when the onboarding programme launches.</EmptyState></Card></section></PublicPage>; }
