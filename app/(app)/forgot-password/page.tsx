import { ForgotPasswordForm } from "@/app/forgot-password/forgot-password-form";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

type ForgotPasswordPageProps = {
  searchParams: Promise<{
    next?: string;
  }>;
};

export const metadata: Metadata = {
  title: "Reset password | ReyLUMI",
  description: "Request a ReyLUMI password reset link.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const { next } = await searchParams;
  const nextPath = sanitizeAuthReturnPath(next);

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[linear-gradient(135deg,#fffaf5_0%,#ffffff_48%,#eef8f6_100%)] text-text-primary">
      <section className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
        <Link
          aria-label="ReyLUMI Explore"
          className="mb-7 inline-flex min-h-11 items-center self-start rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-orange"
          href="/explore"
        >
          <Image
            alt="ReyLUMI"
            className="h-auto w-[10rem] object-contain"
            height={419}
            priority
            src="/brand/reylumi-logo-horizontal.png"
            width={1527}
          />
        </Link>

        <div className="rounded-[1.5rem] border border-white/90 bg-white/94 p-5 shadow-[0_24px_80px_rgba(35,25,22,0.11)] backdrop-blur sm:p-7">
          <p className="text-xs font-extrabold uppercase text-brand-orange">
            Account access
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-text-primary">
            Forgot password?
          </h1>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Enter your account email and we will send a secure link to reset
            your password.
          </p>

          <ForgotPasswordForm nextPath={nextPath} />
        </div>
      </section>
    </main>
  );
}
