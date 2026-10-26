"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ExploreViewportImage as Image } from "./explore-viewport-image";
import { LumiAiWatermark } from "@/components/nail-illustration-credit";
import { exploreServiceGuides, type ExploreEditorialReference } from "@/lib/explore-editorial";

export function ExploreEditorialHeading({ eyebrow, title, description, action }: {
  eyebrow: string; title: string; description: string; action?: ReactNode;
}) {
  return <header className="flex flex-wrap items-end justify-between gap-5">
    <div className="max-w-2xl">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-orange">{eyebrow}</p>
      <h2 className="text-3xl font-semibold tracking-tight text-text-primary">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p>
    </div>
    {action}
  </header>;
}

export function ExploreEditorialReferenceCard({ reference }: { reference: ExploreEditorialReference }) {
  return <article className="flex min-w-0 flex-col overflow-hidden border-b border-divider-subtle bg-white" data-editorial-reference={reference.kind}>
    <Link prefetch={false} href={reference.href} className="group flex h-full flex-col focus-visible:outline-2 focus-visible:outline-brand-orange">
      <div className="relative aspect-[4/3] overflow-hidden bg-[linear-gradient(135deg,#fff0e8,#e7f7f5)]">
        {reference.imageUrl ? <Image src={reference.imageUrl} alt={reference.kind === "inspiration" ? `${reference.title} — AI nail inspiration` : `${reference.title} — AI service illustration`} fill sizes="(min-width: 1280px) 30vw, 90vw" className="object-cover transition duration-500 group-hover:scale-[1.025]" /> : null}
        {reference.imageUrl ? <LumiAiWatermark className="absolute bottom-3 right-3" /> : <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1 text-[10px] font-semibold text-text-secondary">Service guide</span>}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-semibold text-text-primary">{reference.title}</h3>
        <p className="mt-1 text-sm leading-6 text-text-secondary first-letter:uppercase">{reference.description}</p>
        {reference.kind === "inspiration" ? <p className="mt-2 text-xs leading-5 text-text-muted">An idea to discuss with your artist. Not a salon’s work.</p> : null}
        <span className="mt-auto pt-4 text-sm font-semibold text-brand-orange">{reference.kind === "inspiration" ? "Explore this style" : "Explore services"} <span aria-hidden>↗</span></span>
      </div>
    </Link>
  </article>;
}

export function ExploreServiceGuides({ category, location }: { category: string; location: string }) {
  return <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" data-testid="explore-service-guides">
    {exploreServiceGuides(category, location).map(reference => <ExploreEditorialReferenceCard key={reference.id} reference={reference} />)}
  </div>;
}
