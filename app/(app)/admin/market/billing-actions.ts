"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { AdminActionResult } from "../_components/action-form";

const MAX_CENTS = 100_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(form: FormData, key: string, label: string, max: number, required = false) {
  const value = form.get(key);
  if (typeof value !== "string" || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new Error(`${label}: enter valid text, up to ${max} characters.`);
  }
  const clean = value.trim();
  if (required && !clean) throw new Error(`${label} is required.`);
  return clean;
}

function id(form: FormData, key: string, label: string, optional = false) {
  const value = text(form, key, label, 36, !optional);
  if (optional && !value) return null;
  if (!UUID.test(value)) throw new Error(`${label} is invalid. Refresh and try again.`);
  return value;
}

function integer(form: FormData, key: string, label: string, min: number, max: number) {
  const value = form.get(key);
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value)) throw new Error(`${label}: enter a whole number.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${label}: enter a value from ${min} to ${max}.`);
  return result;
}

function units(form: FormData, key: string, label: string, max: number, positive = false) {
  const value = form.get(key);
  if (typeof value !== "string" || !/^\d{1,7}(\.\d{1,2})?$/.test(value.trim())) {
    throw new Error(`${label}: enter an amount with up to two decimal places.`);
  }
  const [whole, decimal = ""] = value.trim().split(".");
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (amount > max || (positive && amount === 0)) throw new Error(`${label}: enter an amount ${positive ? "greater than zero and " : ""}up to ${max / 100}.`);
  return amount;
}

function checked(form: FormData, key: string) {
  const value = form.get(key);
  if (value === null) return false;
  if (value !== "on") throw new Error("A selected option is invalid. Refresh and try again.");
  return true;
}

function dateTime(form: FormData, key: string) {
  const value = text(form, key, "Bank transaction time", 40, true);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(value)) {
    throw new Error("Choose a valid bank transaction date and time.");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16) !== value.slice(0, 16)
    || date.getTime() > Date.now() + 5 * 60_000 || date.getFullYear() < 2000) {
    throw new Error("Bank transaction time must be a valid past date and time.");
  }
  return date.toISOString();
}

function friendlyFailure(error: { code?: string; message?: string } | null) {
  const message = error?.message ?? "";
  if (/version|changed|stale|conflict/i.test(message) || error?.code === "40001") return "Another admin changed this record. Refresh the page before saving again.";
  if (/duplicate|already.*record|reference.*used/i.test(message) || error?.code === "23505") return "This bank transaction has already been recorded. Check the existing receipt before trying again.";
  if (/default.*bank|bank.*complete|bank.*active|receiving.*bank/i.test(message)) return "Select a complete, active receiving bank account before enabling customer payments.";
  if (/select another receiving account|disabling this account/i.test(message)) return "Select another default account or pause bank payments before deactivating this account.";
  if (/pending refund/i.test(message)) return "Complete or cancel the pending refund request before creating another one.";
  if (/refund.*balance|refund.*amount|refund.*available|insufficient|exceed.*refund|exceed.*receiv|funds are no longer available/i.test(message)) return "The refund exceeds the available received balance. Refresh the order and check pending refunds.";
  if (/time.*precede|predating/i.test(message)) return "A receipt must arrive on or after this order was created. Check the bank transaction date and time.";
  if (/not.*ready|fulfillment|unreleased/i.test(message)) return "This plugin is a preview. Paid sales become available after fulfillment is ready.";
  if (/expired|late.*receipt/i.test(message)) return "This order has expired. Review the late payment and use a refund where needed.";
  if (/cancel|status|settled|already.*paid|already.*complete/i.test(message)) return "The order status has changed. Refresh and review its current payment history.";
  return "The change could not be saved. Refresh the page, check the details and try again.";
}

