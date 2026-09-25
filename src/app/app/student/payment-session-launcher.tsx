"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "../../components/ui";

type SessionResult = {
  paymentId: string;
  provider: string;
  checkoutUrl: string;
  status: string;
};

export default function PaymentSessionLauncher() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);

  async function startPayment() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/payments", { method: "POST" });
      const payload = (await response.json()) as {
        error?: { message?: string; code?: string };
        data?: SessionResult;
      };
      if (!response.ok) {
        setError(payload.error?.message ?? "A payment session could not be started");
        return;
      }
      if (payload.data?.checkoutUrl) {
        setResult(payload.data);
        // The student is sent to the provider's hosted checkout. This redirect
        // grants nothing by itself — a webhook verified by our server does.
        window.location.assign(payload.data.checkoutUrl);
      } else {
        setError("The payment provider did not return a checkout URL. No payment was charged.");
      }
    } catch {
      setError("Network error while starting the payment session");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="button" onClick={startPayment} disabled={loading}>
        {loading ? "Starting payment…" : "Start secure payment"}
      </Button>
      <p className="muted text-sm">
        {result
          ? <>Redirecting to the secure payment page ({result.provider}). Access unlocks only after payment is verified server-side.</>
          : <>You will be redirected to a secure payment page. Never share your password or card details outside the payment provider's page.</>}
      </p>
    </div>
  );
}