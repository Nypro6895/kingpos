"use client";

import { useEffect, useRef } from "react";
import { resetExperienceCaches } from "@/lib/reset-experience-cache";
import { subscribeExperienceResets } from "@/lib/experience-cache-events";

const IDENTITY_KEY = "reylumi:experience-identity:v1";

export function ExperienceCacheLifecycle({ viewerId, workspace, permissionRevision = "", scope }: { viewerId: string | null; workspace: string; permissionRevision?: string; scope?: string }) {
  const lastIdentity = useRef<string | null>(null);
  useEffect(() => subscribeExperienceResets(reason => {
    resetExperienceCaches({ reason, suspend: true, broadcast: false });
  }), []);
  useEffect(() => {
    const current = JSON.stringify({ viewerId, workspace, permissionRevision, scope });
    let raw = lastIdentity.current;
    try {
      raw ??= window.sessionStorage.getItem(IDENTITY_KEY);
      window.sessionStorage.setItem(IDENTITY_KEY, current);
    } catch { /* The in-memory identity still protects storage-disabled sessions. */ }
    lastIdentity.current = current;
    if (raw && raw !== current) {
      try {
        const previous = JSON.parse(raw) as { viewerId?: string | null; workspace?: string; scope?: string };
        const reason = previous.viewerId !== viewerId ? "identity" : previous.workspace !== workspace ? "workspace" : "permissions";
        // New children have already been validated by the server. Retire only
        // the former resource scope and preserve their fresh seeds and writers.
        resetExperienceCaches({ reason, scope: previous.scope ?? "__legacy_experience_scope__", notify: false,
          bookingDrafts: previous.viewerId !== viewerId, preserveBookingHandoff: true, broadcast: true });
      } catch { resetExperienceCaches({ scope: "__legacy_experience_scope__", notify: false, bookingDrafts: false }); }
    }
    // Fresh context validation in the provider owns resume; cached props do not.
  }, [viewerId, workspace, permissionRevision, scope]);
  return null;
}
