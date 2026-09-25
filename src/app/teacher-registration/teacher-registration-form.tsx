"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Field } from "../components/ui";

type Item = Record<string, unknown>;
type Options = { tenants: Item[]; exams: Item[]; subjects: Item[]; pairs: Item[] };

export default function TeacherRegistrationForm() {
  const [options, setOptions] = useState<Options>({ tenants: [], exams: [], subjects: [], pairs: [] });
  const [values, setValues] = useState<Record<string, string>>({});
  const [examTypeIds, setExamTypeIds] = useState<string[]>([]);
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Item | null>(null);
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  useEffect(() => { fetch("/api/teacher-registration/options").then((response) => response.json()).then((payload: { data: Options }) => setOptions(payload.data)).catch(() => setError("Teacher registration options could not be loaded")); }, []);
  const toggle = (list: string[], value: string, setter: (next: string[]) => void) => setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!values.tenantId || examTypeIds.length === 0 || subjectIds.length === 0) { setError("Select a centre, at least one examination type, and at least one subject"); return; }
    const response = await fetch("/api/teacher-registration", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, examTypeIds, subjectIds }) });
    const payload = await response.json() as { data?: Item; error?: { message: string } };
    if (!response.ok) { setError(payload.error?.message ?? "Teacher registration could not be submitted"); return; }
    setSubmitted(payload.data ?? null);
  };
  if (submitted) return <Card><div className="confirmation"><span className="eyebrow">Application submitted</span><h3>Teacher code: {String(submitted.teacherCode)}</h3><p className="muted">Your application is pending centre-admin approval. You have not been granted teacher access yet.</p><dl><div><dt>Status</dt><dd>Pending approval</dd></div><div><dt>Payment</dt><dd>No payment required</dd></div></dl></div></Card>;
  return <Card><form onSubmit={submit} className="form-grid"><Field label="Tutorial centre"><select required value={values.tenantId ?? ""} onChange={(event) => set("tenantId", event.target.value)}><option value="">Select centre</option>{options.tenants.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}</select></Field><Field label="Full name"><input required value={values.fullName ?? ""} onChange={(event) => set("fullName", event.target.value)} /></Field><Field label="Email"><input type="email" required value={values.email ?? ""} onChange={(event) => set("email", event.target.value)} /></Field><Field label="Phone"><input required value={values.phone ?? ""} onChange={(event) => set("phone", event.target.value)} /></Field><Field label="Professional information"><textarea required value={values.professionalInformation ?? ""} onChange={(event) => set("professionalInformation", event.target.value)} /></Field><Field label="Qualifications"><textarea required value={values.qualifications ?? ""} onChange={(event) => set("qualifications", event.target.value)} /></Field><Field label="Account password" hint="At least 8 characters, including a letter and number"><input type="password" required value={values.password ?? ""} onChange={(event) => set("password", event.target.value)} /></Field><fieldset className="subject-picker"><legend>Examination types</legend>{options.exams.map((item) => <label key={String(item.id)}><input type="checkbox" checked={examTypeIds.includes(String(item.id))} onChange={() => toggle(examTypeIds, String(item.id), setExamTypeIds)} />{String(item.name)}</label>)}</fieldset><fieldset className="subject-picker"><legend>Subjects</legend>{options.subjects.map((item) => <label key={String(item.id)}><input type="checkbox" checked={subjectIds.includes(String(item.id))} onChange={() => toggle(subjectIds, String(item.id), setSubjectIds)} />{String(item.name)}</label>)}</fieldset>{error ? <div style={{ gridColumn: "1 / -1" }}><Alert tone="error">{error}</Alert></div> : null}<div className="form-actions" style={{ gridColumn: "1 / -1" }}><Button type="submit">Submit for approval</Button></div></form></Card>;
}
