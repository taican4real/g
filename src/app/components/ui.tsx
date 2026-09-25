import type { ReactNode } from "react";

export function Button({
  children,
  variant = "primary",
  type = "button",
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`button button-${variant}`} type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "blue" | "green" | "amber" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Alert({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "error" | "success" }) {
  return <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark">+</div><h3>{title}</h3><p>{children}</p></div>;
}

export function LoadingState() {
  return <div className="loading-state" aria-live="polite"><span className="spinner" /> Loading</div>;
}

export function ErrorState({ children = "Something went wrong. Please try again." }: { children?: ReactNode }) {
  return <Alert tone="error">{children}</Alert>;
}

export function Pagination() {
  return <nav className="pagination" aria-label="Pagination"><button disabled aria-label="Previous page">‹</button><span>Page 1</span><button disabled aria-label="Next page">›</button></nav>;
}

export function DataTable({ children }: { children: ReactNode }) {
  return <div className="table-wrap"><table>{children}</table></div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
