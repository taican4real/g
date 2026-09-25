"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ApiError = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

type CreateResult = {
  tenant: { name: string; slug: string };
  admin: { email: string; password?: string };
};

export default function CreateTenantForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<CreateResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setResult(null);
    setLoading(true);
    try {
      const response = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          adminEmail,
          adminDisplayName,
          adminPassword: adminPassword || undefined,
        }),
      });
      const payload = (await response.json()) as {
        error?: ApiError;
        data?: CreateResult;
      };
      if (!response.ok) {
        setError(payload.error?.message ?? "Creation failed");
        setFieldErrors(payload.error?.fieldErrors ?? {});
        return;
      }
      if (payload.data) {
        setResult(payload.data);
        setName("");
        setSlug("");
        setAdminEmail("");
        setAdminDisplayName("");
        setAdminPassword("");
      }
      router.refresh();
    } catch {
      setError("Network error while creating the centre");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 grid gap-3 sm:grid-cols-2">
      {error ? (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">
          {error}
        </div>
      ) : null}
      {result ? (
        <div role="status" className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800 sm:col-span-2">
          <p>
            Centre <b>{result.tenant.name}</b> created.
          </p>
          <p>
            Admin: {result.admin.email}
            {result.admin.password
              ? ` — initial password: ${result.admin.password} (shown once)`
              : " (existing account)"}
          </p>
        </div>
      ) : null}
      <div>
        <label htmlFor="name" className="block text-sm font-medium">
          Centre name
        </label>
        <input
          id="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="slug" className="block text-sm font-medium">
          Slug
        </label>
        <input
          id="slug"
          required
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="my-centre"
          className="mt-1 w-full rounded border px-3 py-2"
        />
        {fieldErrors.slug?.map((message) => (
          <p key={message} className="mt-1 text-sm text-red-600">
            {message}
          </p>
        ))}
      </div>
      <div>
        <label htmlFor="adminEmail" className="block text-sm font-medium">
          Admin email
        </label>
        <input
          id="adminEmail"
          type="email"
          required
          value={adminEmail}
          onChange={(event) => setAdminEmail(event.target.value)}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="adminDisplayName" className="block text-sm font-medium">
          Admin display name
        </label>
        <input
          id="adminDisplayName"
          required
          value={adminDisplayName}
          onChange={(event) => setAdminDisplayName(event.target.value)}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="adminPassword" className="block text-sm font-medium">
          Initial password <span className="text-gray-400">(optional — generated if empty)</span>
        </label>
        <input
          id="adminPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
          value={adminPassword}
          onChange={(event) => setAdminPassword(event.target.value)}
          className="mt-1 w-full rounded border px-3 py-2"
        />
      </div>
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create centre"}
        </button>
      </div>
    </form>
  );
}