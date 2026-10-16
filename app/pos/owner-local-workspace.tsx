"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAppLocalHost, type AppLocalRead } from "@/lib/app-local-host";
import { seedAppLocalResource, useAppLocalResource } from "@/lib/app-local-resource";
import { writeExperienceSnapshot } from "@/lib/experience-persistent-cache";
import type { OwnerLocalPanelData, OwnerWorkspaceReference } from "@/lib/owner-local-workspace";
import type { PortableCheckInData } from "@/app/pos/portable/actions";
import type { PosDeskStaff } from "@/types/pos-desk";
import { portableBusinessDate } from "@/lib/portable-business-day";

type Value = {
  scope: string; ownerScope: string; salonId: string;
  reference?: OwnerWorkspaceReference;
  businessDate: string;
  seedReference(data: OwnerWorkspaceReference, updatedAt: number): void;
  updateReference(patch: Partial<OwnerWorkspaceReference>): void;
  attendance(data: PortableCheckInData, pending: boolean): void;
};
const Context = createContext<Value | null>(null);
const args = { query: "" };

/** Uses the existing lease-scoped database; native supplies the same cache contract. */
export async function saveOwnerLocalSnapshot(scope: string, name: string, query: Record<string, unknown>, snapshot: AppLocalRead<OwnerLocalPanelData>) {
  if (snapshot.status !== 200 || !snapshot.data || snapshot.scope !== scope) return;
  const host = getAppLocalHost();
  // Native persists only its own authenticated read responses, never JS input.
  if (!host.isNative) await writeExperienceSnapshot({ scope, domain: name.replaceAll(".", "-"), params: query, data: snapshot.data, revision: snapshot.etag, updatedAt: snapshot.updatedAt });
}

export function OwnerLocalWorkspace({ scope, ownerScope, salonId, children, active=true }: { scope: string; ownerScope: string; salonId: string; children: ReactNode; active?: boolean }) {
  const [seeded, setSeeded] = useState(false);
  const [attendance, setAttendance] = useState<PortableCheckInData | null>(null);
  const resource = useAppLocalResource<OwnerLocalPanelData>(scope, "owner.workspace", args, { enabled: active && (seeded || getAppLocalHost().isNative) });
  const reference = resource.data?.view === "workspace" && resource.data.props.ownerScope === ownerScope && resource.data.props.salonId === salonId ? resource.data.props : undefined;
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now()); tick();
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener("reylumi:foreground", tick); window.addEventListener("focus", tick);
    return () => { window.clearInterval(timer); window.removeEventListener("reylumi:foreground", tick); window.removeEventListener("focus", tick); };
  }, []);
  const businessDate = reference && now ? portableBusinessDate(reference.timezone, now) : reference?.today ?? "";
  const latest = useRef(reference);
  useLayoutEffect(() => { latest.current = reference; }, [reference]);
  const seedReference = useCallback((data: OwnerWorkspaceReference, updatedAt: number) => {
    if (data.ownerScope !== ownerScope || data.salonId !== salonId) return;
    latest.current = data;
    const snapshot: AppLocalRead<OwnerLocalPanelData> = { schemaVersion: 1, status: 200, scope, etag: "", updatedAt, data: { view: "workspace", props: data } };
    seedAppLocalResource(scope, "owner.workspace", args, snapshot); setSeeded(true);
    void saveOwnerLocalSnapshot(scope, "owner.workspace", args, snapshot);
  }, [scope, ownerScope, salonId]);
  const updateReference = useCallback((patch: Partial<OwnerWorkspaceReference>) => {
    if (latest.current) seedReference({ ...latest.current, ...patch }, Date.now());
  }, [seedReference]);
  const attendanceSignature = useRef("");
  const receiveAttendance = useCallback((data: PortableCheckInData, pending: boolean) => {
    if (data.salonId !== salonId) return;
    const signature = JSON.stringify([data, pending]); if (attendanceSignature.current === signature) return;
    attendanceSignature.current = signature; setAttendance(data);
    // Optimistic attendance is an in-memory overlay only. The normal scoped
    // read will persist the server-confirmed version after its broadcast.
  }, [salonId]);
  const merged = useMemo(() => {
    if (reference && businessDate && reference.today !== businessDate) return { ...reference, today: businessDate, staff: reference.defaults.staffCheckInEnabled ? [] : reference.staff.map(row => ({ ...row, today_status: "not_checked_in" as const, check_in_at: null, check_in_sequence: null, turns: { queueTurns: 0, largeTurns: 0, smallTurns: 0, totalTurns: 0, receiptLargeTurns: 0 } })) };
    if (!reference || !attendance || reference.today !== attendance.today) return reference;
    const byId = new Map(reference.staff.map(row => [row.id, row]));
    for (const row of attendance.staff) {
      const prior = byId.get(row.id);
      byId.set(row.id, { ...(prior ?? { id: row.id, display_name: row.displayName, job_title: row.jobTitle, is_active: true, avatar_url: row.avatarUrl, turns: { queueTurns: row.queueTurnCount, largeTurns: row.queueTurnCount, smallTurns: 0, totalTurns: row.queueTurnCount, receiptLargeTurns: 0 } }), today_status: row.status as PosDeskStaff["today_status"], check_in_at: row.checkInAt, check_in_sequence: row.checkInSequence });
    }
    return { ...reference, staff: [...byId.values()].filter(row => !reference.defaults.staffCheckInEnabled || row.today_status === "working") };
  }, [reference, attendance, businessDate]);
  const value = useMemo(() => ({ scope, ownerScope, salonId, businessDate, reference: merged, seedReference, updateReference, attendance: receiveAttendance }), [scope, ownerScope, salonId, businessDate, merged, seedReference, updateReference, receiveAttendance]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useOwnerLocalWorkspace() { return useContext(Context); }
export function OwnerReferenceSeed({ data, updatedAt }: { data: OwnerWorkspaceReference; updatedAt: number }) {
  const workspace = useOwnerLocalWorkspace(), seed = workspace?.seedReference;
  useLayoutEffect(() => { seed?.(data, updatedAt); }, [seed, data, updatedAt]);
  return null;
}
