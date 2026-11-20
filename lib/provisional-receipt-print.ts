import type { PrintableReceipt } from "@/types/receipt-print";
import { listPortableOperations, portableCheckpoint, type PortableOperation } from "./portable-operations";
import { nativePortableDevice, desktopDevice } from "./portable-device-storage";
import { portableNativeReadiness } from "./portable-native-client";

export type CapturedReceiptPrintSnapshot = {
  version: 1; completion: "submitted-on-device"; paymentState: "awaiting-server-validation"; capturedAt: string;
  customerName: string; lines: Array<{ service_name: string; assigned_staff: string; line_total: number }>;
  totals: Pick<PrintableReceipt["totals"], "subtotal" | "discount" | "tax" | "tip" | "grand_total">;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function captureReceiptPrintSnapshot(value: Omit<CapturedReceiptPrintSnapshot, "version" | "completion" | "paymentState">): CapturedReceiptPrintSnapshot {
  if (!Number.isFinite(Date.parse(value.capturedAt)) || !value.lines.length || value.lines.some(l => !Number.isFinite(l.line_total) || l.line_total < 0) ||
    Object.values(value.totals).some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0)) throw new Error("The completed local ticket could not be captured for printing.");
  return { ...structuredClone(value), version: 1, completion: "submitted-on-device", paymentState: "awaiting-server-validation" };
}
/** Optional display metadata must never prevent an otherwise valid POS command. */
export function optionalReceiptPrintSnapshot(value: Omit<CapturedReceiptPrintSnapshot, "version" | "completion" | "paymentState">): CapturedReceiptPrintSnapshot | undefined {
  try { return captureReceiptPrintSnapshot(value); } catch { return undefined; }
}
export function provisionalReceiptFromOperation(operation: PortableOperation, scope: string, checkpoint: number, authorized: boolean, now = Date.now()) {
  const snapshot = operation.payload.printSnapshot as CapturedReceiptPrintSnapshot | undefined;
  if (!authorized || !uuid.test(operation.id) || scope.split(":").length !== 2 || !scope.split(":").every(part => uuid.test(part)) || operation.scope !== scope || operation.kind !== "receipt" || operation.state !== "pending" || operation.rejected || !Number.isFinite(Date.parse(operation.occurredAt)) ||
    typeof operation.payload.localDraftKey !== "string" || !operation.payload.localDraftKey.startsWith("kingpos:portable-draft:v1:") ||
    !Number.isFinite(checkpoint) || checkpoint < Date.parse(operation.occurredAt) || checkpoint > now + 1000 ||
    !snapshot || snapshot.version !== 1 || snapshot.completion !== "submitted-on-device" || snapshot.paymentState !== "awaiting-server-validation") {
    throw new Error("Reconnect and unlock POS before printing this local ticket. Drafts and unverified submissions cannot be printed as receipts.");
  }
  const checked = captureReceiptPrintSnapshot(snapshot);
  const receipt: PrintableReceipt = { header: { salon_name: "", salon_phone: null, ticket_number: "LOCAL", customer_name: checked.customerName || "Walk-in",
    created_time: operation.occurredAt, closed_time: null, ticket_status: "Pending sync", receipt_status: "Draft" }, items: checked.lines,
    totals: checked.totals, payments: [], footer: { message: "Keep this local slip until the saved ticket is confirmed by the server." } };
  return { receipt, provisional: { operationId: operation.id, scope, completedAt: checked.capturedAt } };
}
export async function receiptDevicePrintAuthority(scope: string) {
  let authorized = false;
  if (nativePortableDevice()) {
    const ready = await portableNativeReadiness();
    authorized = ready?.scope === scope && ready.offlineReady && Date.parse(ready.expiresAt) > Date.now();
  } else {
    const desktop = desktopDevice() as ReturnType<typeof desktopDevice> & { printing?: { readiness(scope: string): Promise<{ ready: boolean; scope: string; localCommands: boolean }> } };
    const ready = await desktop?.printing?.readiness(scope);
    authorized = ready?.ready === true && ready.scope === scope && ready.localCommands === true;
  }
  return authorized;
}
export async function readProvisionalReceipt(scope: string, operationId: string) {
  const authorized = await receiptDevicePrintAuthority(scope);
  if (!authorized) throw new Error("Reconnect and unlock POS before printing this local ticket.");
  const operation = (await listPortableOperations(scope)).find(o => o.id === operationId);
  if (!operation) throw new Error("This local ticket is no longer pending. Reload Tickets for the confirmed receipt.");
  const checkpoint = typeof operation.payload.localDraftKey === "string" ? await portableCheckpoint(scope, operation.payload.localDraftKey) : 0;
  return provisionalReceiptFromOperation(operation, scope, checkpoint, authorized);
}
