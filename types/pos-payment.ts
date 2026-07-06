export const POS_PAYMENT_METHODS = [
  "cash",
  "credit_card",
  "debit_card",
  "gift_card",
  "other",
] as const;

export type PosPaymentMethod = (typeof POS_PAYMENT_METHODS)[number];

export type PosPayment = {
  id: string;
  organization_id: string;
  salon_id: string;
  ticket_id: string;
  payment_method: PosPaymentMethod;
  amount: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
};
