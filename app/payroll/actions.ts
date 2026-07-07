"use server";

import {
  generatePayrollRun,
  lockPayrollRun,
  markPayrollRunPaid,
  recalculatePayrollRun,
  updatePayrollStaffLine,
  updateSalonPayrollSetting,
  updateStaffPayrollSetting,
} from "@/lib/payroll";
import type { PayrollCycleType, StaffPayType } from "@/types/payroll";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function readString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function readOptionalString(formData: FormData, key: string) {
  const value = readString(formData, key);
  return value || null;
}

function readNumber(formData: FormData, key: string, fallback = 0) {
  const value = readString(formData, key);
  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : fallback;
}

function readBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function readCycleType(formData: FormData) {
  const value = readString(formData, "cycle_type");

  if (value === "monthly" || value === "biweekly" || value === "custom") {
    return value satisfies PayrollCycleType;
  }

  return "monthly" satisfies PayrollCycleType;
}

function readPayType(formData: FormData) {
  const value = readString(formData, "pay_type");

  if (value === "fixed") {
    return "fixed" satisfies StaffPayType;
  }

  return "commission" satisfies StaffPayType;
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
  redirect(`${returnPath}${separator}error=${encodeURIComponent(message)}`);
}

function redirectAfterPayrollMutation(returnPath: string): never {
  revalidatePath("/payroll");
  revalidatePath("/payroll/tax-company");
  redirect(returnPath);
}

export async function generatePayroll(formData: FormData) {
  const returnPath = readReturnPath(formData);

  try {
    await generatePayrollRun({
      cycleType: readCycleType(formData),
      endDate: readString(formData, "period_end"),
      startDate: readString(formData, "period_start"),
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Unable to generate payroll.",
      returnPath,
    );
  }

  redirectAfterPayrollMutation(returnPath);
}

export async function recalculatePayroll(formData: FormData) {
  const returnPath = readReturnPath(formData);

  try {
    await recalculatePayrollRun(readString(formData, "payroll_run_id"));
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Unable to recalculate payroll.",
      returnPath,
    );
  }

  redirectAfterPayrollMutation(returnPath);
}

export async function lockPayroll(formData: FormData) {
  const returnPath = readReturnPath(formData);

  try {
    await lockPayrollRun(readString(formData, "payroll_run_id"));
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Unable to lock payroll.",
      returnPath,
    );
  }

  redirectAfterPayrollMutation(returnPath);
}

export async function markPayrollPaid(formData: FormData) {
  const returnPath = readReturnPath(formData);

  try {
    await markPayrollRunPaid(readString(formData, "payroll_run_id"));
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Unable to mark payroll paid.",
      returnPath,
    );
  }

  redirectAfterPayrollMutation(returnPath);
}

export async function savePayrollStaffLine(formData: FormData) {
  const returnPath = readReturnPath(formData);

  try {
    await updatePayrollStaffLine({
      bonusAmount: readNumber(formData, "bonus_amount"),
      checkNumber: readOptionalString(formData, "check_number"),
      lineId: readString(formData, "line_id"),
      note: readOptionalString(formData, "note"),
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Unable to save staff payroll line.",
      returnPath,
    );
  }

  redirectAfterPayrollMutation(returnPath);
}

export async function saveSalonPayrollSetting(formData: FormData) {
  const returnPath = readReturnPath(formData);
  const cycleType = readString(formData, "cycle_type") === "biweekly"
    ? "biweekly"
    : "monthly";

  try {
    await updateSalonPayrollSetting({
      biweeklyAnchorDate: readOptionalString(formData, "biweekly_anchor_date"),
      cycleType,
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Unable to save payroll settings.",
      returnPath,
    );
  }

  redirectAfterPayrollMutation(returnPath);
}

export async function saveStaffPayrollSetting(formData: FormData) {
  const returnPath = readReturnPath(formData);

  try {
    await updateStaffPayrollSetting({
      applyTaxToFixedPay: readBoolean(formData, "apply_tax_to_fixed_pay"),
      checkRate: readNumber(formData, "check_rate"),
      commissionRate: readNumber(formData, "commission_rate"),
      effectiveFrom: readString(formData, "effective_from"),
      fixedPayAmount: readNumber(formData, "fixed_pay_amount"),
      legalName: readOptionalString(formData, "legal_name"),
      payType: readPayType(formData),
      staffId: readString(formData, "staff_id"),
      taxCompanyEnabled: readBoolean(formData, "tax_company_enabled"),
      taxRate: readNumber(formData, "tax_rate"),
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Unable to save staff payroll setting.",
      returnPath,
    );
  }

  redirectAfterPayrollMutation(returnPath);
}
