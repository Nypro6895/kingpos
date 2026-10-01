"use client";
import { mergeStaffRoster } from "@/lib/portable-staff-roster";

import {
  createContext,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";

import { portableBusinessDate } from "@/lib/portable-business-day";
import { usePosResourceRefresh } from "@/lib/pos-workspace-sync";
import { DEFAULT_WORKSPACE_PREFERENCES, type PosWorkspacePreferences } from "@/lib/pos-workspace-preferences";
import type { PosDeskStaff } from "@/types/pos-desk";
import { listPortableOperations, PORTABLE_OPERATIONS_CHANGED } from "@/lib/portable-operations";

export type PortableAttendanceState = {
  leaveCohortStaffIds?: string[];
  leaveBaselineTurnCount?: number | null;
  checkInAt?: string | null;
  checkInSequence?: number | null;
  queueTurnCount?: number;
  status: string;
};

type PortableWorkspaceStateValue = {
  scope: string;
  businessDate: string;
  timezone: string;
  preparedDay: string;
  offlineEnabled: boolean;
  staffRoster: PosDeskStaff[];
  setStaffRoster: (staff: PosDeskStaff[]) => void;
  preferences: PosWorkspacePreferences;
  settings: Record<string,unknown> | null;
  attendanceByStaffId: Readonly<Record<string, PortableAttendanceState>>;
  setAttendance: (
    staffId: string,
    attendance: PortableAttendanceState | null,
  ) => void;
};

const PortableWorkspaceStateContext =
  createContext<PortableWorkspaceStateValue | null>(null);

export function PortableWorkspaceStateProvider({
  scope,
  offlineEnabled,
  preparedAt = 0,
  timezone = "America/Chicago",
  children,
}: {
  offlineEnabled: boolean;
  preparedAt?: number;
  timezone?: string;
  scope: string;
  children: ReactNode;
}) {
  const [locked, setLocked] = useState(false);
  const [unlockMessage, setUnlockMessage] = useState("");
  useEffect(() => {
    const lock = () => { if (!navigator.onLine) setLocked(true); };
    window.addEventListener("kingpos:portable-lock", lock);
    return () => window.removeEventListener("kingpos:portable-lock", lock);
  }, []);
  const [staffRoster, setStaffRoster] = useState<PosDeskStaff[]>([]);
  const seedStaffRoster=useCallback((rows:PosDeskStaff[])=>setStaffRoster(current=>current.length?current:rows),[]);
  const [snapshotAt, setSnapshotAt] = useState(preparedAt);
  const [staffAcknowledgedAt,setStaffAcknowledgedAt]=useState<Record<string,number>>({});
  const [committedByStaff,setCommittedByStaff]=useState<Record<string,string[]>>({});
  const [preferences,setPreferences]=useState(DEFAULT_WORKSPACE_PREFERENCES);
  const [settings,setSettings]=useState<Record<string,unknown>|null>(null);
  const salonId=scope.split(':')[0];
  usePosResourceRefresh(salonId,'staff',async(ids)=>{
    const started=Date.now();
    const response=await fetch('/api/pos/portable/workspace?resource=staff'+(ids?.length?'&ids='+encodeURIComponent(ids.join(',')):''),{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)return;const data=await response.json();
    if(data.today!==portableBusinessDate(timezone)||!Array.isArray(data.staff))return;
    setStaffRoster(current=>{
      const missing=current.filter(row=>(!ids?.length||ids.includes(row.id))&&!data.staff.some((next:PosDeskStaff)=>next.id===row.id)).map(row=>({...row,today_status:'not_checked_in' as const,check_in_at:null,check_in_sequence:null}));
      return mergeStaffRoster<PosDeskStaff>(current, [...data.staff, ...missing], ids);
    });
    setStaffAcknowledgedAt(current=>({...current,...Object.fromEntries((ids??data.staff.map((s:PosDeskStaff)=>s.id)).map((id:string)=>[id,started]))}));
    if(Array.isArray(data.acknowledgedOperationIds))setCommittedByStaff(current=>({...current,...Object.fromEntries((ids??data.staff.map((s:PosDeskStaff)=>s.id)).map((id:string)=>[id,data.acknowledgedOperationIds]))}));
    // Advance the acknowledgement boundary only for a complete snapshot.
    if(!ids?.length)setSnapshotAt(started);
  });
  usePosResourceRefresh(salonId,'settings',async()=>{
    const response=await fetch('/api/pos/portable/workspace?resource=settings',{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)return;const data=await response.json();if(data.preferences)setPreferences(data.preferences);if(data.settings)setSettings(data.settings);
  });
  const observedPending = useRef(new Set<string>());
  const replayedAttendance = useRef<Record<string, PortableAttendanceState>>({});
  const [businessDate, setBusinessDate] = useState("");
  useEffect(() => {
    const update = () => setBusinessDate(portableBusinessDate(timezone));
    update(); const timer = setInterval(update, 1000);
    window.addEventListener("focus", update); window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); window.removeEventListener("pageshow", update); document.removeEventListener("visibilitychange", update); };
  }, [timezone]);
  const [attendanceState, setAttendanceState] = useState<{day: string; rows: Record<string, PortableAttendanceState>}>({day: "", rows: {}});
  const attendanceByStaffId = useMemo(() => attendanceState.day === businessDate ? attendanceState.rows : {}, [attendanceState, businessDate]);
  useEffect(() => {
    if (!businessDate) return;
    let active = true;
    const refresh = () => { void listPortableOperations(scope).then(rows => {
      if (!active) return;
      const pending: Record<string, PortableAttendanceState> = {};
      for (const op of rows) {
        if (op.state === "cancelled") continue;
        if (portableBusinessDate(timezone, op.occurredAt) !== businessDate) continue;
        if (op.state === "synced") {
          if (observedPending.current.delete(op.id) && op.kind === "attendance" && op.result?.reconciled && typeof op.payload.staffId === "string")
            pending[op.payload.staffId] = op.result as PortableAttendanceState;
          if (Date.parse(op.syncedAt ?? op.occurredAt) <= snapshotAt) continue;
        }
        observedPending.current.add(op.id);
        if (op.kind === "receipt" && op.payload.staffAttendance) {
          if (op.state === "attention") continue;
          for (const [id, attendance] of Object.entries(op.payload.staffAttendance as Record<string, PortableAttendanceState>)) {
            if(committedByStaff[id]?.includes(op.id))continue;
            if(op.state==='synced'&&Date.parse(op.syncedAt??op.occurredAt)<=(staffAcknowledgedAt[id]??snapshotAt))continue;
            const member=staffRoster.find(row=>row.id===id);
            const baseline=pending[id]??(member?{status:member.today_status,checkInAt:member.check_in_at,checkInSequence:member.check_in_sequence,queueTurnCount:member.turns.queueTurns}:undefined);
            if(!baseline)continue;
            const delta=(op.payload.staffTurnDeltas as Record<string,number>|undefined)?.[id];
            pending[id]={...baseline,queueTurnCount:typeof delta==='number'?(baseline.queueTurnCount??0)+delta:Math.max(baseline.queueTurnCount??0,attendance.queueTurnCount??0)};
          }
          continue;
        }
        if (op.kind !== "attendance") continue;
        if(committedByStaff[String(op.payload.staffId)]?.includes(op.id))continue;
        if(op.state==='attention')continue;
        if(op.state==='synced'&&Date.parse(op.syncedAt??op.occurredAt)<=(staffAcknowledgedAt[String(op.payload.staffId)]??snapshotAt))continue;
        if (typeof op.payload.staffId === "string" && op.payload.attendance)
          pending[op.payload.staffId] = { ...op.payload.attendance as PortableAttendanceState,
            ...(op.state === "synced" && op.result?.status ? op.result as PortableAttendanceState : {}) };
      }
      const previousReplay = replayedAttendance.current;
      replayedAttendance.current = pending;
      setAttendanceState(current => {
        const retained = { ...(current.day === businessDate ? current.rows : {}) };
        for (const [id, prior] of Object.entries(previousReplay)) {
          if (JSON.stringify(retained[id]) === JSON.stringify(prior)) delete retained[id];
        }
        return { day: businessDate, rows: { ...retained, ...pending } };
      });
    }).catch(() => {}); };
    refresh();
    window.addEventListener(PORTABLE_OPERATIONS_CHANGED, refresh);
    return () => { active = false; window.removeEventListener(PORTABLE_OPERATIONS_CHANGED, refresh); };
  }, [scope, snapshotAt, staffAcknowledgedAt, committedByStaff, timezone, businessDate, staffRoster]);
  const setAttendance = useCallback(
    (staffId: string, attendance: PortableAttendanceState | null) => {
      const day = portableBusinessDate(timezone);
      setAttendanceState(previous => {
        const next = { ...(previous.day === day ? previous.rows : {}) };
        if (attendance) next[staffId] = attendance;
        else delete next[staffId];
        return { day, rows: next };
      });
    },
    [timezone],
  );
  const value = useMemo(
    () => ({ scope, businessDate, timezone, preparedDay: portableBusinessDate(timezone, preparedAt), offlineEnabled, staffRoster, setStaffRoster:seedStaffRoster, attendanceByStaffId, setAttendance, preferences, settings }),
    [scope, businessDate, timezone, preparedAt, offlineEnabled, staffRoster, seedStaffRoster, attendanceByStaffId, setAttendance, preferences, settings],
  );

  if (locked) return <section className="grid h-full place-items-center bg-zinc-100 p-6 text-center" role="dialog" aria-label="POS locked">
    <div className="rounded-xl border bg-white p-8 shadow-sm"><h1 className="text-xl font-semibold">POS locked</h1>
      <button type="button" className="mt-5 rounded-lg bg-zinc-950 px-6 py-3 font-semibold text-white" onClick={() => {
        if (navigator.onLine) window.location.reload(); else setUnlockMessage("Connect to sign in.");
      }}>Sign in</button>
      {unlockMessage ? <p className="mt-3 text-sm text-zinc-600">{unlockMessage}</p> : null}
    </div>
  </section>;

  return (
    <PortableWorkspaceStateContext.Provider value={value}>
      {children}
    </PortableWorkspaceStateContext.Provider>
  );
}

export function usePortableWorkspaceState() {
  return useContext(PortableWorkspaceStateContext);
}

export function mergePortableStaff(staff: PosDeskStaff[], workspace: PortableWorkspaceStateValue | null, snapshotDay?: string, requireCheckIn = true) {
  if (!workspace) return staff;
  const day = workspace.businessDate;
  if (!day) return [];
  const reset = (member: PosDeskStaff): PosDeskStaff => ({ ...member, today_status: "not_checked_in", check_in_at: null, check_in_sequence: null,
    turns: { queueTurns: 0, largeTurns: 0, smallTurns: 0, totalTurns: 0, receiptLargeTurns: 0 } });
  staff = staff.map(member => (snapshotDay ?? workspace.preparedDay) === day && (!member.check_in_at || portableBusinessDate(workspace.timezone, member.check_in_at) === day) ? member : reset(member));
  const existing = new Set(staff.map(member => member.id));
  return [...staff, ...workspace.staffRoster.filter(member => !existing.has(member.id) &&
    (["working", "checked_in"].includes(workspace.attendanceByStaffId[member.id]?.status) ||
      (member.check_in_at && portableBusinessDate(workspace.timezone, member.check_in_at) === day && ["working", "checked_in"].includes(member.today_status))))].map(member => {
      if (!existing.has(member.id) && (!member.check_in_at || portableBusinessDate(workspace.timezone, member.check_in_at) !== day)) member = reset(member);
      const presentation = workspace.staffRoster.find(row => row.id === member.id);
      if (presentation && (!presentation.check_in_at || portableBusinessDate(workspace.timezone, presentation.check_in_at) === day)) member = presentation;
      if (presentation) member = { ...member, avatar_url: presentation.avatar_url, display_name: presentation.display_name };
      const attendance = workspace.attendanceByStaffId[member.id];
      return attendance ? { ...member, today_status: attendance.status as PosDeskStaff["today_status"],
        check_in_at: attendance.checkInAt ?? member.check_in_at,
        check_in_sequence: attendance.checkInSequence ?? member.check_in_sequence,
        turns: { ...member.turns, queueTurns: attendance.queueTurnCount ?? member.turns.queueTurns } } : member;
    }).filter(member => !requireCheckIn || (member.today_status === "working" && Boolean(member.check_in_at) && portableBusinessDate(workspace.timezone, member.check_in_at!) === day)).filter(member => !workspace.attendanceByStaffId[member.id] ||
      !["break", "unavailable", "checked_out", "not_checked_in"].includes(workspace.attendanceByStaffId[member.id].status));
}
