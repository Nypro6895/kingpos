import { taxInvitePath } from "@/lib/tax-flow";
import Link from "next/link";
import { LoginForm } from "@/app/login/login-form";
export default async function TaxLogin({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const {next}=await searchParams;
  const token=next?.match(/^\/tax\/invite\/([0-9a-f]{64})$/)?.[1];
  const destination=taxInvitePath(token)??"/tax";
  return (
    <main className="tax-auth">
      <Link href="/tax" className="tax-brand">
        ReyLUMI <span>Tax</span>
      </Link>
      <h1>Sign in to your Tax workspace</h1>
      <p>
        Use your personal Reylumi account. Salon ID and password are used later
        to connect a business.
      </p>
      <LoginForm nextPath={destination} />
      <p>
        New to Reylumi? <Link href={"/tax/signup?"+new URLSearchParams({next:destination})}>Create an account</Link>
      </p>
    </main>
  );
}
