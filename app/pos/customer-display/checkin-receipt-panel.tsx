"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useEffect, useRef, useState } from "react";
import { QrCodeTile } from "@/components/qr-code-tile";
import { issueCheckinReceipt } from "@/app/pos/checkin-receipt-actions";
import type { CheckinReceipt } from "@/types/checkin-receipt";

type PrintBridge = { printCheckinReceipt?: (receipt: CheckinReceipt & { cells: number[][]; reprint: boolean }) => Promise<void> };
export function CheckinReceiptPanel({ token, visitId, onPrintingChange }: { token: string; visitId: string; onPrintingChange: (busy: boolean) => void }) {
  const __vt = useWorkspaceTranslation();

  const [receipt, setReceipt] = useState<CheckinReceipt | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const tile = useRef<HTMLDivElement>(null);
  const attempted = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void issueCheckinReceipt(token, visitId).then(result => {
      if (cancelled) return;
      if (result.error) setMessage(result.error);
      else setReceipt(result.receipt ?? null);
    });
    return () => { cancelled = true; };
  }, [token, visitId]);
  async function print(reprint = false) {
    if (!receipt || busy) return;
    setBusy(true);
    onPrintingChange(true);
    try {
      const bridge = (window as unknown as { kingposDisplay?: PrintBridge }).kingposDisplay;
      if (bridge?.printCheckinReceipt) {
        const cells = Array.from(tile.current?.querySelectorAll('svg rect[width="1"]') ?? []).map(rect => [Number(rect.getAttribute("x")), Number(rect.getAttribute("y"))]);
        if (!cells.length) throw new Error("Receipt QR could not be prepared.");
        await bridge.printCheckinReceipt({ ...receipt, cells, reprint });
        setMessage("Receipt sent to the printer. Keep it for the front desk.");
      } else {
        const frame = document.createElement("iframe");
        frame.style.cssText = "position:fixed;width:0;height:0;border:0";
        document.body.appendChild(frame);
        const doc = frame.contentDocument;
        if (!doc || !frame.contentWindow) { frame.remove(); throw new Error("Printing is unavailable on this device."); }
        const style = doc.createElement("style");
        style.textContent = "@page{size:80mm 160mm;margin:5mm}body{font:14px Arial;text-align:center}h1{font-size:48px;margin:12px}svg{width:44mm;height:44mm;padding:3mm;background:white}button{display:none}";
        doc.head.appendChild(style);
        doc.body.appendChild(tile.current!.cloneNode(true));
        frame.contentWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setMessage("Complete printing in the printer dialog. Keep your receipt for the front desk.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Printer unavailable. Retry printing or ask the front desk."); }
    finally { setBusy(false); onPrintingChange(false); }
  }
  useEffect(() => {
    if (!receipt || attempted.current) return;
    attempted.current = true;
    // Run after the receipt and QR have committed to the DOM.
    const timer = setTimeout(() => { void print(); }, 100);
    return () => { clearTimeout(timer); attempted.current = false; };
    // Printing is triggered once for each mounted confirmation, with an explicit retry below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt]);
  if (!receipt && !message) return null;
  return <section className="mt-4 rounded-xl bg-white p-4 text-center text-zinc-950" aria-label={__vt("Check-in receipt")}>
    {receipt && <><div ref={tile}><p>{receipt.salonName}</p><p><WorkspaceText text="Check-in ·" /> {receipt.businessDate}</p><h1 className="text-5xl font-bold">#{receipt.queueNumber}</h1><p>{receipt.customerName}</p><QrCodeTile ariaLabel="Scan check-in receipt to create ticket" valueToEncode={`reylumi:checkin:${receipt.visitId}`} fallbackMessage="Ask the front desk to select your check-in." className="mx-auto h-40 w-40 bg-white p-3" /><p><WorkspaceText text="Scan at the front desk to create your ticket." /></p><p><WorkspaceText text="By Reylumi" /></p></div><button type="button" disabled={busy} className="mt-3 rounded-lg border px-4 py-2" onClick={() => void print(true)}><WorkspaceText text={busy ? "Printing…" : "Print again"} /></button></>}
    <p role="status" className="mt-2 text-sm"><WorkspaceText text={message} /></p>
  </section>;
}
