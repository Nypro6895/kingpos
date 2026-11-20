import "server-only";

import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export type MarketBillingSettings = {
  enabled: boolean;
  default_bank_account_id: string | null;
  order_expiry_hours: number;
  tax_bps: number;
  fee_bps: number;
  fixed_fee_cents: number;
  tax_label: string;
  version: number;
};

export type MarketBankAccount = {
  id: string;
  label: string;
  bank_name: string;
  beneficiary: string;
  account_number: string;
  routing: string;
  instructions: string;
  active: boolean;
  version: number;
};

export type MarketBillingCatalogItem = {
  plugin_id: string;
  name: string;
  publisher: string;
  price_cents: number;
  interval: "month";
  published: boolean;
  fulfillment_ready: boolean;
  monthly_sms_limit?:number;
  commission_bps: number;
  version: number;
};

export type MarketBillingReceipt = {
  id: string;
  order_id: string;
  bank_reference: string;
  amount_cents: number;
  applied_cents: number;
  unapplied_cents: number;
  received_at: string;
  note: string | null;
};

export type MarketBillingOrder = {
  id: string;
  reference: string;
  salon_id: string;
  payer_id: string;
  plugin_id: string;
  plugin_name: string;
  publisher: string;
  base_cents: number;
  tax_cents: number;
  fee_cents: number;
  total_cents: number;
  received_cents: number;
  refunded_cents: number;
  refunded_applied_cents: number;
  unapplied_cents: number;
  bank_account_id: string;
  currency: "USD";
  status: string;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
  service_start: string | null;
  service_end: string | null;
  snapshot: Record<string, unknown>;
  salon_name?: string;
  payer_name?: string;
};

export type MarketBillingLedgerEntry = {
  id: string;
  kind: "cash_in" | "cash_out" | "expense";
  amount_cents: number;
  order_id: string | null;
  receipt_id: string | null;
  refund_id: string | null;
  bank_account_id: string;
  bank_reference: string;
  occurred_at: string;
  note: string | null;
  created_at: string;
  revenue_cents: number;
  tax_cents: number;
  fee_cents: number;
  commission_cents: number;
  publisher_payable_cents: number;
  unapplied_cents: number;
};

export type MarketBillingRefund = {
  id: string;
  order_id: string;
  amount_cents: number;
  status: "pending" | "completed" | "cancelled";
  reason: string;
  bank_reference: string | null;
  created_at: string;
};

export type MarketBillingSummary = {
  cash_in_cents?: number;
  cash_out_cents?: number;
  net_cash_cents?: number;
  revenue_cents?: number;
  unapplied_cents?: number;
  expense_cents?: number;
  customer_deposit_cents?: number;
  total_liability_cents?: number;
  tax_cents?: number;
  fee_cents?: number;
  publisher_payable_cents?: number;
  commission_cents?: number;
  pending_refund_cents?: number;
  awaiting_payment_count?: number;
  paid_order_count?: number;
};

export type MarketBillingAdminState = {
  settings: MarketBillingSettings;
  bank_accounts: MarketBankAccount[];
  catalog: MarketBillingCatalogItem[];
  orders: MarketBillingOrder[];
  receipts: MarketBillingReceipt[];
  ledger: MarketBillingLedgerEntry[];
  refunds: MarketBillingRefund[];
  summary: MarketBillingSummary;
  truncated?: boolean;
};

export async function loadMarketBillingAdminState(): Promise<MarketBillingAdminState> {
  const actor = await requirePlatformAdmin(P.teamManage);
  if (actor.roleSlug !== "platform_owner") notFound();
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Sign in again to manage Market payments.");
  const { data, error } = await client.rpc("market_billing_admin_state");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Market payment management is temporarily unavailable. Please try again.");
  }
  const state = data as MarketBillingAdminState;
  if (!state.settings || !Array.isArray(state.bank_accounts) || !Array.isArray(state.catalog)
    || !Array.isArray(state.orders) || !Array.isArray(state.receipts) || !Array.isArray(state.ledger) || !Array.isArray(state.refunds)
    || !state.summary) {
    throw new Error("Market payment management could not load completely. Please refresh.");
  }
  return state;
}
