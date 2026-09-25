import Link from "next/link";
import ChangePasswordForm from "./change-password-form";

export default function ChangePasswordPage() {
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold">Change password</h1>
      <p className="mt-1 text-sm text-gray-600">
        Requires the current password. All other sessions are revoked.
      </p>
      <div className="mt-6">
        <ChangePasswordForm />
      </div>
      <p className="mt-4 text-sm">
        <Link href="/app" className="text-blue-600 hover:underline">
          Back to workspace
        </Link>
      </p>
    </main>
  );
}