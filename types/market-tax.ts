export type MarketTaxPriceBehavior = "exclusive" | "inclusive";

export type MarketTaxSettings = {
  enabled: boolean;
  price_behavior: MarketTaxPriceBehavior;
  default_tax_code: string | null;
  version: number;
  updated_at?: string;
};

export type MarketTaxProduct = {
  plugin_id: string;
  name: string;
  version: number | null;
  tax_code: string | null;
};

export type MarketTaxRegistration = {
  id: string;
  country: string;
  state: string | null;
  status: "active" | "scheduled" | "expired";
  active_from: number | string | null;
  expires_at: number | string | null;
};

export type MarketTaxProviderState = {
  connected: boolean;
  account_id: string | null;
  mode: "test" | "live" | null;
  status: "active" | "pending" | "unavailable";
  head_office: { country: string; state: string | null; city: string | null; postal_code: string | null; line1: string | null } | null;
  registrations: MarketTaxRegistration[];
  checked_at: string | null;
  error: string | null;
};

export type MarketTaxLedgerEntry = {
  id: string;
  invoice_id: string;
  purchase_id: string;
  kind: "sale" | "refund";
  country: string | null;
  state: string | null;
  jurisdiction: string | null;
  tax_cents: number;
  occurred_at: string;
  created_at: string;
};

export type MarketTaxJurisdictionSummary = {
  country: string | null;
  state: string | null;
  jurisdiction: string | null;
  sale_tax_cents: number;
  refunded_tax_cents: number;
  net_tax_cents: number;
};

export type MarketTaxSummary = {
  sale_tax_cents: number;
  refunded_tax_cents: number;
  net_tax_cents: number;
  invoice_count: number;
  reconciliation_required_count?: number;
  by_jurisdiction: MarketTaxJurisdictionSummary[];
};

export type MarketTaxCodeOption = { id: string; name: string; description?: string };

export type MarketTaxAdminState = {
  settings: MarketTaxSettings;
  products: MarketTaxProduct[];
  provider: MarketTaxProviderState;
  ledger: MarketTaxLedgerEntry[];
  summary: MarketTaxSummary;
  readiness_local: boolean;
  filters?: { from: string; to: string };
  tax_codes?: MarketTaxCodeOption[];
  row_count?: number;
  truncated?: boolean;
};
