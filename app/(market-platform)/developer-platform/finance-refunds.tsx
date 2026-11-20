import type { CommerceWorkspace } from "@/lib/market-platform/server";
import { DeveloperText } from "./sections";
import { PlatformForm } from "./form";

type Order = CommerceWorkspace["orders"][number];
const statuses: Record<string, string> = { requested: "Refund request saved", pending: "Provider refund pending", requires_action: "Provider refund needs action", succeeded: "Provider reports refund succeeded", failed: "Provider reports refund failed", canceled: "Provider reports refund canceled" };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export function FinanceRefundOrder({ order, intents, enabled }: { order: Order; intents: unknown; enabled: boolean }) {
  const matches = Array.isArray(intents) ? intents.filter(v => object(v) && v.order_id === order.id) : [];
  const intent = matches[0];
  const known = Array.isArray(intents) && intents.every(v => object(v) && typeof v.order_id === "string") && matches.length <= 1 && (matches.length === 0 || (object(intent) && typeof intent.id === "string" && /^[a-f0-9-]{36}$/i.test(intent.id) && intent.charge_id === order.charge_id && intent.amount_cents === order.amount_cents && typeof intent.status === "string" && Object.hasOwn(statuses, intent.status)));
  const status = known && object(intent) ? intent.status as string : null;
  const terminal = status !== null && ["succeeded", "failed", "canceled"].includes(status);
  const refundable = enabled && known && Number.isSafeInteger(order.amount_cents) && order.amount_cents > 0 && Number.isSafeInteger(order.fee_cents) && order.fee_cents >= 0 && order.fee_cents <= order.amount_cents && order.state === "paid" && order.disputed === false && order.refunded_cents === 0 && !terminal;
  const money = (value: number) => Number.isSafeInteger(value) && value >= 0 ? `$${(value / 100).toFixed(2)} USD` : "—";
  return <article><p><code>{order.id}</code> · {order.state} · {money(order.amount_cents)} · <DeveloperText text="Refunded principal" /> {money(order.refunded_cents)}</p>
    {!known && <p role="alert"><DeveloperText text="Refund request history could not be verified. Reload and reconcile before continuing." /></p>}
    {known && status && <><p role="status"><strong><DeveloperText text={statuses[status]} /></strong></p><p><DeveloperText text="A saved request or provider status is not bank settlement. Access changes only after the authoritative charge is reconciled." /></p></>}
    {terminal && <p><DeveloperText text="Do not create another refund for this request. Review the provider record and reconciliation result." /></p>}
    {!enabled && <p><DeveloperText text="Test commerce is disabled. Refund requests are unavailable." /></p>}
    {refundable && <PlatformForm operation="refund" label={status ? "Continue or reconcile test refund" : "Request full test refund"}><input type="hidden" name="order" value={order.id} /><label><input type="checkbox" name="confirm" value="yes" required /><DeveloperText text="Refund the entire test charge, reverse the seller transfer, and refund the application fee." /></label>{status && <p><DeveloperText text="The existing request is reused. An unresolved or stale request may require support instead of another provider POST." /></p>}</PlatformForm>}
  </article>;
}
