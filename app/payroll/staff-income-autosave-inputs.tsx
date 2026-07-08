"use client";

import {
  autosavePayrollPeriodStaffInputAction,
  type PayrollStaffInputAutosaveState,
} from "@/app/payroll/actions";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";

const INITIAL_STATE: PayrollStaffInputAutosaveState = {
  message: null,
  savedAt: null,
  status: "idle",
};

function formatPayoutMethod(value: string) {
  return value === "check" ? "Check" : "Cash";
}

function PayoutMethodLabel({
  method,
  taxed,
}: {
  method: string;
  taxed: boolean;
}) {
  return (
    <span className="whitespace-nowrap text-[11px] font-medium text-zinc-500">
      {formatPayoutMethod(method)}
      {taxed ? (
        <>
          {" \u00b7 "}
          Tax
        </>
      ) : null}
    </span>
  );
}

function normalizeBonus(value: FormDataEntryValue | number | string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function normalizeCheckNumber(value: FormDataEntryValue | string | null) {
  return typeof value === "string" ? value.trim() : "";
}

export function StaffIncomeAutosaveInputs({
  bonusAmount,
  bonusPayoutMethod,
  canManage,
  checkNumber,
  cycleType,
  note,
  periodEnd,
  periodStart,
  staffId,
  taxBonus,
}: {
  bonusAmount: number;
  bonusPayoutMethod: string;
  canManage: boolean;
  checkNumber: string | null;
  cycleType: string;
  note: string | null;
  periodEnd: string;
  periodStart: string;
  staffId: string;
  taxBonus: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    autosavePayrollPeriodStaffInputAction,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<number | null>(null);
  const savedSignatureRef = useRef("");
  const [localStatus, setLocalStatus] = useState<"dirty" | "saved" | "submitted">(
    "saved",
  );

  const initialSignature = `${normalizeBonus(bonusAmount)}|${normalizeCheckNumber(
    checkNumber,
  )}`;

  const readSignature = useCallback(() => {
    if (!formRef.current) {
      return "";
    }

    const formData = new FormData(formRef.current);
    return `${normalizeBonus(formData.get("bonus_amount"))}|${normalizeCheckNumber(
      formData.get("check_number"),
    )}`;
  }, []);

  const submitIfChanged = useCallback(() => {
    if (!canManage || pending || !formRef.current) {
      return;
    }

    if (!formRef.current.checkValidity()) {
      setLocalStatus("saved");
      return;
    }

    const signature = readSignature();

    if (signature === savedSignatureRef.current) {
      setLocalStatus("saved");
      return;
    }

    setLocalStatus("submitted");
    formRef.current.requestSubmit();
  }, [canManage, pending, readSignature]);

  const scheduleSave = useCallback(() => {
    if (!canManage) {
      return;
    }

    setLocalStatus("dirty");

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      submitIfChanged();
    }, 700);
  }, [canManage, submitIfChanged]);

  useEffect(() => {
    savedSignatureRef.current = initialSignature;
  }, [initialSignature]);

  useEffect(() => {
    if (pending) {
      return;
    }

    if (state.status === "saved") {
      savedSignatureRef.current = readSignature();
    }
  }, [pending, readSignature, state]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const displayStatus = pending
    ? "saving"
    : state.status === "error"
      ? "error"
      : localStatus === "dirty"
        ? "dirty"
        : "saved";
  const statusLabel =
    displayStatus === "saving"
      ? "saving..."
      : displayStatus === "error"
        ? "error"
        : displayStatus === "saved"
          ? "saved"
          : "";

  return (
    <form action={formAction} className="grid gap-1" ref={formRef}>
      <input name="cycle_type" type="hidden" value={cycleType} />
      <input name="period_start" type="hidden" value={periodStart} />
      <input name="period_end" type="hidden" value={periodEnd} />
      <input name="staff_id" type="hidden" value={staffId} />
      <input name="note" type="hidden" value={note ?? ""} />

      <div className="grid grid-cols-[54px_max-content] items-center gap-x-2">
        <label className="text-zinc-500" htmlFor={`bonus-amount-${staffId}`}>
          Bonus:
        </label>
        <div className="flex items-center gap-1.5">
          <input
            className="h-7 w-20 rounded border border-zinc-300 bg-white px-2 text-right text-xs font-medium tabular-nums text-zinc-950 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
            defaultValue={bonusAmount.toFixed(2)}
            disabled={!canManage}
            id={`bonus-amount-${staffId}`}
            min="0"
            name="bonus_amount"
            onBlur={submitIfChanged}
            onChange={scheduleSave}
            step="0.01"
            type="number"
          />
          <PayoutMethodLabel method={bonusPayoutMethod} taxed={taxBonus} />
        </div>
      </div>

      <div className="grid grid-cols-[54px_max-content] items-center gap-x-2">
        <label className="text-zinc-500" htmlFor={`check-number-${staffId}`}>
          Check #:
        </label>
        <input
          className="h-7 w-28 rounded border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-950 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
          defaultValue={checkNumber ?? ""}
          disabled={!canManage}
          id={`check-number-${staffId}`}
          name="check_number"
          onBlur={submitIfChanged}
          onChange={scheduleSave}
        />
      </div>

      {canManage ? (
        <p
          aria-live="polite"
          className={`min-h-4 text-[11px] ${
            displayStatus === "error" ? "text-rose-700" : "text-zinc-400"
          }`}
          title={state.message ?? undefined}
        >
          {statusLabel}
        </p>
      ) : null}
    </form>
  );
}
