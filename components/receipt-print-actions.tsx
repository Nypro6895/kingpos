"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WorkspaceText as T } from "@/components/workspace-language";
import { useNativeDialogNavigation, useTransientOverlay } from "@/components/overlay-dismissal";
import { dialogOutsideClick, dialogOutsidePointerDown } from "@/lib/dialog-outside-dismiss";
import { receiptPrintDocument, receiptPrintJob, isClosedPrintableReceipt } from "@/lib/receipt-print-document";
import { dispatchReceiptPrint, receiptLogoDataUrl } from "@/lib/receipt-print-client";
import { readReceiptPreferences } from "@/lib/receipt-device-preferences";
import { useReceiptPresentationGuard } from "@/lib/use-receipt-presentation-guard";
import { useReceiptContext, type ReceiptContext } from "./receipt-print-context";
import type { PrintableReceipt } from "@/types/receipt-print";
import "./receipt-print.css";

export function ReceiptDocumentPreview({ html, onClose, scope }: { html: string; onClose(): void; scope: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useReceiptPresentationGuard(scope, onClose);
  useTransientOverlay(onClose, true); useNativeDialogNavigation(dialog);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return createPortal(<dialog className="receipt-document-preview" ref={dialog} aria-label="Receipt preview" onClose={event => { event.stopPropagation(); onClose(); }} onCancel={event => event.stopPropagation()} onPointerDown={dialogOutsidePointerDown} onClick={dialogOutsideClick}>
    <header><h2><T text="Receipt preview" /></h2><button type="button" aria-label="Close receipt preview" onClick={onClose}>×</button></header>
    <iframe title="Receipt document" sandbox="" srcDoc={html} />
    <p><T text="Totals, receipt identity and payment records cannot be changed here." /></p>
    <button className="receipt-text-action" type="button" onClick={onClose}><T text="Close" /></button>
  </dialog>, document.body);
}

export function ReceiptPrintActions({ receipt, receiptId, context: supplied, disabled = false, loadReceipt, validatePrint }: {
  receipt: PrintableReceipt; receiptId: string; context?: ReceiptContext; disabled?: boolean; loadReceipt?: () => Promise<PrintableReceipt>; validatePrint?: () => Promise<void>;
}) {
  const inherited = useReceiptContext(), context = supplied ?? inherited;
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState(""), [preview, setPreview] = useState<string | null>(null);
  const guard = useReceiptPresentationGuard(context?.scope ?? "unavailable", () => { setPreview(null); setError(""); setStatus(""); setBusy(false); });
  if (!context || !isClosedPrintableReceipt(receipt)) return null;
  async function open(print: boolean) {
    if (busy || disabled || !context) return;
    const token = guard.capture(); if (!guard.valid(token)) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const preferences = readReceiptPreferences(context.scope);
      const captured = loadReceipt ? await loadReceipt() : receipt;
      const logoDataUrl = preferences.showLogo ? await receiptLogoDataUrl(context.brand.logoUrl) : undefined;
      if (validatePrint) await validatePrint();
      if (!guard.valid(token)) return;
      if (preferences.showLogo && context.brand.logoUrl && !logoDataUrl) setError("The salon logo is unavailable. This preview prints without it.");
      const input = { receipt: captured, receiptId, brand: context.brand, preferences, logoDataUrl, timezone: context.timezone };
      if (!print) setPreview(receiptPrintDocument(input));
      else {
        const result = await dispatchReceiptPrint(receiptPrintJob(input));
        if (!guard.valid(token)) return;
        if (result.status === "failed") throw new Error(result.error || "The print dialog could not open. Please try again.");
        setStatus(result.status === "cancelled" ? "Printing cancelled." : result.status === "submitted" ? "Sent to system printing." : "System print dialog opened. Confirm the printer there.");
      }
    } catch (e) { if (guard.valid(token)) setError(e instanceof Error ? e.message : "Receipt printing is unavailable. Please try again."); }
    finally { if (guard.valid(token)) setBusy(false); }
  }
  return <div className="receipt-print-actions" data-receipt-print-actions>
    <button type="button" disabled={busy || disabled} onClick={() => void open(false)}><T text={busy ? "Opening…" : "Preview receipt"} /></button>
    <button type="button" disabled={busy || disabled} onClick={() => void open(true)}><T text="Print receipt" /></button>
    {status && <p role="status"><T text={status} /></p>}{error && <p role="alert"><T text={error} /></p>}
    {preview && <ReceiptDocumentPreview html={preview} scope={context.scope} onClose={() => setPreview(null)} />}
  </div>;
}
