import type { ReceiptPrintJob, ReceiptPrintResult } from "@/types/receipt-print";
import { RECEIPT_HTML_LIMIT } from "./receipt-print-document";
import { RECEIPT_PRIVATE_CLOSE_EVENTS } from "./use-receipt-presentation-guard";

export async function dispatchReceiptPrint(job: ReceiptPrintJob): Promise<ReceiptPrintResult> {
  if (job.version !== 1 || new TextEncoder().encode(job.html).byteLength > RECEIPT_HTML_LIMIT) throw new Error("Invalid receipt print job.");
  const native = window.__reylumiReceiptPrint;
  if (native?.version === 1) return native.print(job);
  const desktop = window.kingposDesktop as typeof window.kingposDesktop & { printing?: { print(job: ReceiptPrintJob): Promise<ReceiptPrintResult> } };
  if (desktop?.printing) return desktop.printing.print(job);
  const frame = document.createElement("iframe");
  frame.title = "Receipt printing";
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  Object.assign(frame.style, { position: "fixed", width: "1px", height: "1px", left: "-10000px", border: "0" });
  const loaded = new Promise<void>((resolve, reject) => { frame.onload = () => resolve(); frame.onerror = () => reject(new Error("Receipt preview could not open.")); });
  frame.srcdoc = job.html; document.body.append(frame);
  const cleanup = () => { frame.remove(); for (const event of RECEIPT_PRIVATE_CLOSE_EVENTS) window.removeEventListener(event, cleanup); window.removeEventListener("kingpos:receipt-admission-changed", admission); };
  const admission = (event: Event) => { if ((event as CustomEvent<{ state?: string }>).detail?.state !== "ready") cleanup(); };
  for (const event of RECEIPT_PRIVATE_CLOSE_EVENTS) window.addEventListener(event, cleanup);
  window.addEventListener("kingpos:receipt-admission-changed", admission);
  try {
    await loaded;
    const target = frame.contentWindow;
    if (!target || !frame.isConnected) throw new Error("Printing is not available in this browser or the workspace changed.");
    target.addEventListener("afterprint", cleanup, { once: true });
    target.focus(); target.print();
    // Browsers expose no reliable physical printer success signal.
    window.setTimeout(cleanup, 60_000);
    return { jobId: job.jobId, status: "presented" };
  } catch (error) { cleanup(); throw error; }
}

/** Fetch through the current app context; embed pixels so print hosts make no network request. */
export async function receiptLogoDataUrl(source?: string | null): Promise<string | undefined> {
  if (!source) return;
  try {
    const url = new URL(source, location.href);
    if (!["http:", "https:"].includes(url.protocol)) return;
    const response = await fetch(url, { credentials: url.origin === location.origin ? "same-origin" : "omit", signal: AbortSignal.timeout(8000) });
    const blob = await response.blob();
    if (!response.ok || !/^image\/(png|jpeg|webp|avif)$/.test(blob.type) || blob.size > 2_000_000) return;
    const bitmap = await createImageBitmap(blob), canvas = document.createElement("canvas");
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const data = canvas.toDataURL("image/png"); return data.length <= 350_000 ? data : undefined;
  } catch { return; }
}
