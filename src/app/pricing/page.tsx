import { PublicPage } from "../components/public-page";
import { EmptyState } from "../components/ui";

export default function PricingPage() { return <PublicPage><section className="page-section"><span className="eyebrow">Pricing</span><h2>Plans will follow the centre programme.</h2><p>Pricing and entitlements are not active yet. Payment access will only be granted after server-side provider verification.</p><EmptyState title="Pricing is being prepared">No plans are available for purchase at this stage.</EmptyState></section></PublicPage>; }
