export const TAX_COMPANY_PLUGIN = "tax-company";
export const TAX_COMPANY_MONTHLY_CENTS = 790;
export type TaxCompanyState = { active: boolean; subscribed: boolean };
export type TaxCompanyNote = { content: string; version: number; updated_at: string | null };
export type TaxCompanySalon = {
  id: string; name: string; active: boolean; connected_at: string;
  address_line1: string | null; address_line2: string | null; city: string | null;
  state: string | null; postal_code: string | null; country: string; phone: string | null;
  cycle_type: "monthly" | "semi_monthly" | "biweekly";
};
