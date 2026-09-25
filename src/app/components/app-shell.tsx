"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { UserRole } from "@/server/types/access";
import LogoutButton from "../app/logout-button";

const roleLabels: Record<UserRole, string> = {
  platform_super_admin: "Super Admin",
  centre_admin: "Centre Admin",
  content_admin: "Content Admin",
  teacher: "Teacher",
  student: "Student",
};

const navByRole: Record<UserRole, { label: string; href: string }[]> = {
  platform_super_admin: [{ label: "Centres", href: "/app/super-admin" }, { label: "Curriculum", href: "/app/super-admin/curriculum" }],
  centre_admin: [{ label: "Centre overview", href: "/app/centre-admin" }, { label: "Teacher applications", href: "/app/centre-admin/teacher-registrations" }],
  content_admin: [{ label: "Content workspace", href: "/app/teacher" }],
  teacher: [{ label: "Teaching workspace", href: "/app/teacher" }],
  student: [{ label: "Learning workspace", href: "/app/student" }],
};

const rolePriority: UserRole[] = [
  "platform_super_admin",
  "centre_admin",
  "content_admin",
  "teacher",
  "student",
];

export default function AppShell({ children, displayName, tenantName, roles }: { children: ReactNode; displayName: string; tenantName: string | null; roles: readonly UserRole[] }) {
  const [open, setOpen] = useState(false);
  const primaryRole = rolePriority.find((role) => roles.includes(role)) ?? "student";
  const nav = navByRole[primaryRole];
  return <div className="app-frame">
    <aside className={`app-sidebar ${open ? "is-open" : ""}`}>
      <div className="sidebar-top"><Link href="/app" className="brand"><span className="brand-mark">E</span><span>ExamForge</span></Link><button className="icon-button mobile-only" onClick={() => setOpen(false)} aria-label="Close navigation">×</button></div>
      <div className="workspace-label"><span>Workspace</span><strong>{tenantName ?? "Platform"}</strong></div>
      <nav className="app-nav" aria-label="Application navigation"><Link href="/app">Overview</Link>{nav.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>{item.label}</Link>)}<Link href="/app/change-password">Account security</Link></nav>
      <div className="sidebar-bottom"><span className="avatar">{displayName.slice(0, 1).toUpperCase()}</span><div><strong>{displayName}</strong><small>{roleLabels[primaryRole]}</small></div><LogoutButton /></div>
    </aside>
    {open ? <button className="sidebar-scrim mobile-only" onClick={() => setOpen(false)} aria-label="Close navigation" /> : null}
    <div className="app-main"><header className="app-header"><button className="icon-button mobile-only" onClick={() => setOpen(true)} aria-label="Open navigation">☰</button><div><span className="eyebrow">{tenantName ?? "Platform workspace"}</span><h1>{roleLabels[primaryRole]}</h1></div><div className="header-user"><span className="avatar">{displayName.slice(0, 1).toUpperCase()}</span><span>{displayName}</span></div></header><main className="app-content">{children}</main></div>
  </div>;
}
