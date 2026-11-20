"use client";
import { useState } from "react";
import { WorkspaceText as T } from "@/components/workspace-language";
import { useReceiptContext } from "./receipt-print-context";
import { ReceiptDocumentPreview } from "./receipt-print-actions";
import { readReceiptPreferences } from "@/lib/receipt-device-preferences";
import { readProvisionalReceipt } from "@/lib/provisional-receipt-print";
import { receiptPrintDocument, receiptPrintJob } from "@/lib/receipt-print-document";
import { dispatchReceiptPrint, receiptLogoDataUrl } from "@/lib/receipt-print-client";
import { useReceiptPresentationGuard } from "@/lib/use-receipt-presentation-guard";

export function ProvisionalReceiptPrintActions({ operationId }: { operationId: string }) {
  const context = useReceiptContext();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState(""), [preview, setPreview] = useState<string | null>(null);
  const guard = useReceiptPresentationGuard(context?.scope ?? "unavailable", () => { setPreview(null); setBusy(false); setError(""); setStatus(""); });
  if (!context) return null;
  async function open(print: boolean) {
    if (!context || busy) return; const token = guard.capture(); if (!guard.valid(token)) return; setBusy(true); setError(""); setStatus("");
    try {
      const captured = await readProvisionalReceipt(context.scope, operationId), preferences = readReceiptPreferences(context.scope);
      const input = { ...captured, brand: context.brand, timezone: context.timezone, preferences,
        logoDataUrl: preferences.showLogo ? await receiptLogoDataUrl(context.brand.logoUrl) : undefined };
      if (!guard.valid(token)) return;
      if (!print) setPreview(receiptPrintDocument(input));
      else {
        // A logo read must not keep an expired admission or changed queue state.
        const current = await readProvisionalReceipt(context.scope, operationId);
        if (!guard.valid(token)) return;
        const result = await dispatchReceiptPrint(receiptPrintJob({ ...input, ...current }));
        if (!guard.valid(token)) return;
        if (result.status === "failed") throw new Error(result.error || "The print dialog could not open.");
        setStatus(result.status === "cancelled" ? "Printing cancelled." : "Pending-sync slip sent to system printing. It is not a final receipt or proof of payment.");
      }
    } catch (e) { if (guard.valid(token)) setError(e instanceof Error ? e.message : "Reconnect and unlock POS before printing this local ticket."); }
    finally { if (guard.valid(token)) setBusy(false); }
  }
  return <div className="receipt-print-actions px-3 pb-3"><button type="button" disabled={busy} onClick={() => void open(false)}><T text="Preview pending-sync slip" /></button><button type="button" disabled={busy} onClick={() => void open(true)}><T text={busy ? "Opening…" : "Print pending-sync slip"} /></button>{status && <p role="status"><T text={status} /></p>}{error && <p role="alert"><T text={error} /></p>}{preview && <ReceiptDocumentPreview html={preview} scope={context.scope} onClose={() => setPreview(null)} />}</div>;
}
