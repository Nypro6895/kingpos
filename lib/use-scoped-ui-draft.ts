"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { isExperienceSnapshotContextAuthorized, readExperienceSnapshot, removeExperienceSnapshot, writeExperienceSnapshot } from "@/lib/experience-persistent-cache";

type Options<T> = {
  scope: string | undefined;
  domain: string;
  params: unknown;
  value: T;
  dirty: boolean;
  enabled?: boolean;
  retainForMs?: number;
  validate: (value: unknown) => value is T;
  onRestore: (value: T) => void;
};
type Session<T> = { identity: string; active: boolean; stopped: boolean; loaded: boolean; changed: number; ownsDraft: boolean; latest: Options<T>; timer?: ReturnType<typeof setTimeout>; schedule?: () => void };

/** Only unsent fields are restored. Loading a draft never invokes its submit action. */
export function useScopedUiDraft<T>(options: Options<T>) {
  const { scope, domain, enabled = true } = options;
  const paramsKey = JSON.stringify(options.params);
  const identity = JSON.stringify([scope, domain, paramsKey]);
  const session = useRef<Session<T> | null>(null);

  useLayoutEffect(() => {
    if (session.current?.identity === identity) session.current.latest = options;
  });

  useLayoutEffect(() => {
    if (!scope || !enabled) return;
    const current: Session<T> = session.current?.identity === identity ? { ...session.current, active: true } : {
      identity, active: true, stopped: false, loaded: false, changed: 0, ownsDraft: false, latest: options,
    };
    session.current = current;
    const context = { scope, domain: `draft:${domain}`, params: JSON.parse(paramsKey) as unknown };
    const flush = () => {
      if (!current.active || current.stopped || !current.loaded || !isExperienceSnapshotContextAuthorized(context)) return;
      const latest = current.latest;
      if (latest.dirty && latest.validate(latest.value)) {
        current.ownsDraft = true;
        void writeExperienceSnapshot({ ...context, data: latest.value, retainForMs: latest.retainForMs ?? 2 * 60 * 60 * 1000 });
      } else if (current.ownsDraft) {
        current.ownsDraft = false;
        void removeExperienceSnapshot(context);
      }
    };
    const restore = async () => {
      if (current.loaded || current.stopped || !current.active || !isExperienceSnapshotContextAuthorized(context)) return;
      const changed = current.changed;
      const stored = await readExperienceSnapshot<unknown>(context);
      if (!current.active || current.stopped || !isExperienceSnapshotContextAuthorized(context)) return;
      current.loaded = true;
      if (changed === current.changed && !current.changed && stored && current.latest.validate(stored.data)) {
        current.ownsDraft = true;
        current.latest.onRestore(stored.data);
      } else flush();
    };
    const changed = () => { void restore(); };
    const background = () => { if (document.visibilityState === "hidden") flush(); };
    const reset = () => { current.stopped = true; if (current.timer) clearTimeout(current.timer); };
    window.addEventListener("reylumi:offline-authorization", changed);
    window.addEventListener("reylumi:experience-reset", reset);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", background);
    void restore();
    const tick = () => { current.timer = undefined; flush(); };
    // Save only after a committed render, never during render or restoration.
    const save = () => { if (current.timer) clearTimeout(current.timer); current.timer = setTimeout(tick, 200); };
    current.schedule = save;
    return () => {
      flush(); current.active = false;
      current.schedule = undefined;
      if (current.timer) clearTimeout(current.timer);
      window.removeEventListener("reylumi:offline-authorization", changed);
      window.removeEventListener("reylumi:experience-reset", reset);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", background);
    };
  // Each context owns its callbacks and outgoing cleanup, including account changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, scope, domain, enabled, paramsKey]);

  useLayoutEffect(() => { if (session.current?.identity === identity) session.current.schedule?.(); }, [identity, options.value, options.dirty]);
  const markEdited = useCallback(() => { if (session.current?.identity === identity) session.current.changed++; }, [identity]);
  return { markEdited };
}
