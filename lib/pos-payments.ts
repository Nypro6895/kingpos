import "server-only";

import type { PosPaymentMethod } from "@/types/pos-payment";

export const POS_PAYMENT_SELECT =
  "id, salon_id, ticket_id, payment_method, amount, note, created_by, created_at";

export const POS_PAYMENT_METHOD_LABELS: Record<PosPaymentMethod, string> = {
  cash: "Cash",
  credit_card: "Credit Card",
  debit_card: "Debit Card",
  gift_card: "Gift Card",
  other: "Other",
};

export const POS_PAYMENT_METHOD_OPTIONS = Object.entries(
  POS_PAYMENT_METHOD_LABELS,
).map(([value, label]) => ({
  label,
  value: value as PosPaymentMethod,
}));
