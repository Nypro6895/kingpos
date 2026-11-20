"use client";
export type BadgeReference = { kind: "display" | "entry" | "visit" | "invitation" | "claim"; value: string };
export type BadgeLookup = { salonId: string | null; reference?: BadgeReference; scope: string };
type Entry = { lookup: BadgeLookup; active: boolean; until: number; checked: number; listeners: Set<() => void> };
const entries = new Map<string, Entry>(), pending = new Set<string>(), inflight = new Set<string>(), controllers = new Set<AbortController>();
let generation = 0, scheduled = false, interval: ReturnType<typeof setInterval> | undefined, expiry: ReturnType<typeof setTimeout> | undefined;
export function canonicalSalonId(value?: string | null) { return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null; }
export function salonIdFromHref(href?: string | null) { return canonicalSalonId(href?.match(/^\/(?:explore\/salons|book|admin\/locations)\/([0-9a-f-]{36})(?:[/?#]|$)/i)?.[1]); }
export function badgeLookupKey(lookup: BadgeLookup) { return lookup.salonId || lookup.reference ? JSON.stringify(lookup) : ""; }
const notify = (entry: Entry) => entry.listeners.forEach(fn => fn());
function scheduleExpiry() {
 clearTimeout(expiry);
 const due = Math.min(...[...entries.values()].filter(e => e.active).map(e => Math.min(e.until, e.checked + 30000)));
 if (Number.isFinite(due)) expiry = setTimeout(() => { for (const e of entries.values()) if (e.active && (e.until <= Date.now() || e.checked + 30000 <= Date.now())) { e.active = false; notify(e); } scheduleExpiry(); }, Math.min(2147483647, Math.max(1, due - Date.now() + 1)));
}
function refresh(force = false) {
 for (const [key, entry] of entries) if (force || Date.now() - entry.checked >= 15000) pending.add(key);
 if (!scheduled) { scheduled = true; queueMicrotask(flush); }
}
async function flush() {
 scheduled = false;
 const keys = [...pending].filter(key => entries.has(key) && !inflight.has(key)); pending.clear();
 const groups = new Map<string, string[]>();
 for (const key of keys) { const e = entries.get(key)!; const group = JSON.stringify([e.lookup.scope, e.lookup.reference]); groups.set(group, [...(groups.get(group) ?? []), key]); }
 const epoch = generation;
 await Promise.all([...groups.values()].flatMap(group => Array.from({length: Math.ceil(group.length / 100)}, (_, i) => group.slice(i * 100, i * 100 + 100))).map(async batch => {
  batch.forEach(key => inflight.add(key));
  const controller = new AbortController(); controllers.add(controller); const timeout = setTimeout(() => controller.abort(), 8000);
  let rows: Array<{salon_id: string; valid_until: string}> = [];
  try {
   const lookup = entries.get(batch[0])!.lookup;
   const response = await fetch("/api/membership/salon-badges", {method: "POST", credentials: "same-origin", cache: "no-store", headers: {"Content-Type": "application/json"}, signal: controller.signal, body: JSON.stringify({ids: [...new Set(batch.map(key => entries.get(key)?.lookup.salonId).filter(Boolean))], ...(lookup.reference ? {reference: lookup.reference} : {})})});
   const body = response.ok ? await response.json() : null;
   if (Array.isArray(body?.badges)) rows = body.badges.filter((r: {salon_id?: unknown; valid_until?: unknown}) => typeof r.salon_id === "string" && canonicalSalonId(r.salon_id) && typeof r.valid_until === "string");
  } catch { /* Hide unavailable evidence. No business-action replay. */ }
  finally { clearTimeout(timeout); controllers.delete(controller); if (epoch === generation) batch.forEach(key => inflight.delete(key)); }
  if (epoch !== generation) return;
  for (const key of batch) { const e = entries.get(key); if (!e) continue; const row = e.lookup.salonId ? rows.find(r => r.salon_id === e.lookup.salonId) : rows[0]; e.until = row ? Date.parse(row.valid_until) : 0; e.checked = Date.now(); e.active = e.until > e.checked; notify(e); }
  scheduleExpiry();
 }));
}
function reset() { generation++; controllers.forEach(c => c.abort()); controllers.clear(); inflight.clear(); pending.clear(); for (const e of entries.values()) { e.active = false; e.until = 0; e.checked = 0; notify(e); } clearTimeout(expiry); }
function restore() { reset(); if (document.visibilityState !== "hidden") refresh(true); }
function visibility() { if (document.visibilityState === "visible") restore(); }
function pageShow(event: PageTransitionEvent) { if (event.persisted) restore(); }
export function subscribeMemberBadge(key: string, lookup: BadgeLookup, listener: () => void) {
 if (!key) return () => {};
 let entry = entries.get(key); if (!entry) { entry = {lookup, active: false, until: 0, checked: 0, listeners: new Set()}; entries.set(key, entry); } entry.listeners.add(listener);
 if (!interval) { interval = setInterval(() => { if (document.visibilityState !== "hidden") refresh(); }, 15000); window.addEventListener("focus", restore); window.addEventListener("pageshow", pageShow); document.addEventListener("visibilitychange", visibility); window.addEventListener("reylumi:experience-reset", reset); }
 refresh();
 return () => { const e = entries.get(key); e?.listeners.delete(listener); if (!e?.listeners.size) entries.delete(key); if (!entries.size) { clearInterval(interval); interval = undefined; clearTimeout(expiry); window.removeEventListener("focus", restore); window.removeEventListener("pageshow", pageShow); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("reylumi:experience-reset", reset); reset(); } };
}
export function memberBadgeSnapshot(key: string) { return entries.get(key)?.active ?? false; }
