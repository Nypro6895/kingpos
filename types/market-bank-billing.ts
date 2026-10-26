export type MarketBankOrderStatus =
  | "awaiting_payment" | "partially_paid" | "paid" | "cancelled" | "expired"
  | "refund_pending" | "partially_refunded" | "refunded";

export type MarketReceivingBank = {
  id: string;
  label: string;
  bank_name: string;
  beneficiary: string;
  account_number: string;
  routing: string;
  instructions: string;
  version: number;
};

export type MarketBankBillingSettings = {
  enabled: boolean;
  ready: boolean;
  currency: "USD";
  order_expiry_hours: number;
  tax_bps: number;
  fee_bps: number;
  fixed_fee_cents: number;
  tax_label: string;
  version: number;
};

export type MarketBankCatalogItem = {
  plugin_id: string;
  name: string;
  publisher: string;
  price_cents: number;
  interval: "month";
  published: boolean;
  fulfillment_ready: boolean;
  commission_bps: number;
  version: number;
  monthly_sms_limit?:number;
};

export type MarketBankOrder = {
  id: string;
  reference: string;
  salon_id: string;
  plugin_id: string;
  plugin_name: string;
  publisher: string;
  bank_account_id: string | null;
  snapshot: {
    bank: MarketReceivingBank;
    currency: "USD";
    interval: "month";
    tax_bps: number;
    fee_bps: number;
    fixed_fee_cents: number;
    tax_label: string;
    settings_version: number;
    catalog_version: number;
    commission_bps: number;
    monthly_sms_limit?:number;
  };
  base_cents: number;
  tax_cents: number;
  fee_cents: number;
  total_cents: number;
  received_cents: number;
  unapplied_cents: number;
  refunded_cents: number;
  refunded_applied_cents: number;
  currency: "USD";
  status: MarketBankOrderStatus;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
  service_start: string | null;
  service_end: string | null;
};

export type MarketBankBillingState = {
  available: boolean;
  salon_id: string | null;
  settings: MarketBankBillingSettings;
  catalog: MarketBankCatalogItem[];
  hidden_plugin_ids?: string[];
  orders: MarketBankOrder[];
  reason: string | null;
  unavailable_reason: "setup_required" | "owner_required" | "unavailable" | null;
};

export type MarketBankPaymentActionResult = {
  order?: MarketBankOrder;
  state?: MarketBankBillingState;
  error?: string;
};
