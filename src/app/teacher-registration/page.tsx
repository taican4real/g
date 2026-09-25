import Link from "next/link";
import { PublicPage } from "../components/public-page";
import TeacherRegistrationForm from "./teacher-registration-form";

export default function TeacherRegistrationPage() {
  return <PublicPage><section className="page-section registration-page"><span className="eyebrow">Teacher registration</span><h2>Join a tutorial centre as a teacher.</h2><p>Submit your professional background, qualifications, examination types, and subjects for centre-admin review.</p><TeacherRegistrationForm /><p style={{ textAlign: "center" }}><Link className="text-link" href="/login">Already have an account? Sign in →</Link></p></section></PublicPage>;
}
