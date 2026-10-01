import { LoginForm } from "@/app/login/login-form";
import { LegalFooter } from "@/components/legal-footer";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "../auth-screen.module.css";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
    next?: string;
  }>;
};

export const metadata: Metadata = {
  title: "Log in | ReyLUMI",
  description: "Sign in to ReyLUMI to discover services, save your beauty journey, and book your favorites.",
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
        className="h-auto w-[9.25rem] object-contain sm:w-[10.5rem] lg:w-[12rem]"
        fetchPriority="high"
        height={105}
        src="/brand/reylumi-logo-login.webp"
        width={384}
      />
    </Link>
  );
}

function AuthVisualCard({
  className = "",
  children,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-2xl border border-white/80 bg-white/92 px-4 py-3 text-text-primary shadow-[0_18px_48px_rgba(35,25,22,0.11)] backdrop-blur",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function BrandExperience() {
  return (
    <section
      className={[
        styles.brandExperience,
        "relative overflow-hidden rounded-[2rem] bg-[linear-gradient(145deg,#fff9f2_0%,#fff3eb_44%,#eef8f6_100%)] px-8 py-8 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.72)] xl:px-10",
      ].join(" ")}
    >
      <div className="relative z-10 flex flex-col items-start">
        <BrandLogo className={styles.authLogo} />
        <p
          className={[
            styles.brandBadge,
            "mt-1 text-xs font-bold uppercase text-brand-teal",
          ].join(" ")}
        >
          Beauty and personal services
        </p>
      </div>

      <div className={[styles.brandCopy, "relative z-10 max-w-2xl"].join(" ")}>
        <h1
          className={[
            styles.brandHeadline,
            "max-w-xl font-semibold text-text-primary",
          ].join(" ")}
        >
          Where beauty gets personal.
        </h1>
        <p
          className={[
            styles.brandBody,
            "max-w-lg text-base leading-7 text-text-secondary xl:text-lg",
          ].join(" ")}
        >
          Discover trusted places, keep your look history, and book the people
          who know your style.
        </p>
      </div>

      <div className={styles.brandVisual}>
        <div
          className={[
            styles.brandImagePanel,
            "absolute inset-x-0 bottom-0 overflow-hidden rounded-[1.75rem] border border-white/85 bg-white shadow-[0_28px_90px_rgba(35,25,22,0.12)]",
          ].join(" ")}
        >
          <Image
            alt="Nail, hair, lash, and spa service details"
            className="object-cover"
            fill
            sizes="(min-width: 1024px) 58vw, 100vw"
            src="/explore/login-service-defaults.webp"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0)_42%,rgba(36,27,31,0.2)_100%)]" />
        </div>

        <AuthVisualCard className={[styles.visualCard, "absolute left-6 top-0 w-56"].join(" ")}>
          <p className="text-xs font-extrabold uppercase text-brand-orange">
            Beauty profile
          </p>
          <p className="mt-1 text-sm font-semibold leading-5">
            Save looks, notes, and favorite artists in one place.
          </p>
        </AuthVisualCard>

        <AuthVisualCard
          className={[styles.visualCard, "absolute bottom-8 right-5 w-64"].join(" ")}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold uppercase text-brand-teal">
                Next booking
              </p>
              <p className="mt-1 text-sm font-semibold">Gloss refresh</p>
            </div>
            <span className="rounded-full bg-brand-orange-soft px-3 py-1.5 text-xs font-extrabold text-brand-orange">
              9:30 AM
            </span>
          </div>
        </AuthVisualCard>

        <div
          className={[
            styles.categoryPills,
            "absolute bottom-10 left-6 hidden flex-wrap gap-2 xl:flex",
          ].join(" ")}
        >
          {["Hair", "Nails", "Spa", "Lashes", "Barber"].map((category) => (
            <span
              className="rounded-full border border-white/80 bg-white/82 px-3 py-1.5 text-xs font-extrabold text-text-primary shadow-sm backdrop-blur"
              key={category}
            >
              {category}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function MobileBrandVisual() {
  return (
    <div
      className={[
        styles.mobileBrandVisual,
        "rounded-[1.35rem] border border-white bg-white shadow-[0_18px_48px_rgba(35,25,22,0.08)]",
      ].join(" ")}
    >
      <div className={styles.mobileVisualImage}>
        <Image
          alt="Beauty services and salon details"
          className="object-cover"
          fill
          sizes="100vw"
          src="/explore/login-service-defaults.webp"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0)_38%,rgba(255,250,245,0.76)_100%)]" />
      </div>
      <div className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1.5 text-xs font-extrabold text-brand-orange shadow-sm backdrop-blur">
        Beauty starts with the right place.
      </div>
    </div>
  );
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, message, next } = await searchParams;
  const nextPath = sanitizeAuthReturnPath(next);

  return (
    <div className={styles.authViewport}>
      <main className={styles.authMain}>
        <div className={[styles.authGrid, styles.loginGrid].join(" ")}>
          <BrandExperience />

          <section className={styles.authPanel}>
            <div className={styles.authPanelInner}>
              <div className={styles.mobileHeader}>
                <BrandLogo className={styles.authLogo} />
                <MobileBrandVisual />
              </div>

              <div
                className={[
                  styles.authCard,
                  "rounded-[1.5rem] border border-white/90 bg-white/94 shadow-[0_24px_80px_rgba(35,25,22,0.11)] backdrop-blur",
                ].join(" ")}
              >
                <p className="hidden text-xs font-extrabold uppercase text-brand-orange lg:block">
                  ReyLUMI account
                </p>
                <h2 className="text-3xl font-semibold tracking-normal text-text-primary">
                  Welcome back
                </h2>
                <p
                  className={[
                    styles.authIntro,
                    "text-sm leading-6 text-text-secondary",
                  ].join(" ")}
                >
                  Sign in to continue to ReyLUMI.
                </p>

                {message ? (
                  <p
                    className={[
                      styles.authNotice,
                      "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800",
                    ].join(" ")}
                  >
                    {message}
                  </p>
                ) : null}
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

                <LoginForm
                  nextPath={nextPath}
                  showRecoveryHelpInitially={Boolean(error)}
                />

                <div
                  className={[
                    styles.loginSecondary,
                    "border-t border-divider-subtle",
                  ].join(" ")}
                >
                  <p
                    className={[
                      styles.loginSecondaryText,
                      "text-sm leading-6 text-text-secondary",
                    ].join(" ")}
                  >
                    Discover services, save your beauty journey, and book your
                    favorites.
                  </p>
                  <Link
                    className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-border-subtle bg-surface-muted px-4 text-center text-sm font-extrabold text-text-primary transition hover:border-brand-orange/40 hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                    href={`/signup?next=${encodeURIComponent(nextPath)}`}
                  >
                    Create a ReyLUMI account
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
