"use client";

import { useState } from "react";
import { HistoryDetailsDrawer } from "@/app/activity/history-details-drawer";
import type { CustomerBookingActivity } from "@/lib/customer-activity";

export function BookingDetailsButton({ activity, initialOpen = false }: { activity: CustomerBookingActivity; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return <>
    <button type="button" className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border-subtle px-3 text-sm hover:text-brand-orange" onClick={() => setOpen(true)}>Details</button>
    {open ? <HistoryDetailsDrawer activity={activity} onClose={() => setOpen(false)} /> : null}
  </>;
}
