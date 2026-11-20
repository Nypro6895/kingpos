"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { ActionFeedback } from "@/components/action-feedback";
import { useRef, useState } from "react";
import { useStaffConfirmation } from "./staff-schedule-interactions";
import { confirmNoShowHistory } from "@/components/booking-ui/no-show-confirmation";

export function StaffConfirmBookingButton({bookingId, disabled, label = "Confirm"}: {bookingId:string;disabled?:boolean;label?:string}) {
  const __vt = useWorkspaceTranslation();

  const confirmation = useStaffConfirmation();
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const confirmed = saved || Boolean(confirmation?.confirmed.has(bookingId));
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  async function confirm(acknowledgeNoShow = false) {
    const response = await fetch("/api/staff/confirm-booking", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, acknowledgeNoShow }),
    });
    return await response.json() as { ok: boolean; message?: string; noShowHistory?: import("@/lib/booking-no-show").NoShowHistoryItem[] };
  }
  if (confirmation?.noShows.has(bookingId)) return null;
  return <div>
    <button className="staff-appointments-primary-button disabled:opacity-50" disabled={disabled || pending || confirmed} aria-busy={pending} type="button" onClick={async () => {
      if (inFlight.current || confirmed) return;
      inFlight.current = true;
      setPending(true);
      setError("");
      try {
        let result = await confirm();
        if(result.noShowHistory?.length){
          if(!await confirmNoShowHistory(result.noShowHistory))return;
          result = await confirm(__vt(true));
        }
        if(!result.ok)setError(result.message ?? "Unable to confirm appointment.");
        else {
          setSaved(true);
          confirmation?.markConfirmed(bookingId);
        }
      } catch {
        setError("Unable to confirm appointment. Please try again.");
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    }}><ActionFeedback pending={pending} pendingLabel="Confirming…">{confirmed ? <WorkspaceText text="Confirmed" /> : label}</ActionFeedback></button>
    {error ? <p className="mt-2 text-sm text-red-700" role="alert"><WorkspaceText text={error} /></p> : null}
  </div>;
}
