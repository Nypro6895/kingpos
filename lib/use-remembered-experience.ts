"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { readExperienceState, writeExperienceState, type ExperienceStateContext } from "./experience-state";

type RememberedExperience<T> = { value: T; scrollY: number };
const HISTORY_MARKER = "__reylumiExperienceEntry";
const DOCUMENT_MARKER = "__reylumiExperienceDocument";
const RESET_EVENTS = ["reylumi:experience-reset", "reylumi:app-local-reset", "reylumi:app-local-access-changed", "reylumi:experience-access-changed", "reylumi:offline-clear"];
// PerformanceNavigationTiming describes the document load, even after SPA
// navigation. A new document must skip old reload scroll; later Back entries
// from this document can still restore it.
const documentInstance = typeof window === "undefined" ? "" : `${Date.now()}:${Math.random().toString(36).slice(2)}`;

/** Restores small UI choices after hydration, while current server props remain authoritative. */
export function useRememberedExperience<T>(context: ExperienceStateContext, options: {
  value: T | (() => T);
  validate: (value: unknown) => value is T;
  onRestore: (value: T) => void;
  onEmpty?: () => void;
  enabled?: boolean;
  restoreScroll?: boolean;
  restoreOnVisit?: boolean;
}) {
  const { namespace, scope, key } = context;
  const marker = JSON.stringify([namespace, scope, key]);
  const latest = useRef({ marker, options });
  const persist = useRef<(() => void) | null>(null);
  const seeded = useRef<string | null>(null);
  const revoked = useRef<string | null>(null);
  const visit = useRef<{ marker: string; updateUrl: () => void } | null>(null);
  // A committed URL change with the same context keeps tracking. Outgoing
  // listeners must not capture the next route's reset before their cleanup.
  useLayoutEffect(() => { if (visit.current?.marker === marker) visit.current.updateUrl(); });
  // Commit fresh options before Activity cleans up passive effects. Keep their
  // identity so a scope change cannot save new account values into the old scope.
  useLayoutEffect(() => { latest.current = { marker, options }; persist.current?.(); }, [marker, options]);
  const enabled = options.enabled !== false;

  useEffect(() => {
    if (!enabled || revoked.current === marker) return;
    revoked.current = null;
    const currentContext = { namespace, scope, key };
    let currentOptions = latest.current.options;
    function getOptions() {
      if (latest.current.marker === marker) currentOptions = latest.current.options;
      return currentOptions;
    }
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const returning = window.history.state?.[HISTORY_MARKER] === marker
      && (navigation?.type !== "reload" || window.history.state?.[DOCUMENT_MARKER] === documentInstance);
    const currentDocumentEntry = window.history.state?.[DOCUMENT_MARKER] === documentInstance;
    try { window.history.replaceState({ ...window.history.state, [HISTORY_MARKER]: marker, [DOCUMENT_MARKER]: documentInstance }, ""); }
    catch { /* State restoration also works when history access is restricted. */ }
    let active = true;
    let ready = false;
    let interacted = false;
    let lastScrollY = window.scrollY;
    let currentUrl = window.location.pathname + window.location.search;
    const currentVisit = { marker, updateUrl() {
      const nextUrl = window.location.pathname + window.location.search;
      if (nextUrl !== currentUrl) { currentUrl = nextUrl; lastScrollY = window.scrollY; }
    } };
    visit.current = currentVisit;
    let writeTimer: number | undefined;
    let firstFrame: number | undefined;
    let secondFrame: number | undefined;

    function save() {
      if (!active || !ready && !interacted) return;
      const value = getOptions().value;
      writeExperienceState(currentContext, { value: typeof value === "function" ? (value as () => T)() : value, scrollY: lastScrollY });
    }
    function onInteraction() { interacted = true; seeded.current = marker; scheduleSave(); }
    function scheduleSave() {
      getOptions();
      if (!active || !ready && !interacted) return;
      if (writeTimer === undefined) writeTimer = window.setTimeout(() => { writeTimer = undefined; save(); }, 250);
    }
    function flush() {
      if (writeTimer !== undefined) window.clearTimeout(writeTimer);
      writeTimer = undefined;
      save();
    }
    function onScroll() {
      if (window.location.pathname + window.location.search !== currentUrl) return;
      lastScrollY = window.scrollY; scheduleSave();
    }
    function onVisibilityChange() { if (document.visibilityState === "hidden") flush(); }
    function reset() { active = false; revoked.current = marker; persist.current = null; }
    persist.current = scheduleSave;
    const restoreTimer = window.setTimeout(() => {
      if (!active) return;
      const restored = readExperienceState<RememberedExperience<T>>(currentContext, (entry): entry is RememberedExperience<T> => {
        if (!entry || typeof entry !== "object") return false;
        const candidate = entry as RememberedExperience<unknown>;
        return Number.isFinite(candidate.scrollY) && candidate.scrollY >= 0 && candidate.scrollY <= 10_000_000
          && getOptions().validate(candidate.value);
      });
      const hasHash = Boolean(window.location.hash);
      // Activity preserves React state but reruns effects. Only a true mount or
      // identity change seeds values; a reveal may still restore its scroll.
      if (seeded.current !== marker) {
        seeded.current = marker;
        if (!hasHash && !interacted) {
          if (restored) getOptions().onRestore(restored.value);
          else getOptions().onEmpty?.();
        }
      }
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (!active) return;
          const menuReturn = getOptions().restoreOnVisit === true && (navigation?.type !== "reload" || currentDocumentEntry);
          if (restored && (returning || menuReturn) && !hasHash && !interacted && getOptions().restoreScroll !== false) {
            window.scrollTo({ top: restored.scrollY, behavior: "instant" });
            lastScrollY = window.scrollY;
          }
          ready = true;
          persist.current = scheduleSave;
          save();
        });
      });
    }, 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    for (const event of RESET_EVENTS) window.addEventListener(event, reset);
    for (const event of ["pointerdown", "touchstart", "wheel", "keydown", "input", "change"]) window.addEventListener(event, onInteraction, { passive: true });
    return () => {
      flush();
      active = false;
      persist.current = null;
      if (visit.current === currentVisit) visit.current = null;
      window.clearTimeout(restoreTimer);
      if (writeTimer !== undefined) window.clearTimeout(writeTimer);
      if (firstFrame !== undefined) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const event of RESET_EVENTS) window.removeEventListener(event, reset);
      for (const event of ["pointerdown", "touchstart", "wheel", "keydown", "input", "change"]) window.removeEventListener(event, onInteraction);
    };
  }, [namespace, scope, key, enabled, marker]);
}
