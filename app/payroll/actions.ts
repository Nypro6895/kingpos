"use server";

import {
  markPayrollStatementPaid as markPayrollStatementPaidInService,
  savePayrollStatementFromLivePayroll,
  updatePayrollPeriodStaffInput,
  updateSalonPayrollSetting,
  updateStaffPayrollSetting,
  uploadPayrollPaystub,
} from "@/lib/payroll";
import type {
  PayrollCycleType,
  PayrollPayoutMethod,
  StaffPayType,
} from "@/types/payroll";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(formData: FormData, key: string) {
  const value = readString(formData, key);
  return value ? value : null;
}

function readNumber(formData: FormData, key: string, fallback = 0) {
  const rawValue = readString(formData, key);
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function readFile(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File ? value : null;
}

function readCycleType(formData: FormData) {
  const value = readString(formData, "cycle_type");

  if (
    value === "monthly" ||
    value === "semi_monthly" ||
    value === "biweekly" ||
    value === "custom"
  ) {
    return value satisfies PayrollCycleType;
  }

  return "custom" satisfies PayrollCycleType;
}

function readScheduleCycleType(formData: FormData) {
  const value = readString(formData, "cycle_type");

  if (value === "biweekly") {
    return "biweekly" as const;
  }

  if (value === "semi_monthly") {
    return "semi_monthly" as const;
  }

  return "monthly" as const;
}

function readPayType(formData: FormData) {
  const value = readString(formData, "pay_type");

  if (value === "fixed") {
    return "fixed" satisfies StaffPayType;
  }

  return "commission" satisfies StaffPayType;
}

function readPayoutMethod(
  formData: FormData,
  key: string,
  fallback: PayrollPayoutMethod,
) {
  const value = readString(formData, key);

  if (value === "check" || value === "cash") {
    return value satisfies PayrollPayoutMethod;
  }

  return fallback;
}

function readReturnPath(formData: FormData) {
  const value = readString(formData, "return_to");

  if (value.startsWith("/payroll")) {
    return value;
  }

  return "/payroll";
}

function redirectWithError(message: string, returnPath: string): never {
  const separator = returnPath.includes("?") ? "&" : "?";
  redirect(`${returnPath}${separator}payroll_error=${encodeURIComponent(message)}`);
}

function redirectAfterPayrollMutation(returnPath: string): never {
  revalidatePath("/payroll");
  revalidatePath("/payroll/tax-company");
  redirect(returnPath);
}

export async function savePayrollStatementAction(formData: FormData) {
  const returnPath = readReturnPath(formData);

  try {
    await savePayrollStatementFromLivePayroll({
      cycleType: readCycleType(formData),
      endDate: readString(formData, "period_end"),
      startDate: readString(formData, "period_start"),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Payroll statement could not be saved.";
    redirectWithError(message, returnPath);
  }

  redirectAfterPayrollMutation(returnPath);
}

export async function markLatestPayrollStatementPaidAction(formData: FormData) {
  const returnPath = readReturnPath(formData);

  try {
    await markPayrollStatementPaidInService(readString(formData, "payroll_run_id"));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Payroll statement could not be marked paid.";
    redirectWithError(message, returnPath);
  }

  redirectAfterPayrollMutation(returnPath);
}

export async function savePayrollPeriodStaffInputAction(formData: FormData) {
  const returnPath = readReturnPath(formData);

  try {
    await updatePayrollPeriodStaffInput({
      bonusAmount: readNumber(formData, "bonus_amount"),
      checkNumber: readOptionalString(formData, "check_number"),
      cycleType: readCycleType(formData),
      endDate: readString(formData, "period_end"),
      note: readOptionalString(formData, "note"),
      staffId: readString(formData, "staff_id"),
      startDate: readString(formData, "period_start"),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Payroll staff input could not be saved.";
    redirectWithError(message, returnPath);
  }

  redirectAfterPayrollMutation(returnPath);
}

export async function saveSalonPayrollScheduleAction(formData: FormData) {
  const returnPath = readReturnPath(formData);

  try {
    await updateSalonPayrollSetting({
      biweeklyAnchorDate: readOptionalString(formData, "biweekly_anchor_date"),
      cycleType: readScheduleCycleType(formData),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Payroll schedule could not be saved.";
    redirectWithError(message, returnPath);
  }

  redirectAfterPayrollMutation(returnPath);
}

export async function saveStaffPayrollSettingWithEffectiveDateAction(
  formData: FormData,
) {
  const returnPath = readReturnPath(formData);

  try {
    await updateStaffPayrollSetting({
      applyTaxToFixedPay: readBoolean(formData, "apply_tax_to_fixed_pay"),
      bonusPayoutMethod: readPayoutMethod(
        formData,
        "bonus_payout_method",
        "check",
      ),
      cashToTaxCompany: readBoolean(formData, "cash_to_tax_company"),
      checkRate: readNumber(formData, "check_rate", 60),
      commissionRate: readNumber(formData, "commission_rate", 60),
      effectiveFrom: readString(formData, "effective_from"),
      fixedPayAmount: readNumber(formData, "fixed_pay_amount"),
      legalName: readOptionalString(formData, "legal_name"),
      payType: readPayType(formData),
      staffId: readString(formData, "staff_id"),
      taxBonus: readBoolean(formData, "tax_bonus"),
      taxRate: readNumber(formData, "tax_rate"),
      taxTips: readBoolean(formData, "tax_tips"),
      tipPayoutMethod: readPayoutMethod(formData, "tip_payout_method", "cash"),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Payroll staff setting could not be saved.";
    redirectWithError(message, returnPath);
  }

  redirectAfterPayrollMutation(returnPath);
}

export async function uploadPayrollPaystubAction(formData: FormData) {
  const returnPath = readReturnPath(formData);
  const file = readFile(formData, "paystub_file");

  try {
    if (!file) {
      throw new Error("Choose a paystub file to upload.");
    }

    await uploadPayrollPaystub({
      file,
      payrollRunId: readString(formData, "payroll_run_id"),
      staffId: readString(formData, "staff_id"),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Paystub could not be uploaded.";
    redirectWithError(message, returnPath);
  }

  redirectAfterPayrollMutation(returnPath);
}
