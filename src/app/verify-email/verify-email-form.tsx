"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

type ApiError = { code: string; message: string };

export default function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function verify() {
    setMessage(null);
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/auth/email-verification/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = (await response.json()) as { error?: ApiError };
      if (!response.ok) {
        setError(payload.error?.message ?? "Verification failed");
        return;
      }
      setMessage("Email verified. You can sign in.");
    } catch {
      setError("Network error during verification");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div role="status" className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {message}
        </div>
      ) : null}
      <button
        type="button"
        onClick={verify}
        disabled={loading || !token}
        className="w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Verifying…" : "Verify email"}
      </button>
    </div>
  );
}