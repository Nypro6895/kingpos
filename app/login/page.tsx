import { LoginForm } from "@/app/login/login-form";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

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
        height={419}
        src="/brand/reylumi-logo-horizontal.png"
        width={1527}
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
    <section className="relative hidden min-h-[calc(100dvh-4rem)] overflow-hidden rounded-[2rem] bg-[linear-gradient(145deg,#fff9f2_0%,#fff3eb_44%,#eef8f6_100%)] px-8 py-8 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.72)] lg:flex lg:flex-col xl:px-10">
      <div className="relative z-10 flex items-start justify-between gap-6">
        <BrandLogo />
        <p className="max-w-48 rounded-full border border-white/80 bg-white/70 px-4 py-2 text-right text-xs font-bold uppercase text-brand-teal shadow-sm">
          Beauty and personal services
        </p>
      </div>

      <div className="relative z-10 mt-14 max-w-2xl">
        <p className="text-sm font-extrabold uppercase text-brand-orange">
          ReyLUMI
        </p>
        <h1 className="mt-4 max-w-xl text-5xl font-semibold leading-[1.02] text-text-primary xl:text-[4.35rem]">
          Where beauty gets personal.
        </h1>
        <p className="mt-5 max-w-lg text-base leading-7 text-text-secondary xl:text-lg">
          Discover trusted places, keep your look history, and book the people
          who know your style.
        </p>
      </div>

      <div className="relative z-10 mt-auto h-[min(48vh,31rem)] min-h-[24rem]">
        <div className="absolute inset-x-0 bottom-0 top-8 overflow-hidden rounded-[1.75rem] border border-white/85 bg-white shadow-[0_28px_90px_rgba(35,25,22,0.12)]">
          <Image
            alt="Nail, hair, lash, and spa service details"
            className="object-cover"
            fetchPriority="high"
            fill
            sizes="(min-width: 1024px) 58vw, 100vw"
            src="/explore/service-defaults.png"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0)_42%,rgba(36,27,31,0.2)_100%)]" />
        </div>

        <AuthVisualCard className="absolute left-6 top-0 w-56">
          <p className="text-xs font-extrabold uppercase text-brand-orange">
            Beauty profile
          </p>
          <p className="mt-1 text-sm font-semibold leading-5">
            Save looks, notes, and favorite artists in one place.
          </p>
        </AuthVisualCard>

        <AuthVisualCard className="absolute bottom-8 right-5 w-64">
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

        <div className="absolute bottom-10 left-6 hidden flex-wrap gap-2 xl:flex">
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
    <div className="relative mt-5 overflow-hidden rounded-[1.35rem] border border-white bg-white shadow-[0_18px_48px_rgba(35,25,22,0.08)] lg:hidden">
      <div className="relative h-28">
        <Image
          alt="Beauty services and salon details"
          className="object-cover"
          fetchPriority="high"
          fill
          sizes="100vw"
          src="/explore/service-defaults.png"
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
    <main className="min-h-dvh overflow-x-hidden bg-[linear-gradient(135deg,#fffaf5_0%,#ffffff_48%,#eef8f6_100%)] text-text-primary">
      <div className="mx-auto grid min-h-dvh w-full max-w-[92rem] gap-8 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.28fr)_minmax(23rem,0.92fr)] lg:px-8 lg:py-8 xl:gap-12 xl:px-12">
        <BrandExperience />

        <section className="flex min-h-[calc(100dvh-2.5rem)] items-center justify-center lg:min-h-[calc(100dvh-4rem)]">
          <div className="w-full max-w-[28rem]">
            <div className="lg:hidden">
              <BrandLogo />
              <MobileBrandVisual />
            </div>

            <div className="mt-6 rounded-[1.5rem] border border-white/90 bg-white/94 p-5 shadow-[0_24px_80px_rgba(35,25,22,0.11)] backdrop-blur sm:p-7 lg:mt-0">
              <p className="hidden text-xs font-extrabold uppercase text-brand-orange lg:block">
                ReyLUMI account
              </p>
              <h2 className="text-3xl font-semibold tracking-normal text-text-primary">
                Welcome back
              </h2>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                Sign in to continue to ReyLUMI.
              </p>

              {message ? (
                <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                  {message}
                </p>
              ) : null}
              {error ? (
                <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                  {error}
                </p>
              ) : null}

              <LoginForm nextPath={nextPath} />

              <div className="mt-6 border-t border-divider-subtle pt-5">
                <p className="text-sm leading-6 text-text-secondary">
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
  );
}
