import { redirect } from "next/navigation";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { getSupabaseAuthUser } from "@/lib/supabase/server";
import { normalizePhoneForIdentity } from "@/lib/phone-normalization";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import { signupPhonePath } from "@/lib/signup-phone-routing";
import { SignupPhoneForm } from "@/app/signup/phone/signup-phone-form";
import { withExperiencePage } from "@/components/experience-page";

async function SignupPhonePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const nextPath = sanitizeAuthReturnPath((await searchParams).next, "/activity");
  const user = await getCurrentKingUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(signupPhonePath(nextPath))}`);
  const authUser = await getSupabaseAuthUser();
  const pendingPhone = authUser?.user_metadata.signup_phone;
  const phone = normalizePhoneForIdentity(authUser?.phone_confirmed_at ? authUser.phone : typeof pendingPhone === "string" ? pendingPhone : user.phone) ?? "";
  const verified = Boolean(authUser?.phone_confirmed_at && normalizePhoneForIdentity(authUser.phone) === phone);
  return <main className="min-h-[80dvh] bg-surface-muted px-4 py-8 sm:py-12">
    <section className="mx-auto w-full max-w-md rounded-2xl border border-border-subtle bg-white p-5 sm:p-7">
      <p className="text-xs font-bold uppercase text-brand-orange">Finish setting up your account</p>
      <h1 className="mt-2 text-2xl font-extrabold text-text-primary">Bring your salon history with you</h1>
      <p className="mt-3 text-sm leading-6 text-text-secondary">Verify the number you use at check-in. We’ll connect your past visits and receipts.</p>
      <SignupPhoneForm initialPhone={phone} initiallyVerified={verified} nextPath={nextPath} />
    </section>
  </main>;
}

export default withExperiencePage(SignupPhonePage);
