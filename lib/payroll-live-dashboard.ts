import type { PayrollShopDailyRow, PayrollStaffLineWithDailyTotals } from "@/types/payroll";
import { moneyCents, sumMoney } from "./payroll-live-money";

export function hasCompletePayrollReceipts(rows: PayrollShopDailyRow[]) {
  const active = rows.filter(row => row.actualIncome !== null || row.actualTipIncome != null || moneyCents(row.posIncome) !== 0 || moneyCents(row.tips ?? 0) !== 0 || moneyCents(row.staffObligation ?? 0) !== 0);
  return active.length > 0 && active.every(row => row.actualIncome !== null && row.actualTipIncome != null);
}

export function payrollLiveDashboard(lines: PayrollStaffLineWithDailyTotals[], rows: PayrollShopDailyRow[], today: string) {
  const reports = rows.filter(row => row.actualIncome !== null);
  const cash = sumMoney(lines, line => line.final_cash_amount);
  const check = sumMoney(lines, line => line.final_check_amount);
  const tax = sumMoney(lines, line => line.tax_withheld);
  const staffCost = (moneyCents(cash) + moneyCents(check) + moneyCents(tax)) / 100;
  const collected = reports.length ? sumMoney(reports, row => row.actualIncome!) : null;
  const tipReports = rows.filter(row => row.actualTipIncome != null);
  const tipsCollected = tipReports.length ? sumMoney(tipReports, row => row.actualTipIncome!) : null;
  const receiptsComplete = hasCompletePayrollReceipts(rows);
  const differences = rows.filter(row => (row.difference !== null && moneyCents(row.difference) !== 0) || (row.tipDifference != null && moneyCents(row.tipDifference) !== 0));
  // Unentered future days are not missing reports. Unentered days with no activity
  // are not silently declared closed: list separately for Owner review.
  const missing = rows.filter(row => row.businessDate <= today && row.actualIncome === null);
  const missingTips = rows.filter(row => row.businessDate <= today && row.actualTipIncome == null && (row.actualIncome !== null || moneyCents(row.posIncome) !== 0 || moneyCents(row.tips ?? 0) !== 0 || moneyCents(row.staffObligation ?? 0) !== 0));
  const collectedDays = reports.filter(row => row.businessDate <= today);
  const openDays = collectedDays.filter(row => moneyCents(row.actualIncome!) !== 0 || moneyCents(row.posIncome) !== 0);
  const rankedDays = [...openDays].sort((a, b) => a.actualIncome! - b.actualIncome! || a.businessDate.localeCompare(b.businessDate));
  return {
    cash, check, tax, staffCost, collected, tipsCollected, receiptsComplete,
    remaining: !receiptsComplete || collected === null || tipsCollected === null ? null : (moneyCents(collected) + moneyCents(tipsCollected) - moneyCents(staffCost)) / 100,
    collectionCash: reports.length ? sumMoney(reports, row => row.cashAmount ?? 0) : null,
    collectionCard: reports.length ? sumMoney(reports, row => row.creditCardAmount ?? 0) : null,
    collectionOther: reports.length ? sumMoney(reports, row => row.otherAmount ?? 0) : null,
    differences, missing, missingTips,
    shortDays: differences.filter(row => (row.difference ?? 0) < 0 || (row.tipDifference ?? 0) < 0).length,
    overDays: differences.filter(row => (row.difference ?? 0) > 0 || (row.tipDifference ?? 0) > 0).length,
    difference: sumMoney(differences, row => row.difference ?? 0),
    enteredDays: collectedDays.length,
    elapsedDays: rows.filter(row => row.businessDate <= today).length,
    highest: rankedDays.at(-1) ?? null, lowest: rankedDays[0] ?? null,
  };
}