async function mutation(
  rpc: string,
  prepare: () => Record<string, unknown>,
  success: string,
): Promise<AdminActionResult> {
  const actor = await requirePlatformAdmin(P.teamManage);
  if (actor.roleSlug !== "platform_owner") notFound();
  let values: Record<string, unknown>;
  try { values = prepare(); } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Check the entered details." };
  }
  try {
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client) return { ok: false, message: "Sign in again to manage Market payments." };
    const { error } = await client.rpc(rpc, values);
    if (error) return { ok: false, message: friendlyFailure(error) };
    revalidatePath("/admin/market"); revalidatePath("/admin/settings");
    revalidatePath("/market");
    revalidatePath("/settings/plugins");
    return { ok: true, message: success };
  } catch {
    return { ok: false, message: "Payment management is temporarily unavailable. Please try again." };
  }
}

export async function saveMarketBillingSettings(form: FormData): Promise<AdminActionResult> {
  return mutation("market_billing_save_settings", () => ({
    p_version: integer(form, "version", "Settings version", 1, 2_147_483_647),
    p_settings: {
      enabled: checked(form, "enabled"),
      default_bank_account_id: id(form, "default_bank_account_id", "Receiving account", true),
      order_expiry_hours: integer(form, "order_expiry_hours", "Payment deadline in hours", 1, 720),
      tax_bps: units(form, "tax", "Tax (%)", 10_000),
      fee_bps: units(form, "fee", "Transaction fee (%)", 10_000),
      fixed_fee_cents: units(form, "fixed", "Fixed transaction fee (USD)", MAX_CENTS),
      tax_label: text(form, "tax_label", "Tax label", 80, true),
    },
  }), "Payment settings saved. New orders use this configuration; existing orders keep their original price and receiving account.");
}

export async function saveMarketBankAccount(form: FormData): Promise<AdminActionResult> {
  return mutation("market_billing_save_bank", () => {
    const accountId = id(form, "bank_id", "Bank account", true);
    const active = checked(form, "active");
    return {
      p_version: accountId ? integer(form, "version", "Account version", 1, 2_147_483_647) : null,
      p_bank: {
        id: accountId,
        label: text(form, "label", "Account label", 120, true),
        bank_name: text(form, "bank_name", "Bank name", 160, true),
        beneficiary: text(form, "beneficiary", "Account holder", 160, true),
        account_number: (() => {
          const number = text(form, "account_number", "Account number / IBAN", 100, true);
          if (number.length < 3) throw new Error("Account number / IBAN must have at least three characters.");
          return number;
        })(),
        routing: text(form, "routing", "Routing / SWIFT", 100),
        instructions: text(form, "instructions", "Transfer instructions", 2000),
        active,
      },
    };
  }, "Receiving account saved. Existing orders keep the bank details shown when they were created.");
}

export async function saveMarketBillingCatalog(form: FormData): Promise<AdminActionResult> {
  return mutation("market_billing_save_catalog", () => {
    const plugin = text(form, "plugin_id", "Plugin identifier", 80, true);
    if (!/^[a-z][a-z0-9-]{1,79}$/.test(plugin)) throw new Error("Plugin identifier: use 2–80 lowercase letters, numbers or hyphens, starting with a letter.");
    const isNew = form.get("version") === "";
    return {
      p_plugin: plugin,
      p_version: isNew ? null : integer(form, "version", "Price version", 1, 2_147_483_647),
      p_values: {
        price_cents: units(form, "price", "Monthly price (USD)", MAX_CENTS, true),
        published: checked(form, "published"),
        ...(plugin === "booksms" ? {monthly_sms_limit:integer(form,"monthly_sms_limit","Monthly SMS allowance",0,1000000),fulfillment_ready:checked(form,"fulfillment_ready")} : {}),
        commission_bps: units(form, "commission", "Platform commission (%)", 10_000),
        ...(isNew ? {
          name: text(form, "name", "Plugin name", 160, true),
          publisher: text(form, "publisher", "Publisher name", 160, true),
          fulfillment_ready: false,
        } : {}),
      },
    };
  }, form.get("version") === "" ? "External plugin preview prepared. Paid checkout remains unavailable until its activation and expiry integration is released." : "Plugin price and visibility saved. New orders use the new price; existing orders are unchanged.");
}

