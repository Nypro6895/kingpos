"use client";

import { saveStaffPayrollSettingWithEffectiveDateAction } from "@/app/payroll/actions";
import type {
  PayrollPayoutMethod,
  PayrollPeriod,
  StaffPayrollSetting,
  StaffPayType,
} from "@/types/payroll";
import type { Staff } from "@/types/staff";
import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";
import { useState } from "react";

type ActiveField =
  | "bonusPayout"
  | "checkRate"
  | "commissionRate"
  | "effectiveFrom"
  | "fixedPay"
  | "legalName"
  | "payType"
  | "taxCash"
  | "taxFixed"
  | "taxRate"
  | "taxTip"
  | "tipPayout"
  | null;

function numberValue(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: string | number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(numberValue(value));
}

function formatPercent(value: string | number) {
  return `${numberValue(value).toFixed(2).replace(/\.00$/, "")}%`;
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatPayoutMethod(value: PayrollPayoutMethod) {
  return value === "check" ? "Check" : "Cash";
}

function formatOnOff(value: boolean) {
  return value ? "On" : "Off";
}

function formatYesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function SettingGroup({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h4>
      <div className="grid gap-1.5">{children}</div>
    </section>
  );
}

function HiddenSettingInputs({
  bonusPayout,
  checkRate,
  commissionRate,
  effectiveFrom,
  fixedPayAmount,
  legalName,
  payType,
  returnPath,
  staffId,
  taxCash,
  taxFixed,
  taxRate,
  taxTip,
  tipPayout,
}: {
  bonusPayout: PayrollPayoutMethod;
  checkRate: string;
  commissionRate: string;
  effectiveFrom: string;
  fixedPayAmount: string;
  legalName: string;
  payType: StaffPayType;
  returnPath: string;
  staffId: string;
  taxCash: boolean;
  taxFixed: boolean;
  taxRate: string;
  taxTip: boolean;
  tipPayout: PayrollPayoutMethod;
}) {
  return (
    <>
      <input name="return_to" type="hidden" value={returnPath} />
      <input name="staff_id" type="hidden" value={staffId} />
      <input name="legal_name" type="hidden" value={legalName} />
      <input name="pay_type" type="hidden" value={payType} />
      <input name="commission_rate" type="hidden" value={commissionRate} />
      <input name="fixed_pay_amount" type="hidden" value={fixedPayAmount} />
      <input name="check_rate" type="hidden" value={checkRate} />
      <input name="tax_rate" type="hidden" value={taxRate} />
      <input
        name="apply_tax_to_fixed_pay"
        type="hidden"
        value={taxFixed ? "true" : "false"}
      />
      <input name="tax_tips" type="hidden" value={taxTip ? "true" : "false"} />
      <input
        name="cash_to_tax_company"
        type="hidden"
        value={taxCash ? "true" : "false"}
      />
      <input name="tip_payout_method" type="hidden" value={tipPayout} />
      <input name="bonus_payout_method" type="hidden" value={bonusPayout} />
      <input name="effective_from" type="hidden" value={effectiveFrom} />
    </>
  );
}

function InlineNumberInput({
  autoFocus = false,
  max,
  onChange,
  onDone,
  prefix,
  suffix,
  value,
}: {
  autoFocus?: boolean;
  max?: number;
  onChange: (value: string) => void;
  onDone: () => void;
  prefix?: string;
  suffix?: string;
  value: string;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    onDone();
  }

  return (
    <span className="inline-flex h-8 max-w-36 items-center overflow-hidden rounded border border-zinc-300 bg-white align-middle">
      {prefix ? (
        <span className="flex h-full items-center border-r border-zinc-200 bg-zinc-50 px-2 text-sm text-zinc-500">
          {prefix}
        </span>
      ) : null}
      <input
        autoFocus={autoFocus}
        className="h-full min-w-0 flex-1 px-2 text-sm text-zinc-950 outline-none"
        max={max}
        min="0"
        onBlur={onDone}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        step="0.01"
        type="number"
        value={value}
      />
      {suffix ? (
        <span className="flex h-full items-center border-l border-zinc-200 bg-zinc-50 px-2 text-sm text-zinc-500">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}

function InlineTextInput({
  autoFocus = false,
  onChange,
  onDone,
  value,
}: {
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onDone: () => void;
  value: string;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    onDone();
  }

  return (
    <input
      autoFocus={autoFocus}
      className="h-8 w-full max-w-48 rounded border border-zinc-300 bg-white px-2 text-sm text-zinc-950 outline-none"
      onBlur={onDone}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      value={value}
    />
  );
}

function InlineDateInput({
  autoFocus = false,
  onChange,
  onDone,
  value,
}: {
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onDone: () => void;
  value: string;
}) {
  return (
    <input
      autoFocus={autoFocus}
      className="h-8 rounded border border-zinc-300 bg-white px-2 text-sm text-zinc-950 outline-none"
      onBlur={onDone}
      onChange={(event) => onChange(event.target.value)}
      type="date"
      value={value}
    />
  );
}

function InlineSelect({
  autoFocus = false,
  children,
  onChange,
  value,
}: {
  autoFocus?: boolean;
  children: ReactNode;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <select
      autoFocus={autoFocus}
      className="h-8 rounded border border-zinc-300 bg-white px-2 text-sm text-zinc-950"
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {children}
    </select>
  );
}

function EditableSetting({
  active,
  children,
  label,
  onClick,
  value,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
  value: ReactNode;
}) {
  if (active) {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
        <span className="shrink-0 text-zinc-500">{label}:</span>
        {children}
      </div>
    );
  }

  return (
    <button
      className="flex min-w-0 items-baseline gap-1.5 rounded px-1 py-0.5 text-left text-sm transition hover:bg-zinc-50"
      onClick={onClick}
      type="button"
    >
      <span className="shrink-0 text-zinc-500">{label}:</span>
      <span className="min-w-0 font-medium text-zinc-900">{value}</span>
    </button>
  );
}

export function StaffPayrollSettingInlineEdit({
  period,
  returnPath,
  setting,
  staff,
}: {
  period: PayrollPeriod;
  returnPath: string;
  setting: StaffPayrollSetting | null;
  staff: Staff;
}) {
  const currentEffectiveFrom = setting?.effective_from ?? period.startDate;
  const [activeField, setActiveField] = useState<ActiveField>(null);
  const [payType, setPayType] = useState<StaffPayType>(
    setting?.pay_type ?? "commission",
  );
  const [commissionRate, setCommissionRate] = useState(
    String(setting?.commission_rate ?? 60),
  );
  const [fixedPayAmount, setFixedPayAmount] = useState(
    String(setting?.fixed_pay_amount ?? 0),
  );
  const [checkRate, setCheckRate] = useState(String(setting?.check_rate ?? 60));
  const [taxRate, setTaxRate] = useState(String(setting?.tax_rate ?? 0));
  const [taxTip, setTaxTip] = useState(setting?.tax_tips ?? false);
  const [taxFixed, setTaxFixed] = useState(
    setting?.apply_tax_to_fixed_pay ?? true,
  );
  const [taxCash, setTaxCash] = useState(setting?.cash_to_tax_company ?? false);
  const [tipPayout, setTipPayout] = useState<PayrollPayoutMethod>(
    setting?.tip_payout_method ?? "cash",
  );
  const [bonusPayout, setBonusPayout] = useState<PayrollPayoutMethod>(
    setting?.bonus_payout_method ?? "check",
  );
  const [effectiveFrom, setEffectiveFrom] = useState(currentEffectiveFrom);
  const [legalName, setLegalName] = useState(setting?.legal_name ?? "");

  const closeField = () => setActiveField(null);

  return (
    <form
      action={saveStaffPayrollSettingWithEffectiveDateAction}
      className="grid gap-4"
      onSubmit={(event) => {
        if (
          effectiveFrom === currentEffectiveFrom &&
          !window.confirm(
            `You are saving changes with the same effective date. This may update the current payroll setting from ${formatDateLabel(
              currentEffectiveFrom,
            )}. Continue?`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <HiddenSettingInputs
        bonusPayout={bonusPayout}
        checkRate={checkRate}
        commissionRate={commissionRate}
        effectiveFrom={effectiveFrom}
        fixedPayAmount={fixedPayAmount}
        legalName={legalName}
        payType={payType}
        returnPath={returnPath}
        staffId={staff.id}
        taxCash={taxCash}
        taxFixed={taxFixed}
        taxRate={taxRate}
        taxTip={taxTip}
        tipPayout={tipPayout}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-zinc-950">
            {staff.display_name}
          </h3>
          {legalName ? (
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              Legal name: {legalName}
            </p>
          ) : null}
          <div className="mt-1">
            <EditableSetting
              active={activeField === "effectiveFrom"}
              label="Effective from"
              onClick={() => setActiveField("effectiveFrom")}
              value={formatDateLabel(effectiveFrom)}
            >
              <InlineDateInput
                autoFocus
                onChange={setEffectiveFrom}
                onDone={closeField}
                value={effectiveFrom}
              />
            </EditableSetting>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            href={returnPath}
          >
            Cancel
          </Link>
          <button className="rounded bg-zinc-950 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800">
            Save
          </button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <SettingGroup title="Compensation">
          <EditableSetting
            active={activeField === "payType"}
            label="Pay type"
            onClick={() => setActiveField("payType")}
            value={payType === "fixed" ? "Fixed" : "Commission"}
          >
            <InlineSelect
              autoFocus
              onChange={(value) => {
                setPayType(value === "fixed" ? "fixed" : "commission");
                closeField();
              }}
              value={payType}
            >
              <option value="commission">Commission</option>
              <option value="fixed">Fixed</option>
            </InlineSelect>
          </EditableSetting>
          {payType === "commission" ? (
            <EditableSetting
              active={activeField === "commissionRate"}
              label="Commission split rate"
              onClick={() => setActiveField("commissionRate")}
              value={formatPercent(commissionRate)}
            >
              <InlineNumberInput
                autoFocus
                max={100}
                onChange={setCommissionRate}
                onDone={closeField}
                suffix="%"
                value={commissionRate}
              />
            </EditableSetting>
          ) : (
            <EditableSetting
              active={activeField === "fixedPay"}
              label="Fixed pay"
              onClick={() => setActiveField("fixedPay")}
              value={formatMoney(fixedPayAmount)}
            >
              <InlineNumberInput
                autoFocus
                onChange={setFixedPayAmount}
                onDone={closeField}
                prefix="$"
                value={fixedPayAmount}
              />
            </EditableSetting>
          )}
          <EditableSetting
            active={activeField === "checkRate"}
            label="Check split"
            onClick={() => setActiveField("checkRate")}
            value={formatPercent(checkRate)}
          >
            <InlineNumberInput
              autoFocus
              max={100}
              onChange={setCheckRate}
              onDone={closeField}
              suffix="%"
              value={checkRate}
            />
          </EditableSetting>
        </SettingGroup>

        <SettingGroup title="Tax reporting">
          <EditableSetting
            active={activeField === "taxRate"}
            label="Tax rate"
            onClick={() => setActiveField("taxRate")}
            value={formatPercent(taxRate)}
          >
            <InlineNumberInput
              autoFocus
              max={100}
              onChange={setTaxRate}
              onDone={closeField}
              suffix="%"
              value={taxRate}
            />
          </EditableSetting>
          <EditableSetting
            active={activeField === "taxCash"}
            label="Tax cash"
            onClick={() => setActiveField("taxCash")}
            value={formatOnOff(taxCash)}
          >
            <InlineSelect
              autoFocus
              onChange={(value) => {
                setTaxCash(value === "true");
                closeField();
              }}
              value={taxCash ? "true" : "false"}
            >
              <option value="false">Off</option>
              <option value="true">On</option>
            </InlineSelect>
          </EditableSetting>
          <EditableSetting
            active={activeField === "taxTip"}
            label="Tax tip"
            onClick={() => setActiveField("taxTip")}
            value={formatYesNo(taxTip)}
          >
            <InlineSelect
              autoFocus
              onChange={(value) => {
                setTaxTip(value === "true");
                closeField();
              }}
              value={taxTip ? "true" : "false"}
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </InlineSelect>
          </EditableSetting>
        </SettingGroup>

        <SettingGroup title="Payout">
          <EditableSetting
            active={activeField === "tipPayout"}
            label="Tip payout"
            onClick={() => setActiveField("tipPayout")}
            value={formatPayoutMethod(tipPayout)}
          >
            <InlineSelect
              autoFocus
              onChange={(value) => {
                setTipPayout(value === "check" ? "check" : "cash");
                closeField();
              }}
              value={tipPayout}
            >
              <option value="cash">Cash</option>
              <option value="check">Check</option>
            </InlineSelect>
          </EditableSetting>
          <EditableSetting
            active={activeField === "bonusPayout"}
            label="Bonus payout"
            onClick={() => setActiveField("bonusPayout")}
            value={formatPayoutMethod(bonusPayout)}
          >
            <InlineSelect
              autoFocus
              onChange={(value) => {
                setBonusPayout(value === "cash" ? "cash" : "check");
                closeField();
              }}
              value={bonusPayout}
            >
              <option value="check">Check</option>
              <option value="cash">Cash</option>
            </InlineSelect>
          </EditableSetting>
        </SettingGroup>
      </div>

      <details className="pt-1">
        <summary className="w-fit cursor-pointer text-xs font-medium text-zinc-600 hover:text-zinc-900">
          More details
        </summary>
        <div className="mt-3 grid gap-1.5 sm:max-w-md">
          <EditableSetting
            active={activeField === "legalName"}
            label="Legal name"
            onClick={() => setActiveField("legalName")}
            value={legalName || "Not set"}
          >
            <InlineTextInput
              autoFocus
              onChange={setLegalName}
              onDone={closeField}
              value={legalName}
            />
          </EditableSetting>
          {payType === "commission" ? (
            <EditableSetting
              active={activeField === "fixedPay"}
              label="Fixed pay"
              onClick={() => setActiveField("fixedPay")}
              value={formatMoney(fixedPayAmount)}
            >
              <InlineNumberInput
                autoFocus
                onChange={setFixedPayAmount}
                onDone={closeField}
                prefix="$"
                value={fixedPayAmount}
              />
            </EditableSetting>
          ) : null}
          <EditableSetting
            active={activeField === "taxFixed"}
            label="Tax fixed"
            onClick={() => setActiveField("taxFixed")}
            value={formatYesNo(taxFixed)}
          >
            <InlineSelect
              autoFocus
              onChange={(value) => {
                setTaxFixed(value === "true");
                closeField();
              }}
              value={taxFixed ? "true" : "false"}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </InlineSelect>
          </EditableSetting>
        </div>
      </details>
    </form>
  );
}
