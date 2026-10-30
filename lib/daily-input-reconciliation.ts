export type DailyInputReconciliation = {
  businessDate: string;
  grossService: number;
  discount: number;
  expectedService: number;
  expectedTip: number;
  actualService: number | null;
  actualTip: number | null;
  serviceDifference: number | null;
  tipDifference: number | null;
  staffInputs: Array<{staff_id: string; staff_name: string; service_total: number; tip_amount: number}>;
  closingInputs: {cashAmount: number; creditCardAmount: number; otherAmount: number; tipInput: number | null; entered: boolean; note: string | null; status: PosDailyClosingStatus};
};

export function independentDailyBalances(input: {grossService: number; discount: number; assignedTips: number; cash: number; card: number; other: number; serviceEntered: boolean; tipInput: number | null}) {
  const cents = (value: number) => Math.round(value * 100);
  const expected = cents(input.grossService) - cents(input.discount);
  const actual = cents(input.cash) + cents(input.card) + cents(input.other);
  return {expectedService: expected / 100, expectedTip: cents(input.assignedTips) / 100,
    serviceDifference: input.serviceEntered ? (actual - expected) / 100 : null,
    tipDifference: input.tipInput === null ? null : (cents(input.tipInput) - cents(input.assignedTips)) / 100};
}
import type { PosDailyClosingStatus } from "@/types/pos-daily-closing";
