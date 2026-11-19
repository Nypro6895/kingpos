"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WorkspaceText as T } from "@/components/workspace-language";
import { useNativeDialogNavigation, useTransientOverlay } from "@/components/overlay-dismissal";
import { dialogOutsideClick, dialogOutsidePointerDown } from "@/lib/dialog-outside-dismiss";
import { DEFAULT_RECEIPT_PREFERENCES, readReceiptPreferences, saveReceiptPreferences } from "@/lib/receipt-device-preferences";
import { receiptPrintDocument, receiptPrintJob } from "@/lib/receipt-print-document";
import { dispatchReceiptPrint, receiptLogoDataUrl } from "@/lib/receipt-print-client";
import type { PrintableReceipt, ReceiptDevicePreferences } from "@/types/receipt-print";
import { useReceiptContext, type ReceiptContext } from "./receipt-print-context";
import { ReceiptDocumentPreview } from "./receipt-print-actions";
import { useReceiptPresentationGuard } from "@/lib/use-receipt-presentation-guard";
import "./receipt-print.css";

export function receiptSetupSample(salonName: string): PrintableReceipt {
  return { header: { salon_name: salonName, salon_phone: null, ticket_number: "TEST", customer_name: "Sample customer", created_time: "2026-01-01T12:00:00Z", closed_time: null, ticket_status: "TEST", receipt_status: "Draft" },
    items: [{ service_name: "Sample service", assigned_staff: "Sample staff", line_total: 25 }],
    totals: { subtotal: 25, discount: 0, tax: 0, tip: 5, grand_total: 30, paid: 0, remaining: 30 }, payments: [], footer: { message: "Thank you." } };
}
function ReceiptSetupDialog({ context, onClose }: { context: ReceiptContext; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [initial] = useState(() => { try { return { preferences: readReceiptPreferences(context.scope), error: "" }; } catch { return { preferences: { ...DEFAULT_RECEIPT_PREFERENCES }, error: "Receipt preferences could not be read on this device. Please try again." }; } });
  const [draft, setDraft] = useState<ReceiptDevicePreferences>(initial.preferences), [error, setError] = useState(initial.error), [busy, setBusy] = useState(false), [preview, setPreview] = useState<string | null>(null), [status, setStatus] = useState("");
  const guard = useReceiptPresentationGuard(context.scope, () => { setPreview(null); onClose(); });
  useTransientOverlay(onClose, true); useNativeDialogNavigation(dialog);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function example(print: boolean) {
    if (busy) return; const token = guard.capture(); if (!guard.valid(token)) return; setBusy(true); setError(""); setStatus("");
    try {
      const input = { receipt: receiptSetupSample(context.brand.salonName), brand: context.brand, preferences: draft, timezone: context.timezone, test: true,
        logoDataUrl: draft.showLogo ? await receiptLogoDataUrl(context.brand.logoUrl) : undefined };
      if (!guard.valid(token)) return;
      if (!print) setPreview(receiptPrintDocument(input));
      else {
        const result = await dispatchReceiptPrint(receiptPrintJob(input));
        if (!guard.valid(token)) return;
        if (result.status === "failed") throw new Error(result.error || "The print dialog could not open.");
        setStatus(result.status === "cancelled" ? "Test print cancelled." : "Choose the printer in the system print dialog. No sale was created.");
      }
    } catch (e) { if (guard.valid(token)) setError(e instanceof Error ? e.message : "Test print is unavailable."); } finally { if (guard.valid(token)) setBusy(false); }
  }
  return createPortal(<dialog ref={dialog} className="receipt-setup-dialog" aria-label="Receipt setup" onClose={event => { event.stopPropagation(); onClose(); }} onCancel={event => event.stopPropagation()} onPointerDown={dialogOutsidePointerDown} onClick={dialogOutsideClick} data-touch-keyboard="off">
    <header><h2><T text="Receipt setup" /></h2><button type="button" aria-label="Cancel receipt setup" onClick={onClose}>×</button></header>
    <p className="receipt-caption"><T text="These layout and printer preferences are saved on this device for this POS workspace." /></p>
    <label className="receipt-setting-row"><span><T text="Paper" /></span><select aria-label="Receipt paper" value={draft.paper} onChange={e => setDraft({ ...draft, paper: e.target.value as ReceiptDevicePreferences["paper"] })}><option value="58mm">58 mm</option><option value="80mm">80 mm</option><option value="a4">A4 / system</option></select></label>
    {([['showLogo', 'Show salon logo'], ['showPhone', 'Show salon phone'], ['showAddress', 'Show salon address']] as const).map(([key, text]) => <label key={key} className="receipt-setting-row"><span><T text={text} /></span><input type="checkbox" checked={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.checked })} /></label>)}
    <p className="receipt-caption"><T text="Salon identity and contact details come from the salon profile. Receipt totals, ID and payment status stay visible." /></p>
    <label className="receipt-footer-label"><T text="Additional footer" /><textarea aria-label="Additional receipt footer" rows={3} maxLength={240} value={draft.customFooter} onChange={e => setDraft({ ...draft, customFooter: e.target.value })} /></label>
    <div className="receipt-setting-row"><span><T text="Printer on this device" /></span><span><T text="System print dialog" /></span></div>
    <p className="receipt-caption"><T text="Choose the printer and matching paper in the system dialog. Available printers and the remembered selection are managed by this device." /></p>
    <div className="receipt-secondary-actions"><button type="button" disabled={busy} onClick={() => void example(false)}><T text="Preview" /></button><button type="button" disabled={busy} onClick={() => void example(true)}><T text={busy ? "Opening…" : "Test print / choose printer"} /></button></div>
    {status && <p role="status"><T text={status} /></p>}{error && <p role="alert"><T text={error} /></p>}
    <footer><button className="receipt-text-action" type="button" disabled={busy} onClick={onClose}><T text="Cancel" /></button><button className="receipt-save" type="button" disabled={busy} onClick={() => { try { saveReceiptPreferences(context.scope, draft); onClose(); } catch { setError("Receipt preferences could not be saved. Your previous settings are unchanged."); } }}><T text="Save" /></button></footer>
    {preview && <ReceiptDocumentPreview html={preview} scope={context.scope} onClose={() => setPreview(null)} />}
  </dialog>, document.body);
}
export function ReceiptSetupSection() {
  const context = useReceiptContext(), [open, setOpen] = useState(false);
  if (!context) return null;
  return <section className="device-setting-section" aria-label="Receipts"><h3><T text="Receipts" /></h3><div className="device-list-row"><span><T text="Receipt setup" /></span><button type="button" onClick={() => setOpen(true)}><T text="Open" /></button></div>{open && <ReceiptSetupDialog context={context} onClose={() => setOpen(false)} />}</section>;
}
