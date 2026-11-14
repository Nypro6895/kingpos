"use client";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { languageAction } from "@/app/settings/language-actions";
import { acceptLanguageSnapshot, effectiveLanguage, invitationCopy, languageInvitationsAllowed, offerAvailable, LANGUAGE_CATALOG, LANGUAGE_INFO, PERSONAL_LANGUAGE, type LanguageNotice, type SalonLanguageState } from "@/lib/salon-language";

import { PreferencesContext, useSalonLanguage } from "@/components/salon-language-context";

const ConfigurationContext = createContext<((initial: SalonLanguageState) => void) | null>(null);
export function SalonLanguageConfiguration({initial}:{initial:SalonLanguageState}) { const configure=useContext(ConfigurationContext); useEffect(()=>{configure?.(initial);},[configure,initial]); return null; }

export function SalonLanguagePreferences({ initial: incomingInitial, children }: { initial: SalonLanguageState; children: ReactNode }) {
  const [state, setState] = useState(incomingInitial), [busy, setBusy] = useState(false), [error, setError] = useState(incomingInitial.loadError ?? "");
  const [lastInitial, setLastInitial] = useState(incomingInitial);
  const [configured, configure] = useState<SalonLanguageState | null>(null);
  const initial = configured ?? incomingInitial;
  if (lastInitial !== initial) {
    setLastInitial(initial);
    if (state.salonId === null || acceptLanguageSnapshot(state, initial)) { setState(initial); setError(initial.loadError ?? ""); }
  }
  const [now, setNow] = useState(() => Date.now());
  const [popup, setPopup] = useState<LanguageNotice | null>(null);
  const shown = useRef(new Set<string>()), alive = useRef(false), changing = useRef(false);
  const revision = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter(), pathname = usePathname();
  const effective = effectiveLanguage(state.selected, state.offers, now, state.selectedActivation);
  const visiblePopup = popup && languageInvitationsAllowed(pathname) && offerAvailable(state, popup, now) && popup.code !== effective
    && !state.notices.some(n => n.code === popup.code && n.activation === popup.activation && n.accepted) ? popup : null;
  if (popup && !visiblePopup) setPopup(null);
  const previousLanguage = useRef(effective);
  useEffect(() => {
    if (previousLanguage.current === effective) return;
    previousLanguage.current = effective;
    router.refresh();
  }, [effective, router]);
  useEffect(() => {
    alive.current = true;
    let loading = false;
    async function refresh() {
      setNow(Date.now());
      if (!initial.salonId || document.visibilityState !== "visible" || !navigator.onLine || changing.current || loading) return;
      loading = true;
      const requestedRevision = revision.current;
      try {
        const result = await languageAction(initial.salonId, "load");
        if (alive.current && !changing.current && requestedRevision === revision.current) {
          if (result.accessDenied) { setState(current => ({ ...current, offers: [], notices: [] })); setError(result.error ?? "Refresh your workspace."); }
          else if (result.state) { setState(current => acceptLanguageSnapshot(current, result.state!) ? result.state! : current); setError(""); }
          else if (result.error) setError(result.error);
        }
      } catch { /* Keep the last verified preference on a transient network failure. */ }
      finally { loading = false; }
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 60_000);
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [initial.salonId]);
  async function choose(code: string, activation?: string) {
    if (!state.salonId || changing.current) return false;
    revision.current++; changing.current = true; setBusy(true); setError("");
    try {
      const result = await languageAction(state.salonId, "choose", code, activation ?? null);
      if (!alive.current) return false;
      if (!result.state) {
        if (result.accessDenied) setState(current => ({ ...current, offers: [], notices: [] }));
        setError(result.error ?? "Could not change language."); return false;
      }
      setState(result.state); setNow(Date.now()); setPopup(null); return true;
    } catch { if (alive.current) setError("Could not change language. Please try again."); return false; }
    finally { changing.current = false; if (alive.current) setBusy(false); }
  }
  async function seen(notice: LanguageNotice) {
    if (!state.salonId) return;
    const result = await languageAction(state.salonId, "seen", notice.code, notice.activation).catch(() => ({ error: "Could not save this notification. Please try again.", state: undefined }));
    // Never overwrite a newer choose response with an older acknowledgement.
    if (alive.current && !changing.current && result.state) setState(current => ({ ...current, notices: current.notices.map(n => n.activation === notice.activation && n.code === notice.code ? { ...n, seen: true } : n) }));
    if (alive.current && result.error) setError(result.error);
  }
  useEffect(() => {
    if (document.visibilityState !== "visible" || !state.salonId || popup || !languageInvitationsAllowed(pathname)) return;
    const next = state.notices.find(n => offerAvailable(state, n, now) && !n.seen && !n.accepted && n.code !== effective && !shown.current.has(n.activation + n.code));
    if (next) { shown.current.add(next.activation + next.code); setPopup(next); }
  }, [state, effective, pathname, popup, now]);
  useEffect(() => {
    if (!visiblePopup || !dialog.current) return;
    dialog.current.showModal();
    void seen(visiblePopup);
    // The popup stays open after the durable seen acknowledgement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePopup]);
  const copy = visiblePopup ? invitationCopy(visiblePopup.code, state.salonName) : null;
  return <ConfigurationContext.Provider value={configure}><PreferencesContext.Provider value={{ state, effective, busy, error, choose, seen }}>
    {children}
    {visiblePopup && copy && <dialog ref={dialog} aria-labelledby="language-invitation-title" onCancel={event => { event.preventDefault(); if (!busy) setPopup(null); }} className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl p-5 shadow-xl backdrop:bg-black/40">
      <div lang={visiblePopup.code}>
        <h2 id="language-invitation-title" className="text-lg font-semibold">{copy.title}</h2>
        <p className="mt-3 text-sm">{copy.question}</p>
        {copy.explanation && <p lang="en" className="mt-2 text-sm text-zinc-600">{copy.explanation}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void choose(visiblePopup.code, visiblePopup.activation)} className="min-h-11 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{copy.switch}</button>
          <button type="button" disabled={busy} onClick={() => setPopup(null)} className="min-h-11 rounded-lg border px-4 text-sm">{copy.later} / Later</button>
        </div>
        <p className="mt-3 text-xs text-zinc-600">{copy.hint}</p>
        {error && <p role="alert" lang="en" className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    </dialog>}
  </PreferencesContext.Provider></ConfigurationContext.Provider>;
}

export function LanguageSetting() {
  const preferences = useSalonLanguage();
  const state = preferences?.state ?? PERSONAL_LANGUAGE;
  const effective = preferences?.effective ?? "en";
  const [info, setInfo] = useState(false);
  const id = useId();
  return <section aria-label="Language" lang="en" className="min-w-0 rounded-lg border border-zinc-200 p-3">
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2">
      <label htmlFor={`${id}-choice`} className="text-sm font-semibold">Language</label>
    <select id={`${id}-choice`} value={effective} disabled={preferences?.busy} onChange={e => void preferences?.choose(e.target.value)} className="min-h-11 min-w-0 w-full rounded-md border bg-white px-2 text-sm">
      {LANGUAGE_CATALOG.map(language => <option key={language.code} value={language.code} disabled={language.code !== "en" && !state.offers.some(o => o.code === language.code && Date.parse(o.expiresAt) > Date.now())}>{language.name}</option>)}
    </select>
      <button type="button" aria-label="Language information" aria-expanded={info} aria-controls={`${id}-info`} onClick={() => setInfo(!info)} className="grid h-11 w-11 place-items-center rounded-full border text-sm font-semibold">i</button>
    </div>
    {info && <p id={`${id}-info`} className="mt-2 text-sm text-zinc-600">{LANGUAGE_INFO}</p>}
    {state.salonId && <p className="mt-2 text-xs text-zinc-500">{state.salonName} · Your choice applies to this salon.</p>}
    {state.selected !== effective && <p role="status" className="mt-2 text-sm text-zinc-600">Your selected language is no longer available or needs your confirmation after a package change. English is being used.</p>}
    {preferences?.error && <p role="alert" className="mt-2 text-sm text-red-700">{preferences.error}</p>}
  </section>;
}

export function LanguageNotifications({ unreadOnly = false }: { unreadOnly?: boolean }) {
  const preferences = useSalonLanguage();
  if (!preferences) return null;
  const { state, effective, busy, error, choose } = preferences;
  const notices = state.notices.filter(n => offerAvailable(state, n) && (!unreadOnly || !n.seen));
  if (!notices.length) return null;
  return <section aria-label="Language updates" className="border-b border-zinc-100 p-3">
    {notices.map(notice => {
      const copy = invitationCopy(notice.code, state.salonName);
      return <article key={notice.activation + notice.code} lang={notice.code} className="rounded-lg bg-blue-50 p-3 text-sm">
        <h2 className="font-semibold">{copy.title}</h2><p className="mt-1">{copy.question}</p>
        {copy.explanation && <p lang="en" className="mt-1 text-xs text-zinc-600">{copy.explanation}</p>}
        <button type="button" disabled={busy || effective === notice.code} onClick={() => void choose(notice.code, notice.activation)} className="mt-2 min-h-11 rounded-lg bg-blue-700 px-3 font-semibold text-white disabled:opacity-50">{effective === notice.code ? "✓ " : ""}{copy.switch}</button>
        <p className="mt-2 text-xs">{copy.hint}</p>
      </article>;
    })}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
