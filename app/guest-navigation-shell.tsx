"use client";
import { handleExploreLogoClick } from "@/lib/explore-entry-navigation";
import { ExploreHeaderSearchSlot } from "@/app/explore/explore-header-search-slot";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { ExploreAdSlot } from "@/components/explore-advertising";
import advertisingStyles from "./guest-navigation-shell.module.css";

import { LegalFooter } from "@/components/legal-footer";
import { ExploreSearchInput } from "@/app/explore/explore-search-input";
import type { ExploreSearchSuggestion } from "@/lib/explore-search-suggestions";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import Image from "next/image";
import Link from "@/components/feedback-link";
import { NavigationForm, NavigationSubmitButton } from "@/components/navigation-form";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

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

function ReylumiLogo({ prefetch }: { prefetch?: boolean } = {}) {
  const __vt = useWorkspaceTranslation();

  return (
    <Link
      aria-label={__vt("Reylumi Explore")}
      className="inline-flex min-h-11 shrink-0 items-center rounded-full px-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href="/explore"
      onClick={handleExploreLogoClick}
      prefetch={prefetch}
    >
      <Image
        alt={__vt("Reylumi")}
        className="h-auto w-[7rem] max-w-[28vw] object-contain sm:w-[8.25rem]"
        fetchPriority="high"
        height={419}
        src="/brand/reylumi-logo-horizontal.png"
        width={1527}
      />
    </Link>
  );
}

