import type { PrintableReceipt, ReceiptBrand, ReceiptDevicePreferences, ReceiptPrintJob } from "@/types/receipt-print";
import { normalizeReceiptPreferences } from "./receipt-device-preferences";

export const RECEIPT_HTML_LIMIT = 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function money(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Receipt amounts were not recorded. Reconnect and reopen the saved ticket.");
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
function time(value: string | null, timezone: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}
export function isClosedPrintableReceipt(receipt: PrintableReceipt) {
  return receipt.header.receipt_status === "Final Receipt" && receipt.header.ticket_status.toLowerCase() === "closed";
}
export function receiptPrintDocument({ receipt, receiptId, brand, preferences: raw, logoDataUrl, timezone = "America/Chicago", test = false, provisional }: {
  receipt: PrintableReceipt; receiptId?: string; brand: ReceiptBrand; preferences: ReceiptDevicePreferences;
  logoDataUrl?: string; timezone?: string; test?: boolean; provisional?: { operationId: string; scope: string; completedAt: string };
}) {
  if (provisional && (test || receiptId || !uuid.test(provisional.operationId) || !/^[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(provisional.scope) || !Number.isFinite(Date.parse(provisional.completedAt)))) throw new Error("The local ticket could not be verified. Reconnect before printing.");
  if (!test && !provisional && (!receiptId || !uuid.test(receiptId) || !isClosedPrintableReceipt(receipt))) throw new Error("Only a saved, closed ticket can be printed as a receipt.");
  const prefs = normalizeReceiptPreferences(raw);
  const logo = logoDataUrl && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logoDataUrl) && logoDataUrl.length <= 350_000 ? logoDataUrl : null;
  const totals = receipt.totals;
  const rows: Array<[string, number | undefined]> = [["Services / items", totals.subtotal], ["Discount", totals.discount]];
  if (totals.reward) rows.push(["Reward used", totals.reward]);
  rows.push(["Tax", totals.tax], ["Tip", totals.tip], ["Total", totals.grand_total]);
  if (!provisional) rows.push(["Recorded paid", totals.paid], ["Remaining", totals.remaining]);
  const width = prefs.paper === "58mm" ? 52 : prefs.paper === "80mm" ? 74 : 190;
  const paper = prefs.paper === "a4" ? "A4" : `${prefs.paper.slice(0, -2)}mm 297mm`;
  const html = `<!doctype html><html lang="en" data-reylumi-receipt-document="1"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(test ? "TEST — NOT A RECEIPT" : `Receipt ${receipt.header.ticket_number}`)}</title><style>
  @page{size:${paper};margin:3mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000;font-family:Arial,sans-serif;font-size:${prefs.paper === "58mm" ? 10 : 12}px;line-height:1.4}main{width:${width}mm;max-width:100%;margin:0 auto;padding:2mm 0}h1{font-size:1.35em;margin:0 0 3mm}h2{font-size:1em;margin:3mm 0 1mm}p{margin:1mm 0;overflow-wrap:anywhere}.brand{text-align:center}.brand img{max-width:24mm;max-height:18mm;object-fit:contain}.state{font-weight:bold;border:1px solid #000;padding:2mm;text-align:center}.test{font-size:1.2em;font-weight:bold;border:2px solid #000;padding:3mm;text-align:center}dl{margin:2mm 0}dl>div,.item-head{display:flex;justify-content:space-between;gap:3mm}dt{min-width:0}dd{margin:0;white-space:nowrap;font-variant-numeric:tabular-nums}.items,.totals,.payments,footer{border-top:1px dashed #000;margin-top:3mm;padding-top:2mm}.item{break-inside:avoid;margin:2mm 0}.item-head span{min-width:0;overflow-wrap:anywhere}.item-head strong{white-space:nowrap}.staff{font-size:.9em}.total{font-weight:bold;border-top:1px solid #000;margin-top:1mm;padding-top:1mm}footer{text-align:center;white-space:pre-wrap;overflow-wrap:anywhere}.totals,.payments,footer{break-inside:avoid}.receipt-id{font-size:.85em;overflow-wrap:anywhere}section{break-inside:auto}a{color:inherit}
  </style></head><body><main>${test ? '<p class="test">TEST PRINT<br>NOT A RECEIPT · NO SALE</p>' : ""}<header class="brand">${prefs.showLogo && logo ? `<img alt="Salon logo" src="${logo}">` : ""}<h1>${escape(brand.salonName || receipt.header.salon_name)}</h1>${prefs.showPhone && (brand.phone || receipt.header.salon_phone) ? `<p>${escape(brand.phone || receipt.header.salon_phone)}</p>` : ""}${prefs.showAddress && brand.address ? `<p>${escape(brand.address)}</p>` : ""}</header>
  <p class="state">${provisional ? "PROVISIONAL · PENDING SYNC<br>AWAITING SERVER VALIDATION" : test ? "SAMPLE — NOT A FINANCIAL RECORD" : escape(receipt.header.receipt_status)}${provisional ? "" : `<br>Ticket status: ${test ? "TEST" : escape(receipt.header.ticket_status)}`}</p><dl><div><dt>Ticket</dt><dd>${provisional ? "LOCAL — NOT A SERVER RECEIPT" : test ? "TEST" : escape(receipt.header.ticket_number)}</dd></div></dl>${provisional ? `<p class="receipt-id">Local operation ID: ${escape(provisional.operationId)}</p><p>Completed on device: ${escape(time(provisional.completedAt, timezone))}</p>` : !test ? `<p class="receipt-id">Receipt ID: ${escape(receiptId)}</p>` : ""}<p>Customer: ${escape(receipt.header.customer_name)}</p><p>Created: ${escape(time(receipt.header.created_time, timezone))}</p>${provisional ? "" : `<p>Closed: ${test ? "TEST" : escape(time(receipt.header.closed_time, timezone))}</p>`}
  <section class="items"><h2>Services / items</h2>${receipt.items.map(item => `<div class="item"><div class="item-head"><span>${escape(item.service_name)}</span><strong>${escape(money(item.line_total))}</strong></div>${item.assigned_staff ? `<p class="staff">Staff: ${escape(item.assigned_staff)}</p>` : ""}</div>`).join("")}</section><section class="totals"><dl>${rows.map(([label, value]) => `<div${label === "Total" ? ' class="total"' : ""}><dt>${label}</dt><dd>${label === "Discount" || label === "Reward used" ? "−" : ""}${escape(money(value))}</dd></div>`).join("")}</dl></section>
  <section class="payments"><h2>${provisional ? "Payment not verified by server" : `Recorded payments${test ? " (SAMPLE)" : ""}`}</h2>${provisional ? "<p>This local submission is awaiting validation. It is not a final receipt or proof of payment.</p>" : receipt.payments.length ? receipt.payments.map(p => `<p>${escape(p.method)} · ${escape(money(p.amount))}</p>`).join("") : "<p>No payments recorded</p>"}</section><footer>${escape(receipt.footer.message)}${prefs.customFooter.trim() ? `<p>${escape(prefs.customFooter)}</p>` : ""}<p class="receipt-id">${provisional ? `PENDING SYNC · Local operation ID: ${escape(provisional.operationId)}` : test ? "TEST PRINT · NOT A RECEIPT" : `Final Receipt · ${escape(receipt.header.ticket_number)}<br>Receipt ID: ${escape(receiptId)}`}</p></footer></main></body></html>`;
  if (new TextEncoder().encode(html).byteLength > RECEIPT_HTML_LIMIT) throw new Error("Receipt is too large to print. Reopen the saved ticket or use a shorter footer.");
  return html;
}
export function receiptPrintJob(input: Parameters<typeof receiptPrintDocument>[0]): ReceiptPrintJob {
  return { version: 1, jobId: crypto.randomUUID(), kind: input.provisional ? "provisional" : input.test ? "test" : "receipt", ...(input.provisional ? { operationId: input.provisional.operationId, scope: input.provisional.scope } : input.test ? {} : { receiptId: input.receiptId }),
    title: input.provisional ? "Pending sync — local ticket" : input.test ? "Reylumi test print — not a receipt" : `Receipt ${input.receipt.header.ticket_number}`.slice(0, 120), paper: input.preferences.paper, html: receiptPrintDocument(input) };
}
