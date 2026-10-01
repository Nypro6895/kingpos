import { AccountRecoveryForm } from "@/app/account-recovery/account-recovery-form";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

type AccountRecoveryPageProps = {
  searchParams: Promise<{
    next?: string;
  }>;
};

export const metadata: Metadata = {
  title: "Account recovery | ReyLUMI",
  description: "Use a ReyLUMI recovery code to request account access help.",
};

export default async function AccountRecoveryPage({
  searchParams,
}: AccountRecoveryPageProps) {
  const { next } = await searchParams;
  const nextPath = sanitizeAuthReturnPath(next);

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[linear-gradient(135deg,#fffaf5_0%,#ffffff_48%,#eef8f6_100%)] text-text-primary">
      <section className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-5 py-10">
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
            Recover account
          </h1>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Use a saved recovery code when you cannot access the usual email,
            phone, or trusted device. This creates a support case; it does not
            sign anyone in automatically.
          </p>

          <AccountRecoveryForm nextPath={nextPath} />
        </div>
      </section>
    </main>
  );
}