export function GuestNavigationShell({ children, authenticated = false }: { children: ReactNode; authenticated?: boolean | null }) {
  const __vt = useWorkspaceTranslation();

  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [useCurrentLocation, setUseCurrentLocation] = useState(false);
  useEffect(() => {
    const receive = (event: Event) => setUseCurrentLocation(Boolean((event as CustomEvent<{ enabled?: boolean }>).detail.enabled));
    window.addEventListener("kingpos:explore-location-state", receive);
    window.dispatchEvent(new CustomEvent("kingpos:explore-request-location-state"));
    return () => window.removeEventListener("kingpos:explore-location-state", receive);
  }, []);

  if (
    pathname === "/login" ||
    pathname === "/signup" ||
    isGuestChromelessPath(pathname)
  ) {
    return <><ExploreAdSlot position="page-top" />{children}<ExploreAdSlot position="page-bottom" /></>;
  }

  const nextPath = sanitizeAuthReturnPath(
    currentReturnPath(pathname, new URLSearchParams(searchParams.toString())),
  );
  const exploreQuery =
    pathname === "/explore"
      ? searchParams.get("q") ?? ""
      : "";
  const isExploreBrowsePage =
    pathname === "/explore" || pathname.startsWith("/explore/");
  const isLoginPage = pathname === "/login";
  const isSignupPage = pathname === "/signup";
  function selectSuggestion(suggestion: ExploreSearchSuggestion) {
    const category = suggestion.kind === "service" ? suggestion.category : searchParams.get("category") ?? undefined;
    if (pathname === "/explore" && useCurrentLocation && suggestion.kind !== "area") {
      window.dispatchEvent(new CustomEvent("kingpos:explore-search-current-location", { detail: {
        query: suggestion.query, category, target: suggestion.target,
      } }));
      return;
    }
    const params = new URLSearchParams(pathname === "/explore" ? searchParams.toString() : "");
    for (const key of ["page", "cursor", "lat", "lng", "latitude", "longitude"]) params.delete(key);
    params.set("q", suggestion.kind === "area" ? "" : suggestion.query);
    params.set("type", suggestion.target);
    if (category) params.set("category", category);
    if (suggestion.kind === "area" && suggestion.location) {
      params.set("location", suggestion.location); params.set("scope", "fixed"); params.set("locationSource", "manual");
    }
    router.push(`/explore?${params}`);
  }

  return (
    <>
      <header
        className="sticky top-0 z-[60] border-b border-border-subtle bg-white/95 px-3 py-2 shadow-[0_8px_28px_rgba(35,25,22,0.045)] backdrop-blur sm:px-4"
        data-testid="guest-navigation-shell"
      >
        <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-2 sm:flex-row sm:items-center">
          <div className={`flex min-w-0 flex-1 items-center gap-2 sm:gap-3 ${pathname === "/explore" ? "justify-between" : ""}`}>
            <ReylumiLogo prefetch={isExploreBrowsePage ? false : undefined} />
            {pathname === "/explore" ? <ExploreHeaderSearchSlot /> : null}
            {pathname !== "/explore" ? <NavigationForm
              action="/explore"
              className="relative min-w-0 flex-1"
              method="get"
              role="search"
              onSubmit={(event) => {
                if (pathname !== "/explore" || !useCurrentLocation) return;
                event.preventDefault();
                const query = String(new FormData(event.currentTarget).get("q") ?? "");
                window.dispatchEvent(new CustomEvent("kingpos:explore-search-current-location", { detail: {
                  query, category: searchParams.get("category") ?? undefined,
                  target: searchParams.get("type") ?? "auto",
                } }));
              }}
            >
              {pathname === "/explore" ? ["location", "category", "type", "scope", "locationSource"].map(name =>
                searchParams.has(name) ? <input key={name} type="hidden" name={name} value={searchParams.get(name) ?? ""} /> : null,
              ) : null}
              <label className="sr-only" htmlFor="guest-global-search">
                <WorkspaceText text="Search salons, services, or locations" />
              </label>
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary sm:left-4">
                <SearchIcon />
              </span>
              <ExploreSearchInput
                className="h-11 w-full rounded-full border border-border-subtle bg-surface pl-10 pr-3 text-sm font-medium text-text-primary outline-none transition placeholder:font-normal placeholder:text-text-secondary/80 focus:border-brand-orange/50 focus:ring-4 focus:ring-brand-orange/15 sm:pr-24"
                defaultValue={exploreQuery}
                id="guest-global-search"
                key={exploreQuery}
                name="q"
                category={searchParams.get("category") ?? undefined}
                location={searchParams.get("location") ?? undefined}
                onSuggestionSelect={selectSuggestion}
                placeholder={__vt("Search salons, cities, or nail ideas")}
              />
              <NavigationSubmitButton
                className="absolute right-1.5 top-1/2 hidden min-h-8 -translate-y-1/2 items-center justify-center rounded-full bg-brand-black px-4 text-xs font-semibold text-white transition hover:bg-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:inline-flex"
                pendingLabel="Searching…"
                type="submit"
              >
                <WorkspaceText text="Search" />
              </NavigationSubmitButton>
            </NavigationForm> : null}
            {isExploreBrowsePage && authenticated === false ? (
              <Link
                className="inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-brand-orange px-3 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:px-5"
                href={`/login?next=${encodeURIComponent(nextPath)}`}
                prefetch={false}
              >
                <WorkspaceText text="Login" />
              </Link>
            ) : null}
          </div>
          {authenticated === true ? (
            <Link
              className="inline-flex min-h-11 shrink-0 items-center justify-center self-end rounded-full border border-border-subtle bg-white px-4 text-sm font-semibold text-text-primary transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:self-auto"
              href="/account"
            >
              <WorkspaceText text="My account" />
            </Link>
          ) : null}
          {!isExploreBrowsePage && authenticated === false ? (
            <div className="flex shrink-0 items-center justify-end gap-2 lg:self-auto">
              {!isLoginPage ? (
                <Link
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-border-subtle bg-white px-4 text-sm font-semibold text-text-primary transition hover:border-brand-orange/40 hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                  href={`/login?next=${encodeURIComponent(nextPath)}`}
                >
                  <WorkspaceText text="Login" />
                </Link>
              ) : null}
              {!isSignupPage ? (
                <Link
                  className="inline-flex min-h-10 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                  href={`/signup?next=${encodeURIComponent(nextPath)}`}
                >
                  <WorkspaceText text="Create account" />
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
      {isExploreBrowsePage ? <div className={advertisingStyles.sidebar}><nav className="mb-3 grid gap-2 rounded-2xl bg-orange-50 p-4 text-sm font-semibold"><Link href="/explore" prefetch={false}><WorkspaceText text="Explore" /></Link><Link href="/explore/favorites" prefetch={false}><WorkspaceText text="Your favorites ♡" /></Link></nav><ExploreAdSlot desktop /></div> : null}
      <div className={isExploreBrowsePage ? advertisingStyles.content : undefined}><ExploreAdSlot position="page-top" />{children}<ExploreAdSlot position="page-bottom" /></div>
      <LegalFooter />
    </>
  );
}
