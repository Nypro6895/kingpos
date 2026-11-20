import Image from "next/image";
import type { ReactNode } from "react";

/** Shared identity only: appointments and private library never enter this component. */
export function BeautyProfileHeader({ profile, actions, footer }: {
  profile: { displayName: string; avatarUrl: string | null; coverImageUrl: string | null; bio: string | null; visibility: "public" | "self" };
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const initials = profile.displayName.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("");
  return <section className="overflow-hidden rounded-2xl border border-divider-subtle bg-surface" data-beauty-profile-header>
    <div className="relative h-32 bg-gradient-to-r from-brand-orange-soft to-brand-teal-soft sm:h-44">
      {profile.coverImageUrl ? <Image alt={profile.displayName + " Beauty cover"} src={profile.coverImageUrl} fill sizes="(max-width: 768px) 100vw, 768px" className="object-cover" priority /> : null}
      {actions ? <div className="absolute right-3 top-3 flex gap-2">{actions}</div> : null}
    </div>
    <div className="relative -mt-8 flex min-w-0 items-start gap-3 px-4 pb-4 sm:gap-4 sm:px-5">
      <span className="relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-surface bg-brand-orange-soft text-xl font-semibold text-brand-orange sm:size-24">
        {profile.avatarUrl ? <Image alt={profile.displayName + " profile"} src={profile.avatarUrl} fill sizes="96px" className="object-cover" /> : initials || "R"}
      </span>
      <div className="min-w-0 flex-1 pt-10">
        <h1 className="break-words text-xl font-semibold text-text-primary sm:text-2xl">{profile.displayName}</h1>
        {profile.bio ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text-secondary">{profile.bio}</p> : null}
        <p className="mt-1 text-xs text-text-muted">{profile.visibility === "public" ? "Public profile" : "Private profile"}</p>
      </div>
    </div>
    {footer ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider-subtle px-4 py-3">{footer}</div> : null}
  </section>;
}
