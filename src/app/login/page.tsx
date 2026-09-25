import Link from "next/link";
import LoginForm from "./login-form";
import { PublicPage } from "../components/public-page";

export default function LoginPage() {
  return <PublicPage><section className="page-section" style={{ maxWidth: 560, margin: "auto" }}><span className="eyebrow">Secure access</span><h2>Sign in to your workspace.</h2><p>Use the account provided by your centre. Your active centre and permissions are resolved securely after sign-in.</p><div className="card" style={{ marginTop: "1.5rem" }}><LoginForm /></div><p style={{ marginTop: "1rem" }}><Link className="text-link" href="/">← Back to home</Link></p></section></PublicPage>;
}