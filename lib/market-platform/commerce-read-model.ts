import { responseUuid, developerMutationConfirmed } from "./mutation-confirmation";
import { readOwnerMarketplace } from "./owner-read-model";
import { inspectManifest } from "./manifest-preflight";
import type { OrderQuote } from "./stripe-test";

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const accountId = (v: unknown): v is string => typeof v === "string" && /^acct_[A-Za-z0-9]+$/.test(v);
const timestamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)) && Date.parse(v) <= Date.now() + 300000;
export type Seller = { organization_id: string; account_id: string | null; testEnabled: boolean; updated_at: string };
export function readSeller(value: unknown, organization: unknown): Seller | null {
  if (!responseUuid(organization) || !object(value) || value.organization_id !== organization || (value.account_id !== null && !accountId(value.account_id)) || typeof value.testEnabled !== "boolean" || !timestamp(value.updated_at)
    || ![value.charges_enabled, value.payouts_enabled, value.details_submitted].every(v => typeof v === "boolean")) return null;
  return { organization_id: organization, account_id: value.account_id as string | null, testEnabled: value.testEnabled, updated_at: value.updated_at };
}
export function readOrganization(value: unknown) { return object(value) && object(value.organization) && responseUuid(value.organization.id) ? value.organization.id : null; }
export function readCheckoutVersion(value: unknown, salon: string, version: string, sha256: string) {
  const market = readOwnerMarketplace(value, salon), selected = market?.catalog.find(v => v.id === version && v.sha256 === sha256);
  if (!market?.testPaymentsEnabled || !selected || !inspectManifest(JSON.stringify(selected.manifest)).ok || !developerMutationConfirmed("submit", selected, { p_app: selected.app_id, p_manifest: selected.manifest }) || selected.manifest.price.amountCents < 50) return null;
  return { amount: selected.manifest.price.amountCents, name: selected.manifest.name };
}
export function readSavedQuote(value: unknown, salon: string, version: string, approved: { amount: number; name: string }): OrderQuote | null {
  if (!object(value) || !responseUuid(value.id) || !responseUuid(value.buyer_id) || value.salon_id !== salon || value.version_id !== version || !accountId(value.account_id)
    || !Number.isSafeInteger(value.amount_cents) || value.amount_cents !== approved.amount || !Number.isSafeInteger(value.fee_cents) || (value.fee_cents as number) < 0 || (value.fee_cents as number) > approved.amount
    || (value.state !== "pending" && value.state !== "paid") || (value.checkout_id !== null && (typeof value.checkout_id !== "string" || !/^cs_test_[A-Za-z0-9]+$/.test(value.checkout_id)))
    || value.name !== approved.name || !timestamp(value.created_at) || (Object.hasOwn(value, "currency") && value.currency !== "usd")) return null;
  return { id: value.id, buyer_id: value.buyer_id, salon_id: salon, version_id: version, account_id: value.account_id, amount_cents: approved.amount, fee_cents: value.fee_cents as number, state: value.state as string, checkout_id: value.checkout_id as string | null, name: approved.name, created_at: value.created_at };
}
export function quoteMatchesStoredOrder(quote: OrderQuote, workspace: unknown) {
  if (!object(workspace) || !Array.isArray(workspace.orders)) return false;
  const rows = workspace.orders.filter(row => object(row) && row.id === quote.id);
  if (rows.length !== 1 || !object(rows[0])) return false;
  const row = rows[0];
  return ["salon_id", "version_id", "buyer_id", "account_id", "amount_cents", "fee_cents", "state", "checkout_id"].every(key => row[key] === quote[key as keyof OrderQuote])
    && timestamp(row.created_at) && Date.parse(row.created_at) === Date.parse(quote.created_at) && (!Object.hasOwn(row, "currency") || row.currency === "usd");
}
export function providerSellerMatches(value: unknown, organization: string, expectedAccount?: string): boolean {
  return object(value) && accountId(value.id) && (!expectedAccount || value.id === expectedAccount) && object(value.metadata) && value.metadata.market_platform_organization === organization
    && [value.charges_enabled, value.payouts_enabled, value.details_submitted].every(v => typeof v === "boolean");
}
export function checkoutMatches(value: unknown, quote: OrderQuote, expectedId?: string): boolean {
  return object(value) && typeof value.id === "string" && /^cs_test_[A-Za-z0-9]+$/.test(value.id) && (!expectedId || value.id === expectedId) && value.livemode === false && value.currency === "usd" && value.mode === "payment" && value.status === "open"
    && value.client_reference_id === quote.id && value.amount_total === quote.amount_cents && object(value.metadata) && value.metadata.market_platform_order === quote.id;
}

