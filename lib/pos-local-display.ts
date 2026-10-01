import type { PosLiveDraftView } from "@/types/pos-desk";
import type { PortableDraftPayload } from "@/app/pos/portable/use-portable-draft";

export type LocalReceiptPreview = { cartId: string; revision: string; payload: PortableDraftPayload; completedAt?: string; resetAt?: string };
type LocalTipRequest = { cartId: string; revision: string; id: string; amount: number };
type LocalCustomerRequest = { cartId: string; revision: string; id: string; customer: NonNullable<PosLiveDraftView["customer"]> };
export function connectLocalReceipt(token: string, callbacks: {
  preview?: (preview: LocalReceiptPreview) => void;
  tip?: (request: LocalTipRequest) => boolean | undefined;
  customer?: (request: LocalCustomerRequest) => boolean | undefined;
  dismissCompleted?: (cartId: string) => void;
  displayPresent?: () => void;
}) {
  if (typeof BroadcastChannel === "undefined") return { publish: (value: LocalReceiptPreview) => { void value; }, close: () => {} };
  const channel = new BroadcastChannel(`kingpos:receipt:v1:${token}`);
  channel.onmessage = ({data}) => {
    if (data?.kind === "display-present") callbacks.displayPresent?.();
    if (data?.kind === "dismiss-completed" && typeof data.cartId === "string") callbacks.dismissCompleted?.(data.cartId);
    if (data?.kind === "preview" && typeof data.value?.cartId === "string" && typeof data.value?.revision === "string" &&
      data.value.payload?.token === token && Array.isArray(data.value.payload.staffLines) &&
      ["subtotal", "total", "totalBeforeTip", "tax", "discount", "tip"].every(key => Number.isFinite(data.value.payload[key]) && data.value.payload[key] >= 0) && callbacks.preview) {
      callbacks.preview(data.value);
      channel.postMessage({kind:"display-present"});
    }
    if (data?.kind === "tip" && typeof data.value?.id === "string" && Number.isFinite(data.value.amount) && data.value.amount >= 0 && data.value.amount <= 100000 && callbacks.tip) {
      const accepted = callbacks.tip(data.value);
      if (accepted !== undefined) channel.postMessage({ kind: "tip-ack", id: data.value.id, accepted });
    }
    if (data?.kind === "customer" && typeof data.value?.id === "string" && typeof data.value.customer?.id === "string" && typeof data.value.customer?.name === "string" && callbacks.customer) {
      const accepted = callbacks.customer(data.value);
      if (accepted !== undefined) channel.postMessage({ kind: "customer-ack", id: data.value.id, accepted });
    }
  };
  return { publish: (value: LocalReceiptPreview) => channel.postMessage({kind:"preview",value}), close: () => channel.close() };
}
export function dismissLocalReceipt(token: string, cartId: string) {
  const channel = new BroadcastChannel(`kingpos:receipt:v1:${token}`);
  channel.postMessage({kind:"dismiss-completed",cartId}); channel.close();
}
export function requestLocalReceiptCustomer(token: string, preview: LocalReceiptPreview, customer: LocalCustomerRequest["customer"]) {
  return new Promise<boolean>(resolve => {
    const channel = new BroadcastChannel(`kingpos:receipt:v1:${token}`);
    const id = crypto.randomUUID();
    const finish = (accepted: boolean) => { clearTimeout(timeout); channel.close(); resolve(accepted); };
    const timeout = setTimeout(() => finish(false), 2000);
    channel.onmessage = ({data}) => { if (data?.kind === "customer-ack" && data.id === id) finish(data.accepted === true); };
    channel.postMessage({kind:"customer",value:{id,cartId:preview.cartId,revision:preview.revision,customer}});
  });
}
export function localReceiptSnapshot(baseline: PosLiveDraftView | null, value: LocalReceiptPreview): PosLiveDraftView {
  const p = value.payload;
  // A local display must be usable before its first cloud read completes.
  // These display-only identifiers never authorize or finalize a payment.
  return { id: value.cartId, token: p.token, salon_id: "", version: 0,
    customer_version: 0, receipt_version: 0, last_customer_action_id: null, last_tip_action_id: null,
    server_now: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...baseline, customer: p.customer, selected_staff_id: p.selectedStaffId,
    staff_lines: p.staffLines, discount: p.discount, subtotal: p.subtotal, tax: p.tax, tip: p.tip,
    total: p.total, total_before_tip: p.totalBeforeTip, status: value.completedAt ? "closed" : "draft",
    completed_at: value.completedAt ?? null, reset_at: value.resetAt ?? null,
    customer_handoff_started_at: p.staffLines.length ? baseline?.customer_handoff_started_at ?? null : null };
}
export function requestLocalReceiptTip(token: string, preview: LocalReceiptPreview, amount: number) {
  return new Promise<boolean>(resolve => {
    const channel = new BroadcastChannel(`kingpos:receipt:v1:${token}`);
    const id = crypto.randomUUID();
    const finish = (accepted: boolean) => { clearTimeout(timeout); channel.close(); resolve(accepted); };
    const timeout = setTimeout(() => finish(false), 2000);
    channel.onmessage = ({data}) => { if (data?.kind === "tip-ack" && data.id === id) finish(data.accepted === true); };
    channel.postMessage({kind:"tip",value:{id,cartId:preview.cartId,revision:preview.revision,amount}});
  });
}

// Same origin / browser profile only. Separate devices still use Supabase.
// Only server-confirmed snapshots travel here; this channel cannot authorize
// a payment or turn an unconfirmed tip into a confirmed one.
export function publishLocalDisplaySnapshot(snapshot: PosLiveDraftView) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(`kingpos:display:v1:${snapshot.token}`);
  channel.postMessage({ kind: "snapshot", snapshot });
  channel.close();
}

export function subscribeLocalDisplay(token: string, receive: (snapshot: PosLiveDraftView) => void) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(`kingpos:display:v1:${token}`);
  channel.onmessage = ({ data }) => {
    const snapshot = data?.snapshot;
    if (data?.kind !== "snapshot" || snapshot?.token !== token ||
        !Number.isSafeInteger(snapshot.version) || !Array.isArray(snapshot.staff_lines) ||
        !["draft", "closed"].includes(snapshot.status) || !Number.isFinite(snapshot.total)) return;
    receive(snapshot);
  };
  return () => channel.close();
}
