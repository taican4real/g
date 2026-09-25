"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field } from "../components/ui";

type Item = Record<string, unknown>;
type Options = {
  tenants: Item[];
  examTypes: Item[];
  examSessions: Item[];
  subjects: Item[];
  examSubjects: Item[];
};

type RegistrationResult = Item & { studentCode: string; confirmationCode: string };

const emptyOptions: Options = { tenants: [], examTypes: [], examSessions: [], subjects: [], examSubjects: [] };

export default function RegistrationForm() {
  const router = useRouter();
  const [options, setOptions] = useState<Options>(emptyOptions);
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [loading, setLoading] = useState(true);

  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    fetch("/api/registration/options")
      .then((response) => response.json() as Promise<{ data: Options }>)
      .then((payload) => setOptions(payload.data))
      .catch(() => setError("Registration options could not be loaded"))
      .finally(() => setLoading(false));
  }, []);

  const sessions = useMemo(
    () => options.examSessions.filter((session) => !values.examTypeId || session.exam_type_id === values.examTypeId),
    [options.examSessions, values.examTypeId],
  );
  const subjects = useMemo(() => {
    const allowed = new Set(options.examSubjects.filter((item) => item.exam_session_id === values.examSessionId).map((item) => item.subject_id));
    return options.subjects.filter((subject) => allowed.has(subject.id));
  }, [options, values.examSessionId]);

  const updateType = (value: string) => {
    set("examTypeId", value);
    set("examSessionId", "");
    setSelectedSubjects([]);
  };
  const updateSession = (value: string) => {
    set("examSessionId", value);
    setSelectedSubjects([]);
  };
  const toggleSubject = (id: string) => setSelectedSubjects((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const next = () => {
    setError(null);
    if (step === 3 && (!values.tenantId || !values.examTypeId || !values.examSessionId || selectedSubjects.length === 0)) {
      setError("Select a centre, examination, session, and at least one permitted subject");
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  };
  async function submit() {
    setError(null);
    setLoading(true);
    const response = await fetch("/api/registration", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...values, subjectIds: selectedSubjects }),
    });
    const payload = await response.json() as { data?: RegistrationResult; error?: { message: string } };
    setLoading(false);
    if (!response.ok) {
      setError(payload.error?.message ?? "Registration could not be completed");
      return;
    }
    setResult(payload.data ?? null);
  }

  if (result) {
    return <Card><div className="confirmation">
      <span className="eyebrow">Registration received</span>
      <h3>Your student code is {result.studentCode}</h3>
      <p className="muted">Your registration is awaiting payment verification. No payment has been marked successful.</p>
      <dl><div><dt>Confirmation</dt><dd>{result.confirmationCode}</dd></div><div><dt>Status</dt><dd>Payment pending</dd></div></dl>
      <Button onClick={() => router.push("/app")}>Open workspace</Button>
    </div></Card>;
  }
  if (loading && step === 1 && options.tenants.length === 0) return <Card><div className="loading-state"><span className="spinner" /> Loading registration options</div></Card>;

  return <Card>
    <div className="step-indicator"><span className={step >= 1 ? "current" : ""}>1 Personal</span><span className={step >= 2 ? "current" : ""}>2 Academic</span><span className={step >= 3 ? "current" : ""}>3 Examination</span><span className={step >= 4 ? "current" : ""}>4 Review</span></div>
    {error ? <Alert tone="error">{error}</Alert> : null}
    {step === 1 ? <div className="form-grid">
      <Field label="First name"><input required value={values.firstName ?? ""} onChange={(event) => set("firstName", event.target.value)} /></Field>
      <Field label="Middle name"><input value={values.middleName ?? ""} onChange={(event) => set("middleName", event.target.value)} /></Field>
      <Field label="Last name"><input required value={values.lastName ?? ""} onChange={(event) => set("lastName", event.target.value)} /></Field>
      <Field label="Email"><input type="email" required value={values.email ?? ""} onChange={(event) => set("email", event.target.value)} /></Field>
      <Field label="Phone"><input required value={values.phone ?? ""} onChange={(event) => set("phone", event.target.value)} /></Field>
      <Field label="Date of birth"><input type="date" required value={values.dateOfBirth ?? ""} onChange={(event) => set("dateOfBirth", event.target.value)} /></Field>
      <Field label="Gender"><select required value={values.gender ?? ""} onChange={(event) => set("gender", event.target.value)}><option value="">Select gender</option><option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="prefer_not_to_say">Prefer not to say</option></select></Field>
      <Field label="Address"><input required value={values.address ?? ""} onChange={(event) => set("address", event.target.value)} /></Field>
      <Field label="State"><input required value={values.state ?? ""} onChange={(event) => set("state", event.target.value)} /></Field>
      <Field label="LGA"><input required value={values.lga ?? ""} onChange={(event) => set("lga", event.target.value)} /></Field>
    </div> : null}
    {step === 2 ? <div className="form-grid">
      <Field label="School"><input required value={values.school ?? ""} onChange={(event) => set("school", event.target.value)} /></Field>
      <Field label="Class or level"><input required value={values.classLevel ?? ""} onChange={(event) => set("classLevel", event.target.value)} /></Field>
      <Field label="Academic information"><input value={values.academicInformation ?? ""} onChange={(event) => set("academicInformation", event.target.value)} /></Field>
      <Field label="Account password" hint="At least 8 characters, including a letter and number"><input type="password" required value={values.password ?? ""} onChange={(event) => set("password", event.target.value)} /></Field>
    </div> : null}
    {step === 3 ? <div className="form-grid">
      <Field label="Tutorial centre"><select required value={values.tenantId ?? ""} onChange={(event) => set("tenantId", event.target.value)}><option value="">Select centre</option>{options.tenants.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}</select></Field>
      <Field label="Examination"><select required value={values.examTypeId ?? ""} onChange={(event) => updateType(event.target.value)}><option value="">Select examination</option>{options.examTypes.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}</select></Field>
      <Field label="Session"><select required value={values.examSessionId ?? ""} onChange={(event) => updateSession(event.target.value)}><option value="">Select session</option>{sessions.map((item) => <option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}</select></Field>
      <fieldset className="subject-picker"><legend>Permitted subjects</legend>{subjects.length === 0 ? <p className="muted">Select an examination session to load permitted subjects.</p> : subjects.map((subject) => <label key={String(subject.id)}><input type="checkbox" checked={selectedSubjects.includes(String(subject.id))} onChange={() => toggleSubject(String(subject.id))} />{String(subject.name)}</label>)}</fieldset>
    </div> : null}
    {step === 4 ? <div className="review"><h3>Review registration</h3>{Object.entries(values).filter(([key]) => key !== "password").map(([key, value]) => <div key={key}><span>{key}</span><strong>{value}</strong></div>)}<div><span>Subjects</span><strong>{subjects.filter((subject) => selectedSubjects.includes(String(subject.id))).map((subject) => String(subject.name)).join(", ")}</strong></div><p className="muted">Submitting creates your account and registration. The payment requirement will remain pending until a verified provider flow is implemented.</p></div> : null}
    <div className="form-actions">{step > 1 ? <Button variant="secondary" onClick={() => setStep((current) => current - 1)}>Back</Button> : null}{step < 4 ? <Button onClick={next}>Continue</Button> : <Button onClick={submit} disabled={loading}>{loading ? "Submitting..." : "Submit registration"}</Button>}</div>
  </Card>;
}
