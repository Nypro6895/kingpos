"use client";
import { EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT, getExperienceOfflineGrant, isExperienceScopeOnlineValidated } from "./experience-persistent-cache";
import type { LiveResourceSnapshot } from "./experience-live-resource";
import { isTrustedStaffOfflineBinding } from "./staff-offline-binding";

type NativeSnapshot = { key: string; endpoint: string; payload: unknown; receivedAt: string };
type NativeSync = { register: (value: { scope: string; key: string; endpoint: string; expiresAt: string }) => unknown; drain: (scope: string) => unknown };
declare global { interface Window { __reylumiBackgroundSync?: NativeSync } }

/** Native background reads never supply patches or mutation results. */
export function parseExperienceNativeReadModel(value: unknown, receivedAt: string): LiveResourceSnapshot<object> | null {
  if (!value || typeof value !== "object" || !Number.isFinite(Date.parse(receivedAt)) || Date.parse(receivedAt) > Date.now() + 60_000 || Date.parse(receivedAt) < Date.now() - 86400000) return null;
  const result = value as Record<string, unknown>;
  if (result.partial !== false || typeof result.revision !== "string" || !/^[a-f0-9]{64}$/.test(result.revision) || typeof result.updatedAt !== "string" || !Number.isFinite(Date.parse(result.updatedAt)) || Date.parse(result.updatedAt) > Date.parse(receivedAt) + 60_000
    || !result.data || typeof result.data !== "object" || Array.isArray(result.data) || !result.sections || typeof result.sections !== "object" || Array.isArray(result.sections)
    || Object.values(result.sections).some(value => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))) return null;
  return { data: result.data, revision: result.revision, updatedAt: result.updatedAt, sections: result.sections as Record<string, string> };
}

export function subscribeExperienceNativeReadModel(options: { scope: string; key: string; endpoint: string; onSnapshot: (snapshot: LiveResourceSnapshot<object>, receivedAt: number) => void }): () => void {
  let active = true;
  const url = new URL(options.endpoint, location.origin);
  if (url.origin !== location.origin || !["/api/experience/today", "/api/experience/my-work"].includes(url.pathname)) return () => {};
  url.searchParams.delete("sections"); url.searchParams.set("scope", options.scope);
  const endpoint = url.pathname + url.search;
  const authorizedGrant = () => {
    const staffRead = url.pathname === "/api/experience/my-work", grant = getExperienceOfflineGrant(options.scope, staffRead ? "staff" : "base");
    if (!grant || !isExperienceScopeOnlineValidated(options.scope)) return null;
    if (staffRead) {
      const staffId = url.searchParams.get("staffId");
      return staffId && grant.viewerId && grant.salonId && isTrustedStaffOfflineBinding(grant.staffBinding, { staffId, viewerId: grant.viewerId, salonId: grant.salonId }) ? grant : null;
    }
    return grant.kind === "owner" ? grant : null;
  };
  const register = () => {
    const bridge = window.__reylumiBackgroundSync, grant = authorizedGrant();
    if (!active || !bridge || !grant) return;
    // A native context probe must match this exact resource scope. Staff fallback
    // scopes are deliberately skipped instead of broadening native authority.
    if (grant.scope !== options.scope) return;
    try { void Promise.resolve(bridge.register({ scope: options.scope, key: options.key, endpoint, expiresAt: new Date(grant.expiresAt).toISOString() })).then(() => { if (active && isExperienceScopeOnlineValidated(options.scope)) return bridge.drain(options.scope); }).catch(() => {}); } catch { /* Older native bridges cannot block the web view. */ }
  };
  const receive = (event: Event) => {
    if (!active || !authorizedGrant()) return;
    const detail = (event as CustomEvent<{ scope?: string; snapshots?: NativeSnapshot[] }>).detail;
    if (detail?.scope !== options.scope || !Array.isArray(detail.snapshots)) return;
    for (const row of detail.snapshots) {
      if (row.key !== options.key || row.endpoint !== endpoint) continue;
      const parsed = parseExperienceNativeReadModel(row.payload, row.receivedAt);
      if (parsed) options.onSnapshot(parsed, Date.parse(row.receivedAt));
    }
  };
  window.addEventListener("reylumi:native-snapshots", receive);
  window.addEventListener("reylumi:experience-online-authorized", register);
  window.addEventListener(EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT, register);
  register();
  return () => { active = false; window.removeEventListener("reylumi:native-snapshots", receive); window.removeEventListener("reylumi:experience-online-authorized", register); window.removeEventListener(EXPERIENCE_OFFLINE_AUTHORIZATION_EVENT, register); };
}
