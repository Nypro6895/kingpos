"use client";

import { useRef, useState } from "react";
import { useStaffConfirmation } from "./staff-schedule-interactions";

export function StaffNoShowButton({ bookingId, confirmed, eligible }: { bookingId: string; confirmed: boolean; eligible: boolean }) {
  const state = useStaffConfirmation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"unexcused" | "excused">("unexcused");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  if (state?.noShows.has(bookingId)) return <p role="status">No-show reported.</p>;
  if (!eligible || !(confirmed || state?.confirmed.has(bookingId))) return null;
  if (!open) return <button type="button" className="staff-appointments-secondary-button" onClick={() => setOpen(true)}>Report no-show</button>;
  return <form className="staff-no-show-form" onSubmit={async event => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/api/staff/report-no-show", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({bookingId, kind, reason})});
      const result = await response.json() as {ok: boolean; message?: string};
      if (!response.ok || !result.ok) throw new Error(result.message ?? "Unable to report no-show.");
      state?.markNoShow(bookingId, kind);
      setOpen(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to report no-show. Please try again."); }
    finally { inFlight.current = false; setPending(false); }
  }}>
    <p>Report that the customer did not arrive for this appointment.</p>
    <label>No-show type<select value={kind} disabled={pending} onChange={event => setKind(event.target.value as typeof kind)}><option value="unexcused">Without a reason</option><option value="excused">Customer provided a reason</option></select></label>
    <label>{kind === "excused" ? "Customer’s reason" : "Note (optional)"}<textarea value={reason} onChange={event => setReason(event.target.value)} required={kind === "excused"} maxLength={1000} disabled={pending} rows={2} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <div><button className="staff-appointments-primary-button" disabled={pending} type="submit">{pending ? "Saving…" : "Save no-show"}</button><button className="staff-appointments-secondary-button" disabled={pending} type="button" onClick={() => setOpen(false)}>Cancel</button></div>
  </form>;
}
