import type { PosPayment } from "@/types/pos-payment";
import type {
  PosTicketDiscountType,
  PosTicketTipType,
} from "@/types/pos-ticket";

type TicketCalculationItem = {
  line_total: number;
};

type TicketCalculationPayment = Pick<PosPayment, "amount">;

type TicketCalculationInput = {
  discountType?: PosTicketDiscountType;
  discountValue?: number;
  items?: TicketCalculationItem[];
  payments?: TicketCalculationPayment[];
  taxRate?: number;
  tipType?: PosTicketTipType;
  tipValue?: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sumMoney(values: number[]) {
  return roundMoney(values.reduce((total, value) => total + value, 0));
}

export function calculateTicketTotals({
  discountType = "fixed_amount",
  discountValue = 0,
  items = [],
  payments = [],
  taxRate = 0,
  tipType = "fixed_amount",
  tipValue = 0,
}: TicketCalculationInput) {
  const subtotal = sumMoney(items.map((item) => item.line_total));
  const discount_amount =
    subtotal <= 0 || discountValue <= 0
      ? 0
      : discountType === "percentage"
        ? Math.min(subtotal, roundMoney((subtotal * discountValue) / 100))
        : Math.min(subtotal, roundMoney(discountValue));
  const taxable_amount = roundMoney(subtotal - discount_amount);
  const tax_amount =
    taxable_amount <= 0 || taxRate <= 0
      ? 0
      : roundMoney((taxable_amount * taxRate) / 100);
  const after_tax_amount = roundMoney(taxable_amount + tax_amount);
  const tip_amount =
    after_tax_amount <= 0 || tipValue <= 0
      ? 0
      : tipType === "percentage"
        ? roundMoney((after_tax_amount * tipValue) / 100)
        : roundMoney(tipValue);
  const total = roundMoney(after_tax_amount + tip_amount);
  const paid = sumMoney(payments.map((payment) => payment.amount));
  const remaining = roundMoney(total - paid);

  return {
    discount_amount,
    discount_type: discountType,
    discount_value: roundMoney(discountValue),
    paid,
    remaining,
    subtotal,
    tax_amount,
    tax_rate: roundMoney(taxRate),
    taxable_amount,
    tip_amount,
    tip_type: tipType,
    tip_value: roundMoney(tipValue),
    total,
  };
}
