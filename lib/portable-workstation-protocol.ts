import type { LocalReceiptPreview } from "@/lib/pos-local-display";
import type { PortableWorkstationEnvelope } from "@/types/portable-workstation";

/** Only this projection crosses devices. The legacy draft bearer never does. */
export type WorkstationPreview = Omit<LocalReceiptPreview, "payload"> & {
  payload: Omit<LocalReceiptPreview["payload"], "token">;
  busy?: boolean;
};
export type WorkstationIntent = {
  id: string; cartId: string; revision: string;
} & ({ kind: "tip"; amount: number } | { kind: "customer"; customer: NonNullable<LocalReceiptPreview["payload"]["customer"]> } | { kind: "dismiss" });
export type WorkstationAck = { id: string; cartId: string; revision: string; accepted: boolean };

/** Shared browser/server signing encoding; sorting includes every nested key. */
export function workstationCanonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(workstationCanonicalJSON).join(",") + "]";
  return "{" + Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => JSON.stringify(key) + ":" + workstationCanonicalJSON((value as Record<string, unknown>)[key])).join(",") + "}";
}
export function workstationSignedBody(envelope: PortableWorkstationEnvelope) {
  const { signature: _signature, ...body } = envelope;
  void _signature;
  return workstationCanonicalJSON(body);
}
export function portableWorkstationSigningPayload(envelope: Omit<PortableWorkstationEnvelope, "signature">) { return workstationCanonicalJSON(envelope); }
export function validWorkstationPreview(value: unknown): value is WorkstationPreview {
  if (!value || typeof value !== "object") return false;
  const preview = value as WorkstationPreview;
  return typeof preview.cartId === "string" && preview.cartId.length <= 128 && typeof preview.revision === "string" && preview.revision.length <= 128 &&
    !!preview.payload && !("token" in preview.payload) && Array.isArray(preview.payload.staffLines) && preview.payload.staffLines.length <= 100 &&
    [preview.payload.subtotal, preview.payload.total, preview.payload.totalBeforeTip, preview.payload.tax, preview.payload.discount, preview.payload.tip].every(amount => Number.isFinite(amount) && amount >= 0 && amount <= 10000000);
}