export async function recordMarketBankReceipt(form: FormData): Promise<AdminActionResult> {
  return mutation("market_billing_record_receipt", () => {
    if (!checked(form, "bank_verified")) throw new Error("Verify that the money arrived in the receiving bank account before recording this receipt.");
    return {
      p_order: id(form, "order_id", "Order"),
      p_bank_reference: text(form, "bank_reference", "Bank transaction reference", 160, true),
      p_amount_cents: units(form, "amount", "Received amount (USD)", MAX_CENTS, true),
      p_received_at: dateTime(form, "received_at"),
      p_note: text(form, "note", "Reconciliation note", 2000, true),
    };
  }, "Bank receipt recorded. The order is activated only when its required payment is fully covered and eligible.");
}

export async function requestMarketBillingRefund(form: FormData): Promise<AdminActionResult> {
  return mutation("market_billing_request_refund", () => ({
    p_order: id(form, "order_id", "Order"),
    p_amount_cents: units(form, "amount", "Refund amount (USD)", MAX_CENTS, true),
    p_reason: (() => {
      const reason = text(form, "reason", "Refund reason", 2000, true);
      if (reason.length < 3) throw new Error("Refund reason must have at least three characters.");
      return reason;
    })(),
  }), "Refund requested. Complete the bank transfer, then record its transaction reference to mark money paid out.");
}

export async function completeMarketBillingRefund(form: FormData): Promise<AdminActionResult> {
  return mutation("market_billing_complete_refund", () => {
    if (!checked(form, "bank_verified")) throw new Error("Confirm the refund has been transferred from your bank before recording money paid out.");
    return {
      p_refund: id(form, "refund_id", "Refund"),
      p_bank_reference: text(form, "bank_reference", "Outgoing bank transaction reference", 160, true),
      p_note: text(form, "note", "Refund reconciliation note", 2000, true),
    };
  }, "Bank refund recorded as money paid out. The transaction is now included in the cash ledger.");
}

export async function cancelMarketBillingRefund(form: FormData): Promise<AdminActionResult> {
  return mutation("market_billing_cancel_refund", () => {
    if (!checked(form, "no_bank_transfer")) throw new Error("Only cancel a refund request when no outgoing bank transfer has been completed.");
    const reason = text(form, "reason", "Cancellation reason", 2000, true);
    if (reason.length < 3) throw new Error("Cancellation reason must have at least three characters.");
    return { p_refund: id(form, "refund_id", "Refund"), p_reason: reason };
  }, "Refund request cancelled. Reserved funds are released; no cash movement was recorded.");
}

export async function cancelMarketBillingOrder(form: FormData): Promise<AdminActionResult> {
  return mutation("market_billing_cancel_order", () => ({ p_order: id(form, "order_id", "Order") }),
    "Order cancelled. Any received money remains in the ledger and must be refunded through the refund workflow.");
}

export async function recordMarketBankExpense(form: FormData): Promise<AdminActionResult> {
  return mutation("market_billing_record_expense", () => {
    if (!checked(form, "bank_verified")) throw new Error("Verify that this business expense was paid from your bank before recording money paid out.");
    return {
      p_bank: id(form, "bank_id", "Paying bank account"),
      p_bank_reference: text(form, "bank_reference", "Outgoing bank transaction reference", 160, true),
      p_amount_cents: units(form, "amount", "Expense amount (USD)", MAX_CENTS, true),
      p_received_at: dateTime(form, "received_at"),
      p_note: (() => {
        const note = text(form, "note", "Expense description", 2000, true);
        if (note.length < 3) throw new Error("Expense description must have at least three characters.");
        return note;
      })(),
    };
  }, "Verified business expense recorded as money paid out. Customer balances and tax allocations are unchanged.");
}

