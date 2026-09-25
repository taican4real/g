import Link from "next/link";

const links = [
  ["About", "/about"],
  ["Examinations", "/examinations"],
  ["Subjects", "/subjects"],
  ["Pricing", "/pricing"],
  ["Contact", "/contact"],
  ["Teach with us", "/teacher-registration"],
] as const;

export function PublicHeader() {
  return <header className="public-header"><Link href="/" className="brand"><span className="brand-mark">E</span><span>ExamForge</span></Link><nav className="public-nav" aria-label="Main navigation">{links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</nav><div className="header-actions"><Link className="button button-secondary" href="/login">Sign in</Link><Link className="button button-primary" href="/registration">Get started</Link></div></header>;
}
