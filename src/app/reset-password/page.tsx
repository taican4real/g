import { Suspense } from "react";
import Link from "next/link";
import ResetPasswordForm from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold">Reset password</h1>
      <p className="mt-1 text-sm text-gray-600">
        If the link is still valid you will be able to set a new password.
      </p>
      <div className="mt-6">
        <Suspense>
          <ResetPasswordForm />
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