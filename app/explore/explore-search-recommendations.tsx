"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function ExploreSearchRecommendations({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-4 pt-5" aria-label="Search recommendations" data-testid="explore-search-recommendations">
      <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

export function ExploreSearchOnwardActions({ href, label, onChooseArea }: {
  href: string;
  label: string;
  onChooseArea?: () => void;
}) {
  return <div className="flex flex-wrap justify-center gap-2 py-3">
    <Link prefetch={false} href={href} className="rounded-full bg-brand-teal-soft px-5 py-3 text-sm font-semibold text-brand-teal">{label}</Link>
    {onChooseArea ? <button type="button" onClick={onChooseArea} className="min-h-11 rounded-full bg-surface-muted px-5 py-3 text-sm font-semibold text-text-primary">Choose another area</button> : null}
  </div>;
}
