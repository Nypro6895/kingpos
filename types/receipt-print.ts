import type { PosTicketReceipt } from "./pos-ticket-receipt";

export type ReceiptPaper = "58mm" | "80mm" | "a4";
export type ReceiptDevicePreferences = {
  version: 1;
  paper: ReceiptPaper;
  showLogo: boolean;
  showPhone: boolean;
  showAddress: boolean;
  customFooter: string;
  printer: "system";
};
export type ReceiptBrand = { salonName: string; phone?: string | null; address?: string | null; logoUrl?: string | null };
export type PrintableReceipt = Omit<PosTicketReceipt, "items" | "totals"> & {
  items: Array<Pick<PosTicketReceipt["items"][number], "service_name" | "assigned_staff" | "line_total">>;
  totals: Omit<PosTicketReceipt["totals"], "paid" | "remaining"> & { paid?: number; remaining?: number };
};
export type ReceiptPrintJob = {
  version: 1;
  jobId: string;
  kind: "receipt" | "provisional" | "test";
  receiptId?: string;
  operationId?: string;
  scope?: string;
  title: string;
  paper: ReceiptPaper;
  html: string;
};
export type ReceiptPrintResult = { jobId: string; status: "presented" | "submitted" | "cancelled" | "failed"; error?: string };
export type ReceiptPrintHost = { version: 1; print(job: ReceiptPrintJob): Promise<ReceiptPrintResult> };
declare global { interface Window { __reylumiReceiptPrint?: ReceiptPrintHost; __reylumiReceiptPrintResult?: (result: ReceiptPrintResult) => void } }
