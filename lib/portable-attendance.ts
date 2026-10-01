// Mirrors submit_pos_portable_attendance_event; a return uses the people who
// were working at leave time, never a newly arrived staff member's lower turn.
export type AttendanceRow = {
  id: string; status: string; queueTurnCount: number; checkInAt: string | null;
  checkInSequence: number | null; leaveCohortStaffIds?: string[]; leaveBaselineTurnCount?: number | null;
};
export function nextPortableAttendance(staff: AttendanceRow, roster: AttendanceRow[], event: string, now = new Date().toISOString()) {
  const working = roster.filter(row => row.id !== staff.id && ["working", "checked_in"].includes(row.status));
  const minimum = working.length ? Math.min(...working.map(row => row.queueTurnCount)) : 0;
  const lateStart = working.every(row => row.queueTurnCount === minimum) ? Math.max(0, minimum - 1) : minimum;
  const cohort = working.filter(row => staff.leaveCohortStaffIds?.includes(row.id));
  if (event === "RETURN_TO_WORK" && !staff.leaveCohortStaffIds) throw Error("Connect once to refresh this staff member before returning to work.");
  return {
    checkInAt: event === "CHECK_IN" ? staff.checkInAt ?? now : staff.checkInAt,
    checkInSequence: event === "CHECK_IN" ? Math.max(0, ...roster.map(row => row.checkInSequence ?? 0)) + 1 : staff.checkInSequence,
    queueTurnCount: event === "CHECK_IN" ? Math.max(staff.queueTurnCount, lateStart) : event === "RETURN_TO_WORK"
      ? Math.max(staff.queueTurnCount, cohort.length ? Math.min(...cohort.map(row => row.queueTurnCount)) : staff.leaveBaselineTurnCount ?? staff.queueTurnCount)
      : staff.queueTurnCount,
    leaveCohortStaffIds: event === "LEAVE_OUT" ? working.map(row => row.id) : [],
    leaveBaselineTurnCount: event === "LEAVE_OUT" && working.length ? minimum : null,
    status: event === "CHECK_IN" || event === "RETURN_TO_WORK" ? "working" : event === "LEAVE_OUT" ? "break" : "checked_out",
  };
}
