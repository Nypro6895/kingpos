import { SignupForm } from "@/app/signup/signup-form";
import { LegalFooter } from "@/components/legal-footer";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import styles from "../auth-screen.module.css";

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
    <div className={styles.authViewport}>
      <main className={styles.authMain}>
        <div className={[styles.authGrid, styles.signupGrid].join(" ")}>
          <section
            className={[
              styles.signupBrandExperience,
              "relative overflow-hidden rounded-[1.75rem] border border-white/90 bg-white/72 p-8 shadow-[0_24px_80px_rgba(35,25,22,0.08)] backdrop-blur",
            ].join(" ")}
          >
            <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,var(--brand-orange),var(--brand-teal))]" />
            <BrandLogo className={styles.authLogo} />
            <p className="mt-9 text-xs font-extrabold uppercase text-brand-orange">
              ReyLUMI account
            </p>
            <h2 className="max-w-xl font-semibold tracking-normal text-text-primary">
              Start booking beauty services with less friction.
            </h2>
            <p
              className={[
                styles.brandBody,
                "max-w-lg text-base leading-7 text-text-secondary",
              ].join(" ")}
            >
              Save the salons, artists, and services you love so every return
              visit feels easier.
            </p>

            <div
              className={[
                styles.signupBenefits,
                "divide-y divide-divider-subtle border-y border-divider-subtle",
              ].join(" ")}
            >
              {[
                ["Fast checkout", "Keep your profile ready for future bookings."],
                ["Saved favorites", "Return to the places and services you trust."],
                ["Personal history", "Manage upcoming plans from one account."],
              ].map(([title, body]) => (
                <div
                  className={[
                    styles.signupBenefitRow,
                    "flex items-start gap-4",
                  ].join(" ")}
                  key={title}
                >
                  <span
                    aria-hidden="true"
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-brand-orange shadow-[0_0_0_5px_rgba(242,111,61,0.12)]"
                  />
                  <div>
                    <p className="text-sm font-extrabold text-text-primary">
                      {title}
                    </p>
                    <p
                      className={[
                        styles.signupBenefitBody,
                        "mt-1 text-sm leading-6 text-text-secondary",
                      ].join(" ")}
                    >
                      {body}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className={[styles.signupPills, "flex flex-wrap gap-2"].join(" ")}>
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

          <section className={styles.authPanel} aria-labelledby="signup-heading">
            <div className={[styles.authPanelInner, styles.signupPanelInner].join(" ")}>
              <div className={styles.mobileHeader}>
                <BrandLogo className={styles.authLogo} />
              </div>

              <div
                className={[
                  styles.authCard,
                  "rounded-[1.5rem] border border-white/90 bg-white/94 shadow-[0_24px_80px_rgba(35,25,22,0.11)] backdrop-blur",
                ].join(" ")}
              >
                <p className="text-xs font-extrabold uppercase text-brand-orange">
                  Join ReyLUMI
                </p>
                <h1
                  className="mt-3 text-3xl font-semibold tracking-normal text-text-primary"
                  id="signup-heading"
                >
                  Create account
                </h1>
                <p
                  className={[
                    styles.authIntro,
                    "text-sm leading-6 text-text-secondary",
                  ].join(" ")}
                >
                  Save favorites, book faster, and keep your beauty plans in one
                  place.
                </p>

                {error ? (
                  <p
                    className={[
                      styles.authNotice,
                      "rounded-2xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-800",
                    ].join(" ")}
                  >
                    {error}
                  </p>
                ) : null}

                <SignupForm nextPath={nextPath} />

                <p
                  className={[
                    styles.authSwitch,
                    "border-t border-divider-subtle text-center text-sm leading-6 text-text-secondary",
                  ].join(" ")}
                >
                  Already have an account?{" "}
                  <Link
                    className="font-extrabold text-brand-orange underline-offset-4 transition hover:text-brand-orange-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                    href={`/login?next=${encodeURIComponent(nextPath)}`}
                  >
                    Log in
                  </Link>
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
