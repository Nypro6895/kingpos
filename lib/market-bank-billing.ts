import "server-only";
import { marketPluginContext } from "@/lib/market-plugins";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  MarketBankBillingState, MarketBankCatalogItem, MarketBankOrder, MarketBankOrderStatus,
} from "@/types/market-bank-billing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set<MarketBankOrderStatus>([
  "awaiting_payment", "partially_paid", "paid", "cancelled", "expired",
  "refund_pending", "partially_refunded", "refunded",
]);
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function string(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
function integer(value: unknown, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : fallback;
}
function date(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export function unavailableMarketBankBilling(
  unavailableReason: MarketBankBillingState["unavailable_reason"] = "unavailable",
  reason = "Bank payments are temporarily unavailable. Please try again later.",
): MarketBankBillingState {
  return {
    available: false, salon_id: null, reason, unavailable_reason: unavailableReason,
    settings: { enabled: false, ready: false, currency: "USD", order_expiry_hours: 72,
      tax_bps: 0, fee_bps: 0, fixed_fee_cents: 0, tax_label: "Tax", version: 0 },
    catalog: [], orders: [],
  };
}

export function normalizeMarketBankOrder(value: unknown): MarketBankOrder | null {
  const row = object(value), snapshot = object(row.snapshot), bank = object(snapshot.bank);
  const status = string(row.status) as MarketBankOrderStatus;
  if (!UUID.test(string(row.id)) || !UUID.test(string(row.salon_id)) || !STATUSES.has(status)
    || row.currency !== "USD" || !string(row.reference) || !string(row.plugin_id)
    || !date(row.created_at) || !date(row.expires_at)) return null;
  for (const field of ["base_cents", "tax_cents", "fee_cents", "total_cents", "received_cents", "refunded_cents"]) {
    if (integer(row[field], -1) < 0) return null;
  }
  if (Number(row.total_cents) !== Number(row.base_cents) + Number(row.tax_cents) + Number(row.fee_cents)) return null;
  return {
    id: string(row.id), reference: string(row.reference), salon_id: string(row.salon_id),
    plugin_id: string(row.plugin_id), plugin_name: string(row.plugin_name, string(row.plugin_id)),
    publisher: string(row.publisher, "Reylumi"), bank_account_id: UUID.test(string(row.bank_account_id)) ? string(row.bank_account_id) : null,
    snapshot: {
      bank: {
        id: string(bank.id), label: string(bank.label), bank_name: string(bank.bank_name),
        beneficiary: string(bank.beneficiary), account_number: string(bank.account_number),
        routing: string(bank.routing), instructions: string(bank.instructions), version: integer(bank.version),
      },
      currency: "USD", interval: "month", tax_bps: integer(snapshot.tax_bps, 0, 10000),
      fee_bps: integer(snapshot.fee_bps, 0, 10000), fixed_fee_cents: integer(snapshot.fixed_fee_cents),
      tax_label: string(snapshot.tax_label, "Tax"), settings_version: integer(snapshot.settings_version),
      catalog_version: integer(snapshot.catalog_version),
      ...(row.plugin_id === "booksms" ? {monthly_sms_limit:integer(snapshot.monthly_sms_limit)} : {}), commission_bps: integer(snapshot.commission_bps, 0, 10000),
    },
    base_cents: integer(row.base_cents), tax_cents: integer(row.tax_cents), fee_cents: integer(row.fee_cents),
    total_cents: integer(row.total_cents), received_cents: integer(row.received_cents),
    unapplied_cents: integer(row.unapplied_cents), refunded_cents: integer(row.refunded_cents),
    refunded_applied_cents: integer(row.refunded_applied_cents),
    currency: "USD", status, created_at: date(row.created_at)!, expires_at: date(row.expires_at)!,
    paid_at: date(row.paid_at), service_start: date(row.service_start), service_end: date(row.service_end),
  };
}

export function normalizeMarketBankBillingState(value: unknown, salonId: string | null): MarketBankBillingState {
  const row = object(value), settings = object(row.settings);
  if ((salonId !== null && !UUID.test(salonId)) || !Array.isArray(row.catalog) || !Array.isArray(row.orders)
    || settings.currency !== "USD" || typeof settings.enabled !== "boolean" || typeof settings.ready !== "boolean"
    || integer(settings.tax_bps, -1, 10000) < 0 || integer(settings.fee_bps, -1, 10000) < 0
    || integer(settings.fixed_fee_cents, -1, 100_000_000) < 0) {
    return unavailableMarketBankBilling();
  }
  const catalog: MarketBankCatalogItem[] = row.catalog.flatMap(value => {
    const item = object(value);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(string(item.plugin_id)) || item.interval !== "month"
      || integer(item.price_cents, -1, 100_000_000) < 0) return [];
    return [{ plugin_id: string(item.plugin_id), name: string(item.name, string(item.plugin_id)),
      publisher: string(item.publisher, "Reylumi"), price_cents: integer(item.price_cents), interval: "month" as const,
      published: item.published === true, fulfillment_ready: item.fulfillment_ready === true,
      ...(item.plugin_id === "booksms" ? {monthly_sms_limit:integer(item.monthly_sms_limit)} : {}),
      commission_bps: integer(item.commission_bps, 0, 10000), version: integer(item.version) }];
  });
  return {
    available: true, salon_id: salonId,
    reason: salonId ? null : "Choose an active salon in your Owner workspace to pay by bank transfer.",
    unavailable_reason: salonId ? null : "owner_required",
    settings: {
      enabled: settings.enabled, ready: settings.ready, currency: "USD",
      order_expiry_hours: integer(settings.order_expiry_hours, 72, 8760),
      tax_bps: integer(settings.tax_bps), fee_bps: integer(settings.fee_bps),
      fixed_fee_cents: integer(settings.fixed_fee_cents), tax_label: string(settings.tax_label, "Tax"),
      version: integer(settings.version),
    },
    catalog,
    hidden_plugin_ids: Array.isArray(row.hidden_plugin_ids) ? row.hidden_plugin_ids.filter((id): id is string => typeof id === "string" && /^[a-z][a-z0-9-]{1,79}$/.test(id)) : [],
    // Explicit projection excludes payer identities, admin notes and payout records.
    orders: salonId ? row.orders.map(normalizeMarketBankOrder).filter((order): order is MarketBankOrder => order !== null && order.salon_id === salonId) : [],
  };
}

export async function marketBankPublicCatalog(): Promise<MarketBankBillingState> {
  try {
    const client = createSupabaseServerClient();
    if (!client) return unavailableMarketBankBilling();
    const { data, error } = await client.rpc("market_billing_public_catalog");
    if (error) {
      const missing = ["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code ?? "");
      return unavailableMarketBankBilling(missing ? "setup_required" : "unavailable", marketBankBillingError(error));
    }
    // The public RPC contains no bank or orders; always project it without owner data.
    return normalizeMarketBankBillingState({ ...object(data), orders: [] }, null);
  } catch { return unavailableMarketBankBilling(); }
}

export function marketBankBillingError(error: { code?: string; message?: string } | null | undefined) {
  if (error && ["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code ?? "")) {
    return "Bank payment setup is being completed. Please try again later.";
  }
  if (error && ["P0001", "22023", "42501", "40001"].includes(error.code ?? "")
    && error.message && error.message.length < 500 && !/\b(?:relation|column|schema|syntax|function|sql|constraint)\b/i.test(error.message)) {
    return error.message;
  }
  return "Bank payment could not be updated. Please refresh and try again.";
}

export async function marketBankBillingState(salonId?: string | null): Promise<MarketBankBillingState> {
  let context;
  try { context = await marketPluginContext(); }
  catch { return marketBankPublicCatalog(); }
  if (salonId && salonId !== context.salonId) {
    return unavailableMarketBankBilling("owner_required", "Choose the salon you want to manage in your Owner workspace.");
  }
  try {
    const { data, error } = await context.client.rpc("market_billing_owner_state", { p_salon: context.salonId });
    if (error) {
      const missing = ["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code ?? "");
      return unavailableMarketBankBilling(missing ? "setup_required" : "unavailable", marketBankBillingError(error));
    }
    return normalizeMarketBankBillingState(data, context.salonId);
  } catch { return unavailableMarketBankBilling(); }
}
