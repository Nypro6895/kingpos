import { taxInvitePath } from "@/lib/tax-flow";
import Link from "next/link";
import { SignupForm } from "@/app/signup/signup-form";
export default async function TaxSignup({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const {next}=await searchParams;
  const token=next?.match(/^\/tax\/invite\/([0-9a-f]{64})$/)?.[1];
  const destination=taxInvitePath(token)??"/tax";
  return (
    <main className="tax-auth">
      <Link href="/tax" className="tax-brand">
        ReyLUMI <span>Tax</span>
      </Link>
      <h1>Create your Reylumi account</h1>
      <p>
        Your personal account can open the Tax workspace. No salon registration
        is required.
      </p>
      <SignupForm nextPath={destination} />
      <p>
        Already have an account? <Link href={"/tax/login?"+new URLSearchParams({next:destination})}>Sign in</Link>
      </p>
    </main>
  );
}
