"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Membership = {
  tenantId: string;
  slug: string;
  name: string;
  membershipStatus: string;
};

type ApiError = { code: string; message: string };

export default function TenantSwitcher({
  memberships,
}: {
  memberships: Membership[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function activate(tenantId: string) {
    setBusy(tenantId);
    setError(null);
    try {
      const response = await fetch("/api/auth/tenant/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      const payload = (await response.json()) as { error?: ApiError };
      if (!response.ok) {
        setError(payload.error?.message ?? "Could not switch centre");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error while switching centre");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {memberships.map((membership) => (
        <button
          key={membership.tenantId}
          type="button"
          disabled={busy !== null}
          onClick={() => activate(membership.tenantId)}
          className="w-full rounded border px-4 py-2 text-left hover:bg-gray-50 disabled:opacity-50"
        >
          <span className="font-medium">{membership.name}</span>
          <span className="ml-2 text-sm text-gray-500">
            {membership.slug}
          </span>
        </button>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}