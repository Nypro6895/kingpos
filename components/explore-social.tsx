"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AuthIntentPrompt } from "@/components/auth-intent-prompt";
import { ReylumiIcon } from "@/components/reylumi-icons";
import { WorkspaceText } from "@/components/workspace-language";
import { ExploreBookButton } from "@/components/explore-account-actions";
import { PostActions } from "@/app/salon-profile/post-actions";
import { SavePostButton } from "@/app/saved-post/save-post-button";
import { setExploreSalonPreferenceAction } from "@/app/explore/social-actions";
import { EMPTY_SALON_SOCIAL, isSalonId, type ExploreSocialSalon, type SalonSocialField, type SalonSocialState } from "@/lib/explore-social";
import type { AccountSavedPostStateTarget } from "@/types/saved-post";
import type { PostCommentTarget } from "@/types/post-comments";
import styles from "./explore-social.module.css";

type SocialContext = { states: Record<string, SalonSocialState>; busy: Set<string>; register: (id: string) => void; change: (id: string, field: SalonSocialField, active: boolean) => Promise<void>; authenticated: boolean; viewerId: string | null };
const Context = createContext<SocialContext | null>(null);
export function ExploreSocialProvider({ viewerId, children }: { viewerId: string | null; children: ReactNode }) {
  return <SocialProvider key={viewerId ?? "guest"} viewerId={viewerId}>{children}</SocialProvider>;
}
function SocialProvider({ viewerId, children }: { viewerId: string | null; children: ReactNode }) {
  const [states, setStates] = useState<Record<string, SalonSocialState>>({});
  const [busy, setBusy] = useState(new Set<string>());
  const [message, setMessage] = useState("");
  const [undo, setUndo] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(false);
  const registered = useRef(new Set<string>()), pending = useRef(new Set<string>()), changed = useRef(new Set<string>()), locks = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), alive = useRef(true);
  const flush = useRef<() => void>(() => {});
  useEffect(() => {
    alive.current = true;
    const frame = !viewerId ? requestAnimationFrame(() => { try { const ids: unknown = JSON.parse(localStorage.getItem("reylumi-hidden-salons:guest") ?? "[]"); if (Array.isArray(ids)) setStates(Object.fromEntries(ids.filter(isSalonId).map(id => [id, { ...EMPTY_SALON_SOCIAL, hidden: true }]))); } catch {} }) : null;
    return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); if (frame !== null) cancelAnimationFrame(frame); };
  }, [viewerId]);
  const register = useCallback((id: string) => {
    if (!viewerId || !isSalonId(id) || registered.current.has(id)) return;
    registered.current.add(id); pending.current.add(id);
    if (!timer.current) timer.current = setTimeout(() => flush.current(), 30);
  }, [viewerId]);
  useEffect(() => {
    flush.current = () => {
      timer.current = null;
      const ids = [...pending.current].slice(0, 60); ids.forEach(id => pending.current.delete(id));
      if (!ids.length) return;
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      void fetch(`/api/explore/salon-social?ids=${ids.join(",")}`, { cache: "no-store", signal: controller.signal }).then(async response => {
        const result = await response.json(); if (!response.ok) throw Error(result.error);
        if (alive.current) setStates(current => ({ ...current, ...Object.fromEntries(Object.entries(result.states as Record<string, SalonSocialState>).filter(([id]) => !changed.current.has(id))) }));
      }).catch(() => { if (alive.current) { ids.forEach(id => registered.current.delete(id)); setMessage("Preferences could not be loaded. Try the action again."); } }).finally(() => clearTimeout(timeout));
      if (pending.current.size) timer.current = setTimeout(() => flush.current(), 30);
    };
  }, []);
  async function change(id: string, field: SalonSocialField, active: boolean) {
    if (!isSalonId(id) || locks.current.has(id)) return;
    if (!viewerId && field !== "hidden") { setPrompt(true); return; }
    if (viewerId && !states[id]) { registered.current.delete(id); register(id); setMessage("Preferences could not be loaded. Try the action again."); return; }
    locks.current.add(id); setBusy(new Set(locks.current)); setMessage("");
    try {
      if (viewerId) { const result = await setExploreSalonPreferenceAction(id, field, active); if (result.error) throw Error(result.error); }
      if (!alive.current) return;
      changed.current.add(id);
      setStates(current => {
        const next = { ...current, [id]: { ...(current[id] ?? EMPTY_SALON_SOCIAL), [field]: active } };
        if (!viewerId) { try { localStorage.setItem("reylumi-hidden-salons:guest", JSON.stringify(Object.keys(next).filter(key => next[key].hidden))); } catch {} }
        return next;
      });
      if (field === "hidden") { setUndo(active ? id : null); setMessage(active ? "Salon hidden from your Explore." : "Salon is visible again."); }
      if (field === "saved") setMessage(active ? "Salon saved to your favorites." : "Salon removed from saved places.");
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { locks.current.delete(id); if (alive.current) setBusy(new Set(locks.current)); }
  }
  return <Context.Provider value={{ states, busy, register, change, authenticated: Boolean(viewerId), viewerId }}>
    {children}
    {message ? <div role="status" className={styles.notice}><WorkspaceText text={message} />{undo ? <button type="button" onClick={() => void change(undo, "hidden", false)}><WorkspaceText text="Undo" /></button> : null}<button type="button" aria-label="Dismiss" onClick={() => setMessage("")}>×</button></div> : null}
    {prompt ? <AuthIntentPrompt kicker="Your salons" title="Keep your favorites together" onClose={() => setPrompt(false)}><WorkspaceText text="Sign in to love, follow or save this salon." /></AuthIntentPrompt> : null}
  </Context.Provider>;
}
export function useExploreSocial() {
  const context = useContext(Context);
  return { states: context?.states ?? {} };
}
export function useSalonSocial(id?: string) {
  const context = useContext(Context), register = context?.register;
  useEffect(() => { if (id) register?.(id); }, [id, register]);
  return { state: id ? context?.states[id] ?? EMPTY_SALON_SOCIAL : EMPTY_SALON_SOCIAL, busy: Boolean(id && context?.busy.has(id)), change: context?.change, authenticated: context?.authenticated ?? false, viewerId: context?.viewerId ?? null };
}
export function ExploreSalonFollow({ salon }: { salon: ExploreSocialSalon }) {
  const social = useSalonSocial(salon.id);
  if (!isSalonId(salon.id)) return null;
  return <button type="button" className={styles.follow} disabled={social.busy} aria-pressed={social.state.following} aria-label={`${social.state.following ? "Unfollow" : "Follow"} ${salon.name}`} onClick={() => void social.change?.(salon.id, "following", !social.state.following)}><WorkspaceText text={social.state.following ? "Following" : "Follow"} /></button>;
}
export function ExploreSalonMenu({ salon, target, onHidden }: { salon: ExploreSocialSalon; target?: PostCommentTarget; onHidden?: () => void }) {
  const social = useSalonSocial(salon.id), [message, setMessage] = useState("");
  const href = salon.href ?? `/explore/salons/${salon.id}`;
  const copy = async () => { try { await navigator.clipboard.writeText(new URL(href, window.location.origin).href); setMessage("Link copied."); } catch { setMessage("Could not copy the link. Please try again."); } };
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([salon.name, salon.address, salon.city, salon.state].filter(Boolean).join(", "))}`;
  return <><PostActions plain salon={salon} target={target} viewerId={social.viewerId} onHidden={onHidden} onChanged={() => window.location.reload()} extraActions={[
    ...(isSalonId(salon.id) ? [{ label: social.state.following ? "Unfollow salon" : "Follow salon", action: () => social.change?.(salon.id, "following", !social.state.following), icon: <ReylumiIcon name="user-plus" /> }] : []),
    ...(isSalonId(salon.id) ? [{ label: social.state.saved ? "Unsave salon" : "Save salon", action: () => social.change?.(salon.id, "saved", !social.state.saved), icon: <ReylumiIcon name="bookmark" /> }] : []),
    { label: "Copy profile link", action: copy, icon: <ReylumiIcon name="link" /> },
    { label: "Get directions", action: () => { window.open(directions, "_blank", "noopener,noreferrer"); }, icon: <ReylumiIcon name="map-pin" /> },
    ...(isSalonId(salon.id) ? [{ label: "Hide this salon", action: () => social.change?.(salon.id, "hidden", true), icon: <ReylumiIcon name="eye-off" /> }] : []),
  ]}/>{message ? <span role="status" className={styles.menuMessage} onClick={() => setMessage("")}><WorkspaceText text={message} /></span> : null}</>;
}
export function ExploreSocialActions({ salon, href, target, onComment, commentCount = 0 }: { salon?: ExploreSocialSalon | null; href: string; target?: AccountSavedPostStateTarget | null; onComment?: () => void; commentCount?: number }) {
  const social = useSalonSocial(salon?.id), [message, setMessage] = useState("");
  async function share() {
    const url = new URL(href, window.location.origin).href;
    try { if (navigator.share) await navigator.share({ title: salon?.name ?? "Reylumi", url }); else { await navigator.clipboard.writeText(url); setMessage("Link copied."); } }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setMessage("Could not share this link. Please try again."); }
  }
  return <><div className={styles.actions} data-social-actions>
    {target ? <SavePostButton target={target} initialSaved={target.saved} saveCount={target.saveCount} isAuthenticated={social.authenticated} size="toolbar" showTooltip={false} /> : salon ? <button type="button" aria-label={`Love ${salon.name}`} aria-pressed={social.state.loved} disabled={social.busy} onClick={() => void social.change?.(salon.id, "loved", !social.state.loved)}><ReylumiIcon name="heart" fill={social.state.loved ? "currentColor" : "none"}/><WorkspaceText text="Love" /></button> : null}
    {onComment ? <button type="button" aria-label="Comment" onClick={onComment}><ReylumiIcon name="message"/><WorkspaceText text="Comment" />{commentCount > 0 ? <span data-post-action-count className={styles.count}>{commentCount}</span> : null}</button> : <Link prefetch={false} href={`${salon?.href ?? href}#customer-experiences`} aria-label="Comment"><ReylumiIcon name="message"/><WorkspaceText text="Comment" /></Link>}
    <button type="button" onClick={() => void share()} aria-label="Share"><ReylumiIcon name="share"/><WorkspaceText text="Share" /></button>
    {salon ? <ExploreBookButton href={salon.bookingHref} name={salon.name} contactHref={salon.href ?? href} phoneHref={salon.phone ? `tel:${salon.phone}` : null} /> : null}
  </div>{message ? <p role="status" className={styles.feedback}><WorkspaceText text={message}/></p> : null}</>;
}
