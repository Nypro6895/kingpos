"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";

export type PosWorkspaceTab = "pos" | "ticket" | "book" | "checkIn" | "report";
const panels: Record<PosWorkspaceTab, { title: string; columns: string[] }> = {
  pos: { title: "POS", columns: ["Service", "Staff", "Amount"] },
  ticket: { title: "Tickets", columns: ["Time", "Customer", "Total"] },
  book: { title: "Bookings", columns: ["Time", "Customer", "Service", "Staff"] },
  checkIn: { title: "Check In", columns: ["Staff", "Status", "Check in"] },
  report: { title: "Reports", columns: ["Date", "Sales", "Payments"] },
};

/** Only stable labels and layout: never display invented counts or amounts. */
export function PosTabPlaceholder({ tab }: { tab: PosWorkspaceTab }) {
  const translate = useWorkspaceTranslation();
  const panel = panels[tab];
  return <section className="min-h-64 bg-white p-4 sm:p-6" aria-busy="true" aria-label={translate(panel.title)} data-pos-tab-placeholder={tab}>
    <h1 className="text-xl font-semibold text-zinc-950"><WorkspaceText text={panel.title} /></h1>
    <div className="mt-5 overflow-hidden rounded-xl border border-zinc-200">
      <div className="flex gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-600">
        {panel.columns.map(column => <span className="min-w-0 flex-1" key={column}><WorkspaceText text={column} /></span>)}
      </div>
      <div className="space-y-4 p-4" aria-hidden="true">
        {[0, 1, 2].map(row => <div className="flex gap-3" key={row}>
          {panel.columns.map(column => <span className="h-5 min-w-0 flex-1 rounded bg-zinc-100" key={column} />)}
        </div>)}
      </div>
    </div>
  </section>;
}
