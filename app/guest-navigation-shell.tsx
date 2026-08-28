"use client";

import { LegalFooter } from "@/components/legal-footer";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

const GUEST_CHROMELESS_PREFIXES = [
  "/pos/customer-display",
  "/pos/portable",
] as const;

function matchesPath(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isGuestChromelessPath(pathname: string) {
  return GUEST_CHROMELESS_PREFIXES.some((prefix) =>
    matchesPath(pathname, prefix),
  );
}

function currentReturnPath(pathname: string, searchParams: URLSearchParams) {
  const query = searchParams.toString();

  return query ? `${pathname}?${query}` : pathname;
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ReylumiLogo() {
  return (
    <Link
      aria-label="Reylumi Explore"
      className="inline-flex min-h-11 shrink-0 items-center rounded-full px-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href="/explore"
    >
      <Image
        alt="Reylumi"
        className="h-auto w-[7rem] max-w-[28vw] object-contain sm:w-[8.25rem]"
        fetchPriority="high"
        height={419}
        src="/brand/reylumi-logo-horizontal.png"
        width={1527}
      />
    </Link>
  );
}

export function GuestNavigationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (
    pathname === "/login" ||
    pathname === "/signup" ||
    isGuestChromelessPath(pathname)
  ) {
    return <>{children}</>;
  }

  const nextPath = sanitizeAuthReturnPath(
    currentReturnPath(pathname, new URLSearchParams(searchParams.toString())),
  );
  const exploreQuery =
    pathname === "/explore"
      ? searchParams.get("q") ?? searchParams.get("location") ?? ""
      : "";
  const isLoginPage = pathname === "/login";
  const isSignupPage = pathname === "/signup";

  return (
    <>
      <header
        className="sticky top-0 z-[60] border-b border-border-subtle bg-white/95 px-3 py-2 shadow-[0_8px_28px_rgba(35,25,22,0.045)] backdrop-blur sm:px-4"
        data-testid="guest-navigation-shell"
      >
        <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <ReylumiLogo />
            <form
              action="/explore"
              className="relative min-w-0 flex-1"
              method="get"
              role="search"
            >
              <label className="sr-only" htmlFor="guest-global-search">
                Search salons, services, or locations
              </label>
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary sm:left-4">
                <SearchIcon />
              </span>
              <input
                className="h-11 w-full rounded-full border border-border-subtle bg-surface pl-10 pr-3 text-sm font-medium text-text-primary outline-none transition placeholder:font-normal placeholder:text-text-secondary/80 focus:border-brand-orange/50 focus:ring-4 focus:ring-brand-orange/15 sm:pr-24"
                defaultValue={exploreQuery}
                id="guest-global-search"
                key={exploreQuery}
                name="q"
                placeholder="Search salons, services, city, or ZIP"
                type="search"
              />
              <button
                className="absolute right-1.5 top-1/2 hidden min-h-8 -translate-y-1/2 items-center justify-center rounded-full bg-brand-black px-4 text-xs font-semibold text-white transition hover:bg-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:inline-flex"
                type="submit"
              >
                Search
              </button>
            </form>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 lg:self-auto">
            {!isLoginPage ? (
              <Link
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-border-subtle bg-white px-4 text-sm font-semibold text-text-primary transition hover:border-brand-orange/40 hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={`/login?next=${encodeURIComponent(nextPath)}`}
              >
                Login
              </Link>
            ) : null}
            {!isSignupPage ? (
              <Link
                className="inline-flex min-h-10 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={`/signup?next=${encodeURIComponent(nextPath)}`}
              >
                Create account
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      {children}
      <LegalFooter />
    </>
  );
}
