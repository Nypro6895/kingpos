"use client";
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import { useExperienceScope } from "@/components/experience-scope";
import { badgeLookupKey, canonicalSalonId, memberBadgeSnapshot, salonIdFromHref, subscribeMemberBadge, type BadgeReference } from "@/lib/salon-member-store";
import s from "./salon-member-badge.module.css";
export { salonIdFromHref } from "@/lib/salon-member-store";
export const MEMBER_BADGE_LABEL = "Reylumi Member";
export const MEMBER_BADGE_DESCRIPTION = "Active Reylumi membership. Membership affiliation only; not identity verification or a service quality guarantee.";
const BadgeContext = createContext<{salonId?: string | null; reference?: BadgeReference}>({});
export function SalonIdentityContext({salonId, reference, children}: {salonId?: string | null; reference?: BadgeReference; children: ReactNode}) { return <BadgeContext.Provider value={{salonId, reference}}>{children}</BadgeContext.Provider>; }
export function MemberCheck({ className = "" }: { className?: string }) {
 return <span data-reylumi-member-badge role="img" aria-label={MEMBER_BADGE_LABEL} title={`${MEMBER_BADGE_LABEL} · ${MEMBER_BADGE_DESCRIPTION}`} className={`${s.mark} ${className}`}><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none"><path fill="currentColor" d="m12 1 3 2 3.6.4 1.4 3.3L23 9l-.7 3.5.7 3.5-3 2.3-1.4 3.3L15 22l-3 2-3-2-3.6-.4L4 18.3 1 16l.7-3.5L1 9l3-2.3 1.4-3.3L9 3z"/><path d="m7 12 3.2 3.2L17 8.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>;
}
const serverSnapshot = () => false;
/** Resolve canonical IDs and server-checked references; names cannot grant affiliation. */
export function SalonMemberBadge({salonId, href, currentSalon = false, reference}: {salonId?: string | null; href?: string | null; currentSalon?: boolean; reference?: BadgeReference}) {
 const experience = useExperienceScope(), inherited = useContext(BadgeContext);
 const id = canonicalSalonId(salonId) ?? salonIdFromHref(href) ?? canonicalSalonId(currentSalon ? experience?.context.salonId ?? inherited.salonId : inherited.salonId);
 const ref = reference ?? inherited.reference;
 const lookup = {salonId: id, scope: experience?.context.scope ?? "public", ...(ref ? {reference: ref} : {})}, key = badgeLookupKey(lookup);
 const subscribe = useCallback((listener: () => void) => subscribeMemberBadge(key, JSON.parse(key || "{}"), listener), [key]);
 const snapshot = useCallback(() => memberBadgeSnapshot(key), [key]);
 return useSyncExternalStore(subscribe, snapshot, serverSnapshot) ? <MemberCheck /> : null;
}
/** Keep the marker visible when a long salon name truncates. */
export function SalonName({name, ...props}: {name?: string | null; salonId?: string | null; href?: string | null; currentSalon?: boolean; reference?: BadgeReference}) {
 return <span data-salon-name className={s.name}><span title={name ?? undefined} className={s.text}>{name}</span>{name?.trim() ? <SalonMemberBadge {...props}/> : null}</span>;
}
