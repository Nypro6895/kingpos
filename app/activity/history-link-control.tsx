"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadHistoryEvidenceAction, setHistoryLinkAction } from "./history-link-actions";
import { historyTicketTotals, type HistoryEvidence } from "@/lib/booking-history";

export function HistoryLinkControl({ bookingId, evidence: initial, timezone = "America/Chicago", owner = false }: {
  bookingId: string; evidence?: HistoryEvidence; timezone?: string; owner?: boolean;
}) {
  const [evidence, setEvidence] = useState(initial);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const time = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
  function open() {
    startTransition(async () => {
      setError("");
      const result = await loadHistoryEvidenceAction(bookingId);
      if (result.error) { setError(result.error); return; }
      setEvidence(result.evidence);
      dialog.current?.showModal();
    });
  }
  function save(targetId: string, kind: "ticket" | "visit", unlink = false) {
    startTransition(async () => {
      const result = await setHistoryLinkAction({ bookingId, targetId, kind, unlink });
      if (result.error) { setError(result.error); return; }
      dialog.current?.close();
      const fresh = await loadHistoryEvidenceAction(bookingId);
      setEvidence(fresh.evidence);
      router.refresh();
    });
  }
  if (!owner && !evidence?.manualLink && !evidence?.candidates.length) return null;
  return <span className="inline-block text-xs">
    <button type="button" disabled={pending} onClick={open} className="min-h-9 px-2 font-bold text-brand-teal disabled:opacity-50">{evidence?.manualLink ? "Manage merge" : owner ? "Visit history" : "Same-day visit · Merge"}</button>
    {error ? <span role="alert">{error}</span> : null}
    <dialog ref={dialog} onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }} onKeyDown={event => event.stopPropagation()} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm max-h-[75dvh] overflow-y-auto rounded-xl border border-border-subtle bg-white p-4 text-text-primary shadow-xl backdrop:bg-black/30">
      <h2 className="text-sm font-extrabold">Appointment & salon visit</h2>
      <p className="mt-1 text-xs text-text-secondary">Merge matching history. Original records are kept.</p>
      {evidence?.appointmentAt ? <p className="mt-3 text-xs"><strong>{time(evidence.appointmentAt)} ? Est. ${Number(evidence.estimate ?? 0).toFixed(2)}</strong><br />{evidence.appointmentServices?.join(", ")}</p> : null}
      {evidence?.ticket ? <p className="mt-3">Ticket {evidence.ticket.ticketNumber} · Paid at salon ${historyTicketTotals(evidence.ticket).total.toFixed(2)}</p> : null}
      {evidence?.checkedInAt ? <p className="mt-2">Checked in · {time(evidence.checkedInAt)}</p> : null}
      {evidence?.manualLink ? <button disabled={pending} type="button" onClick={() => save(bookingId, "visit", true)} className="mt-3 min-h-9 font-bold text-brand-orange">Undo merge</button> : evidence?.candidates.map(candidate => <div key={candidate.id} className="mt-3 flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
        <div><p className="font-bold">{candidate.label}{candidate.ticket ? ` · $${historyTicketTotals(candidate.ticket).total.toFixed(2)}` : ""}</p><p className="mt-1 text-text-secondary">{time(candidate.at)}</p>{candidate.ticket ? <p>{candidate.ticket.services.map(service => service.name).join(", ")}</p> : null}</div>
        <button type="button" disabled={pending} onClick={() => save(candidate.id, candidate.kind)} className="min-h-9 rounded-lg bg-brand-teal px-3 font-bold text-white disabled:opacity-50">Merge</button>
      </div>)}
      {!evidence?.manualLink && !evidence?.candidates.length ? <p className="mt-3">No unlinked same-day visits.</p> : null}
      {error ? <p role="alert" className="mt-2 text-red-700">{error}</p> : null}
      <button type="button" disabled={pending} onClick={() => dialog.current?.close()} className="mt-3 min-h-9 font-bold">Close</button>
    </dialog>
  </span>;
}
