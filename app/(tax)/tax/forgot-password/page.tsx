import Link from "next/link";
import { ForgotPasswordForm } from "@/app/forgot-password/forgot-password-form";
export default function TaxForgotPassword() {
  return (
    <main className="tax-auth">
      <Link href="/tax" className="tax-brand">
        ReyLUMI <span>Tax</span>
      </Link>
      <h1>Recover your account</h1>
      <p>
        Reset your personal Reylumi password, then return to your Tax workspace.
      </p>
      <ForgotPasswordForm nextPath="/tax" />
      <Link href="/tax/login">Back to Tax sign in</Link>
    </main>
  );
}
