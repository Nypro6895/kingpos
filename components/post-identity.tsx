"use client";
import { SalonName } from "@/components/salon-member-badge";

import Link from "next/link";
import { WorkspaceText } from "@/components/workspace-language";
import { resolvePostIdentity, type PostIdentityInput } from "@/lib/post-identity";
export function PostIdentity(props: PostIdentityInput) {
  const identity = resolvePostIdentity(props);
  const name = (text: string, href?: string | null) => href ? <Link prefetch={false} className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-brand-orange" href={href}>{text}</Link> : <span>{text}</span>;
  const nameWithMember = (text: string, href?: string | null) => nameNode(<SalonName name={text} href={href}/>, href);
  function nameNode(node: React.ReactNode, href?: string | null) { return href ? <Link prefetch={false} className="min-w-0" href={href}>{node}</Link> : node; }
  return <span data-post-identity className="grid min-w-0 gap-0.5">
    <span data-post-primary className="truncate font-semibold">{identity.salonPrimary ? nameWithMember(identity.primaryName, identity.primaryHref) : name(identity.primaryName, identity.primaryHref)}</span>
    {identity.secondaryName ? <span data-post-secondary className="truncate text-xs font-normal text-text-secondary"><WorkspaceText text={identity.secondaryLabel} /> {!identity.salonPrimary ? nameWithMember(identity.secondaryName, identity.secondaryHref) : name(identity.secondaryName, identity.secondaryHref)}</span> : null}
  </span>;
}
