"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ApiError = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export default function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const payload = (await response.json()) as {
        error?: ApiError;
      };
      if (!response.ok) {
        setError(payload.error?.message ?? "Sign in failed");
        setFieldErrors(payload.error?.fieldErrors ?? {});
        return;
      }
      router.push("/app");
      router.refresh();
    } catch {
      setError("Network error while signing in");
    } finally {
      setLoading(false);
    }
  }

  async function requestReset() {
    setError(null);
    setResetMessage(null);
    const response = await fetch("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: identifier }),
    });
    const payload = (await response.json()) as {
      error?: ApiError;
      data?: { resetUrl?: string };
    };
    if (!response.ok) {
      setError(payload.error?.message ?? "Request failed");
      return;
    }
    setResetMessage(
      payload.data?.resetUrl
        ? `Development reset link: ${payload.data.resetUrl}`
        : "If that email exists, a reset link has been issued.",
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}
      <div>
        <label htmlFor="identifier" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="identifier"
          type="email"
          autoComplete="username"
          required
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          className="mt-1 w-full rounded border px-3 py-2"
        />
        {fieldErrors.identifier?.map((message) => (
          <p key={message} className="mt-1 text-sm text-red-600">
            {message}
          </p>
        ))}
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded border px-3 py-2"
        />
        {fieldErrors.password?.map((message) => (
          <p key={message} className="mt-1 text-sm text-red-600">
            {message}
          </p>
        ))}
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={requestReset}
          className="text-blue-600 hover:underline"
        >
          Forgot password?
        </button>
      </div>
      {resetMessage ? (
        <div
          role="status"
          className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700"
        >
          {resetMessage}
        </div>
      ) : null}
    </form>
  );
}