import Link from "next/link";
import { PublicPage } from "../components/public-page";
import RegistrationForm from "./registration-form";

export default function RegistrationPage() { return <PublicPage><section className="page-section registration-page"><span className="eyebrow">Student registration</span><h2>Register for your examination preparation.</h2><p>Enter your information, choose from valid database-configured subjects, and review before submission.</p><RegistrationForm /><p style={{ textAlign: "center" }}><Link className="text-link" href="/login">Already have an account? Sign in →</Link></p></section></PublicPage>; }
