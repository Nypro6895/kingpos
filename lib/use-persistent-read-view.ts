"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { isExperienceSnapshotContextAuthorized, readExperienceSnapshot, writeExperienceSnapshot } from "@/lib/experience-persistent-cache";

/** Retain an existing live read view without changing its partial-update transport. */
export function usePersistentReadView<T>(options: {
  scope?: string; domain: string; params: unknown; data: T; updatedAt: number;
  validate: (value: unknown) => value is T;
  onRestore: (value: T, updatedAt: number) => void;
}) {
  const { scope, domain } = options;
  const paramsKey = JSON.stringify(options.params);
  const identity = JSON.stringify([scope, domain, paramsKey]);
  const latest = useRef({ identity, options });
  useLayoutEffect(() => { latest.current = { identity, options }; });
  useEffect(() => {
    if (!scope) return;
    let active = true;
    const context = { scope, domain, params: JSON.parse(paramsKey) as unknown };
    const sync = async () => {
      if (!active || !isExperienceSnapshotContextAuthorized(context)) return;
      const saved = await readExperienceSnapshot<unknown>(context);
      if (!active || latest.current.identity !== identity || !isExperienceSnapshotContextAuthorized(context)) return;
      const current = latest.current.options;
      if (saved && saved.updatedAt > current.updatedAt && current.validate(saved.data)) current.onRestore(saved.data, saved.updatedAt);
      else if (Number.isFinite(current.updatedAt) && current.updatedAt > 0 && current.validate(current.data)) {
        await writeExperienceSnapshot({ ...context, data: current.data, updatedAt: current.updatedAt, retainForMs: 24 * 60 * 60 * 1000 });
      }
    };
    const wake = () => { void sync(); };
    const reset = () => { active = false; };
    window.addEventListener("reylumi:offline-authorization", wake);
    window.addEventListener("reylumi:experience-reset", reset);
    void sync();
    return () => { active = false; window.removeEventListener("reylumi:offline-authorization", wake); window.removeEventListener("reylumi:experience-reset", reset); };
  }, [identity, scope, domain, paramsKey, options.data, options.updatedAt]);
}