export type RefundIntent = { id: string; order_id: string; charge_id: string; amount_cents: number; status: string; refund_id: string | null; created_at: string; observed_at: string | null };
export type RefundQuote = { id: string; salon_id: string; version_id: string; buyer_id: string | null; account_id: string; amount_cents: number; fee_cents: number; state: string; checkout_id: string; charge_id: string; refunded_cents: number; disputed: boolean; transfer_id: string | null; created_at: string; observed_at: string; refund_intent: RefundIntent };
const chargeId = (v: unknown): v is string => typeof v === "string" && /^ch_[A-Za-z0-9]+$/.test(v);
const refundId = (v: unknown): v is string => typeof v === "string" && /^re_[A-Za-z0-9]+$/.test(v);
const refundStatuses = ["pending", "requires_action", "succeeded", "failed", "canceled"];
export function readRefundQuote(value: unknown, order: string): RefundQuote | null {
  if (!responseUuid(order) || !object(value) || value.id !== order || !responseUuid(value.salon_id) || !responseUuid(value.version_id)
    || (value.buyer_id !== null && !responseUuid(value.buyer_id)) || !accountId(value.account_id) || !chargeId(value.charge_id)
    || !Number.isSafeInteger(value.amount_cents) || (value.amount_cents as number) < 1 || !Number.isSafeInteger(value.fee_cents) || (value.fee_cents as number) < 0 || (value.fee_cents as number) > (value.amount_cents as number)
    || value.state !== "paid" || value.refunded_cents !== 0 || value.disputed !== false || typeof value.checkout_id !== "string" || !/^cs_test_[A-Za-z0-9]+$/.test(value.checkout_id)
    || (value.transfer_id !== null && (typeof value.transfer_id !== "string" || !/^tr_[A-Za-z0-9]+$/.test(value.transfer_id)))
    || !timestamp(value.created_at) || !timestamp(value.observed_at) || (Object.hasOwn(value,"currency") && value.currency !== "usd")) return null;
  const intent = value.refund_intent;
  if (!object(intent) || !responseUuid(intent.id) || intent.order_id !== order || intent.charge_id !== value.charge_id || intent.amount_cents !== value.amount_cents
    || !timestamp(intent.created_at) || Date.parse(intent.created_at) < Date.parse(value.created_at)
    || (intent.status === "requested" ? intent.refund_id !== null || intent.observed_at !== null
      : typeof intent.status !== "string" || !refundStatuses.includes(intent.status) || !refundId(intent.refund_id) || !timestamp(intent.observed_at))) return null;
  return value as RefundQuote;
}
export function refundMatchesStoredOrder(quote: RefundQuote, workspace: unknown) {
  if (!object(workspace) || workspace.testEnabled !== true || !Array.isArray(workspace.orders) || !Array.isArray(workspace.refundIntents)) return false;
  const orders = workspace.orders.filter(row => object(row) && row.id === quote.id), intents = workspace.refundIntents.filter(row => object(row) && row.order_id === quote.id);
  if (orders.length !== 1 || intents.length !== 1 || !object(orders[0]) || !object(intents[0])) return false;
  const row = orders[0], intent = intents[0];
  return ["id","salon_id","version_id","buyer_id","account_id","amount_cents","fee_cents","state","checkout_id","charge_id","refunded_cents","disputed","transfer_id"].every(key => row[key] === quote[key as keyof RefundQuote])
    && ["created_at","observed_at"].every(key => timestamp(row[key]) && Date.parse(row[key] as string) === Date.parse(quote[key as "created_at" | "observed_at"]))
    && (!Object.hasOwn(row,"currency") || row.currency === "usd")
    && ["id","order_id","charge_id","amount_cents","status","refund_id"].every(key => intent[key] === quote.refund_intent[key as keyof RefundIntent])
    && timestamp(intent.created_at) && Date.parse(intent.created_at) === Date.parse(quote.refund_intent.created_at)
    && (intent.observed_at === null ? quote.refund_intent.observed_at === null : timestamp(intent.observed_at) && Date.parse(intent.observed_at) === Date.parse(quote.refund_intent.observed_at ?? ""));
}
export function refundChargeMatches(value: unknown, quote: RefundQuote) {
  return object(value) && value.id === quote.charge_id && value.livemode === false && value.currency === "usd" && value.paid === true && value.disputed === false
    && value.amount === quote.amount_cents && Number.isSafeInteger(value.amount_refunded) && (value.amount_refunded as number) >= 0 && (value.amount_refunded as number) <= quote.amount_cents
    && value.application_fee_amount === quote.fee_cents && object(value.transfer_data) && value.transfer_data.destination === quote.account_id
    && (typeof value.transfer === "string" ? value.transfer : null) === quote.transfer_id;
}
export function readProviderRefund(value: unknown, quote: Pick<RefundQuote, "id" | "charge_id" | "amount_cents">, expectedId?: string): { id: string; status: string } | null {
  if (!object(value) || !refundId(value.id) || (expectedId && value.id !== expectedId) || value.charge !== quote.charge_id || value.amount !== quote.amount_cents
    || value.currency !== "usd" || !object(value.metadata) || value.metadata.market_platform_order !== quote.id
    || typeof value.status !== "string" || !refundStatuses.includes(value.status) || (Object.hasOwn(value,"livemode") && value.livemode !== false)) return null;
  // Stripe Refund has no guaranteed livemode attribute. The retrieved Charge,
  // isolated test key and platform identity establish test context instead.
  return { id: value.id, status: value.status };
}
