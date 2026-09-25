"use client";

import { useState } from "react";
import { Alert, Badge, Card, EmptyState } from "../../../components/ui";

type Item = Record<string, unknown>;

export default function TeacherReviewTable({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState<string | null>(null);
  async function review(id: string, status: "approved" | "rejected" | "suspended") {
    setError(null);
    const response = await fetch(`/api/teacher-registration/${id}/review`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) { setError("The teacher application could not be updated"); return; }
    setItems((current) => current.map((item) => item.id === id ? { ...item, status } : item));
  }
  return <Card>{error ? <Alert tone="error">{error}</Alert> : null}{items.length === 0 ? <EmptyState title="No teacher applications">New teacher applications will appear here for review.</EmptyState> : <div className="table-wrap"><table><thead><tr><th>Teacher</th><th>Contact</th><th>Qualifications</th><th>Status</th><th>Review</th></tr></thead><tbody>{items.map((item) => <tr key={String(item.id)}><td><strong>{String(item.full_name)}</strong><br /><small>{String(item.teacher_code)}</small></td><td>{String(item.email)}<br />{String(item.phone ?? "")}</td><td>{String(item.qualifications)}</td><td><Badge tone={item.status === "approved" ? "green" : item.status === "pending_approval" ? "amber" : "neutral"}>{String(item.status)}</Badge></td><td><div className="review-actions"><button className="text-link" onClick={() => review(String(item.id), "approved")}>Approve</button><button className="text-link" onClick={() => review(String(item.id), "rejected")}>Reject</button><button className="text-link" onClick={() => review(String(item.id), "suspended")}>Suspend</button></div></td></tr>)}</tbody></table></div>}</Card>;
}
