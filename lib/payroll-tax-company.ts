import type { PayrollPayoutMethod } from "@/types/payroll";

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type TaxCompanyReportingInput = {
  bonusAmount: number;
  bonusPayoutMethod: PayrollPayoutMethod;
  staffCommissionGross: number;
  taxBonus: boolean;
  taxCash: boolean;
  taxRate: number;
  taxTips: boolean;
  tipAmount: number;
  tipPayoutMethod: PayrollPayoutMethod;
  wageCashGross: number;
  wageCheckGross: number;
};

export type TaxCompanyReportingResult = {
  actualCheckPaid: number;
  bonusPaidByCash: number;
  bonusPaidByCheck: number;
  cashReported: number;
  checkAmountNegative: boolean;
  reportedBonus: number;
  reportedTip: number;
  reportedWageGross: number;
  taxableGross: number;
  taxAmount: number;
  tipPaidByCash: number;
  tipPaidByCheck: number;
  wageCashGross: number;
  wageCheckGross: number;
  wageCheckNet: number;
};

export function calculateTaxCompanyReporting(
  input: TaxCompanyReportingInput,
): TaxCompanyReportingResult {
  const staffCommissionGross = roundMoney(numberValue(input.staffCommissionGross));
  const wageCheckGross = roundMoney(numberValue(input.wageCheckGross));
  const wageCashGross = roundMoney(numberValue(input.wageCashGross));
  const tipAmount = roundMoney(numberValue(input.tipAmount));
  const bonusAmount = roundMoney(numberValue(input.bonusAmount));
  const taxRate = numberValue(input.taxRate);
  const tipPaidByCheck = input.tipPayoutMethod === "check" ? tipAmount : 0;
  const tipPaidByCash = input.tipPayoutMethod === "cash" ? tipAmount : 0;
  const bonusPaidByCheck =
    input.bonusPayoutMethod === "check" ? bonusAmount : 0;
  const bonusPaidByCash =
    input.bonusPayoutMethod === "cash" ? bonusAmount : 0;
  const reportedWageGross = input.taxCash
    ? staffCommissionGross
    : wageCheckGross;
  const reportedTip = input.taxTips ? tipAmount : 0;
  const reportedBonus = input.taxBonus ? bonusAmount : 0;
  const taxableGross = roundMoney(reportedWageGross + reportedTip + reportedBonus);
  const taxAmount = roundMoney((taxableGross * taxRate) / 100);
  const wageCheckNet = roundMoney(wageCheckGross - taxAmount);
  const actualCheckPaid = roundMoney(
    wageCheckGross + tipPaidByCheck + bonusPaidByCheck - taxAmount,
  );
  const cashReported = roundMoney(
    (input.taxCash ? wageCashGross : 0) +
      (input.taxTips && input.tipPayoutMethod === "cash" ? tipAmount : 0) +
      (input.taxBonus && input.bonusPayoutMethod === "cash" ? bonusAmount : 0),
  );

  return {
    actualCheckPaid,
    bonusPaidByCash,
    bonusPaidByCheck,
    cashReported,
    checkAmountNegative: actualCheckPaid < 0,
    reportedBonus,
    reportedTip,
    reportedWageGross: roundMoney(reportedWageGross),
    taxableGross,
    taxAmount,
    tipPaidByCash,
    tipPaidByCheck,
    wageCashGross,
    wageCheckGross,
    wageCheckNet,
  };
}
