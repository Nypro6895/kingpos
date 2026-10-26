"use client";
import Link from "next/link";
import { WorkspaceText } from "@/components/workspace-language";
import { resolvePostIdentity, type PostIdentityInput } from "@/lib/post-identity";
export function PostIdentity(props: PostIdentityInput) {
  const identity = resolvePostIdentity(props);
  const name = (text: string, href?: string | null) => href ? <Link prefetch={false} className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-brand-orange" href={href}>{text}</Link> : <span>{text}</span>;
  return <span data-post-identity className="grid min-w-0 gap-0.5">
    <span data-post-primary className="truncate font-semibold">{name(identity.primaryName, identity.primaryHref)}</span>
    {identity.secondaryName ? <span data-post-secondary className="truncate text-xs font-normal text-text-secondary"><WorkspaceText text={identity.secondaryLabel} /> {name(identity.secondaryName, identity.secondaryHref)}</span> : null}
  </span>;
}
