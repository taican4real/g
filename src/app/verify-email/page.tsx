import { Suspense } from "react";
import Link from "next/link";
import VerifyEmailForm from "./verify-email-form";

export default function VerifyEmailPage() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold">Verify email</h1>
      <p className="mt-1 text-sm text-gray-600">
        Confirm that this email address belongs to you.
      </p>
      <div className="mt-6">
        <Suspense>
          <VerifyEmailForm />
        </Suspense>
      </div>
      <p className="mt-4 text-sm">
        <Link href="/login" className="text-blue-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}