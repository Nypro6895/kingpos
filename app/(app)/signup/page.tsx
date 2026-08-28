import { SignupForm } from "@/app/signup/signup-form";
import { LegalFooter } from "@/components/legal-footer";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

type SignupPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

export const metadata: Metadata = {
  title: "Create account | ReyLUMI",
  description:
    "Create a ReyLUMI account to save favorite salons, book services, and manage your beauty plans.",
};

function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <Link
      aria-label="ReyLUMI Explore"
      className={[
        "inline-flex min-h-11 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-orange",
        className,
      ].join(" ")}
      href="/explore"
    >
      <Image
        alt="ReyLUMI"
        className="h-auto w-[9.25rem] object-contain sm:w-[10.5rem] lg:w-[11.25rem]"
        fetchPriority="high"
        height={105}
        src="/brand/reylumi-logo-login.webp"
        width={384}
      />
    </Link>
  );
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { error, next } = await searchParams;
  const nextPath = sanitizeAuthReturnPath(next);

  return (
    <>
      <main className="relative z-10 overflow-hidden bg-[linear-gradient(135deg,#fffaf6_0%,#ffffff_48%,#edf8f6_100%)] px-4 py-6 text-text-primary pointer-events-auto sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto grid min-h-[calc(100dvh-8rem)] w-full max-w-[76rem] items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)] xl:gap-12">
          <section className="relative hidden overflow-hidden rounded-[1.75rem] border border-white/90 bg-white/72 p-8 shadow-[0_24px_80px_rgba(35,25,22,0.08)] backdrop-blur lg:flex lg:min-h-[36rem] lg:flex-col">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,var(--brand-orange),var(--brand-teal))]" />
            <BrandLogo />
            <p className="mt-9 text-xs font-extrabold uppercase text-brand-orange">
              ReyLUMI account
            </p>
            <h2 className="mt-5 max-w-xl text-5xl font-semibold leading-[1.02] tracking-normal text-text-primary">
              Start booking beauty services with less friction.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-text-secondary">
              Save the salons, artists, and services you love so every return
              visit feels easier.
            </p>

            <div className="mt-10 divide-y divide-divider-subtle border-y border-divider-subtle">
              {[
                ["Fast checkout", "Keep your profile ready for future bookings."],
                ["Saved favorites", "Return to the places and services you trust."],
                ["Personal history", "Manage upcoming plans from one account."],
              ].map(([title, body]) => (
                <div className="flex items-start gap-4 py-4" key={title}>
                  <span
                    aria-hidden="true"
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-orange shadow-[0_0_0_5px_rgba(242,111,61,0.12)]"
                  />
                  <div>
                    <p className="text-sm font-extrabold text-text-primary">
                      {title}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-text-secondary">
                      {body}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-auto flex flex-wrap gap-2 pt-8">
              {["Hair", "Nails", "Spa", "Lashes", "Barber"].map((category) => (
                <span
                  className="rounded-full border border-white/90 bg-white/82 px-3 py-1.5 text-xs font-extrabold text-text-primary shadow-sm"
                  key={category}
                >
                  {category}
                </span>
              ))}
            </div>
          </section>

          <section className="mx-auto w-full max-w-[30rem]" aria-labelledby="signup-heading">
            <div className="mb-5 lg:hidden">
              <BrandLogo />
            </div>

            <div className="rounded-[1.5rem] border border-white/90 bg-white/94 p-5 shadow-[0_24px_80px_rgba(35,25,22,0.11)] backdrop-blur sm:p-7">
              <p className="text-xs font-extrabold uppercase text-brand-orange">
                Join ReyLUMI
              </p>
              <h1
                className="mt-3 text-3xl font-semibold tracking-normal text-text-primary"
                id="signup-heading"
              >
                Create account
              </h1>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                Save favorites, book faster, and keep your beauty plans in one
                place.
              </p>

              {error ? (
                <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                  {error}
                </p>
              ) : null}

              <SignupForm nextPath={nextPath} />

              <p className="mt-6 border-t border-divider-subtle pt-5 text-center text-sm leading-6 text-text-secondary">
                Already have an account?{" "}
                <Link
                  className="font-extrabold text-brand-orange underline-offset-4 transition hover:text-brand-orange-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                  href={`/login?next=${encodeURIComponent(nextPath)}`}
                >
                  Log in
                </Link>
              </p>
            </div>
          </section>
        </div>
      </main>
      <LegalFooter />
    </>
  );
}
