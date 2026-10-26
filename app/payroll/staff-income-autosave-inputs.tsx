"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { usePayrollEdits } from "./payroll-edit-boundary";
import { usePayrollRefreshBatch } from "./use-payroll-refresh-batch";
import {
  autosavePayrollPeriodStaffInputAction,
  type PayrollStaffInputAutosaveState,
} from "@/app/payroll/actions";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
      <WorkspaceText text={formatPayoutMethod(method)} />
      {taxed ? (
        <>
          {" \u00b7 "}
          <WorkspaceText text="Tax" />
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
  inputUpdatedAt = null,
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
  inputUpdatedAt?: string | null;
}) {
  const __vt = useWorkspaceTranslation();
  const router = useRouter();
  const { update: updateEditState } = usePayrollEdits();

  const [state, formAction, pending] = useActionState(
    autosavePayrollPeriodStaffInputAction,
    INITIAL_STATE,
  );
  const submittedSignatureRef=useRef("");
  const formRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<number | null>(null);
  const savedSignatureRef = useRef("");
  const [localStatus, setLocalStatus] = useState<"dirty" | "saved" | "submitted">(
    "saved",
  );
  const initialSignature = `${normalizeBonus(bonusAmount)}|${normalizeCheckNumber(checkNumber)}`;
  const [values, setValues] = useState({ bonus: bonusAmount.toFixed(2), check: checkNumber ?? "", source: initialSignature });
  // Accept fresh server values only when this row has no pending local edits.
  if (!pending && localStatus === "saved" && values.source !== initialSignature) {
    setValues({ bonus: bonusAmount.toFixed(2), check: checkNumber ?? "", source: initialSignature });
  }

  usePayrollRefreshBatch(pending || localStatus !== "saved",state.savedAt);

  useEffect(() => {
    updateEditState(staffId, pending || localStatus !== "saved");
  }, [staffId, pending, localStatus, updateEditState]);
  useEffect(() => () => updateEditState(staffId, false), [staffId, updateEditState]);

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
      setLocalStatus("dirty");
      formRef.current.reportValidity();
      return;
    }

    const signature = readSignature();

    if (signature === savedSignatureRef.current) {
      setLocalStatus("saved");
      return;
    }

    submittedSignatureRef.current=signature;
    setLocalStatus("submitted");
    formRef.current.requestSubmit();
  }, [canManage, pending, readSignature]);

  const scheduleSave = useCallback(() => {
    if (!canManage) {
      return;
    }

    setLocalStatus("dirty");
    updateEditState(staffId, true);

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      submitIfChanged();
    }, 700);
  }, [canManage, submitIfChanged, staffId, updateEditState]);

  useEffect(() => {
    savedSignatureRef.current = initialSignature;
  }, [initialSignature]);

  useEffect(() => {
    if (pending) {
      return;
    }

    if (state.status === "saved") {
      savedSignatureRef.current = submittedSignatureRef.current;
      if(readSignature()!==savedSignatureRef.current) {
        setLocalStatus("dirty");
        const timer=window.setTimeout(submitIfChanged,0);
        return()=>window.clearTimeout(timer);
      }
      setLocalStatus("saved");
    }
  }, [pending, readSignature, state, submitIfChanged]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const displayStatus = pending
    ? "saving"
    : state.status === "error" && localStatus !== "saved"
      ? "error"
      : localStatus === "submitted"
        ? "saving"
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
  const baseline = state.baseline && (!inputUpdatedAt || Date.parse(state.baselineAt ?? "") >= Date.parse(inputUpdatedAt)) ? state.baseline : {bonus_amount:bonusAmount,check_number:checkNumber,note};

  return (
    <form action={formAction} data-payroll-autosave="true" className="grid gap-3" ref={formRef}
      onReset={event => event.preventDefault()}>
      <input name="cycle_type" type="hidden" value={cycleType} />
      <input name="period_start" type="hidden" value={periodStart} />
      <input name="period_end" type="hidden" value={periodEnd} />
      <input name="staff_id" type="hidden" value={staffId} />
      <input name="note" type="hidden" value={note ?? ""} />
      <input name="expected_bonus_amount" type="hidden" value={baseline.bonus_amount} />
      <input name="expected_check_number" type="hidden" value={baseline.check_number ?? ""} />
      <input name="expected_note" type="hidden" value={baseline.note ?? ""} />
      {state.status === "error" && <button type="button" className="min-h-11 rounded border px-3 text-sm" onClick={()=>{setLocalStatus("saved");setValues({bonus:bonusAmount.toFixed(2),check:checkNumber??"",source:initialSignature});updateEditState(staffId,false);router.refresh();}}><WorkspaceText text="Discard this draft and reload current amounts"/></button>}

      <div className="grid grid-cols-[54px_max-content] items-center gap-x-2">
        <label className="text-zinc-500" htmlFor={`bonus-amount-${staffId}`}>
          <WorkspaceText text="Bonus:" />
        </label>
        <div className="flex items-center gap-1.5">
          <input
            className="h-11 w-24 lg:h-8 rounded border border-zinc-300 bg-white px-2 text-right text-base lg:text-xs font-medium tabular-nums text-zinc-950 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
            value={values.bonus}
            disabled={!canManage}
            id={`bonus-amount-${staffId}`}
            min="0"
            name="bonus_amount"
            onBlur={submitIfChanged}
            onChange={event => {
              const value = event.currentTarget.value;
              // A focused number input keeps its old default in React. Keep the
              // browser's form reset from restoring a value predating this edit.
              event.currentTarget.defaultValue = value;
              setValues(current => ({ ...current, bonus: value })); scheduleSave();
            }}
            step="0.01"
            type="number"
          />
          <PayoutMethodLabel method={bonusPayoutMethod} taxed={taxBonus} />
        </div>
      </div>

      <div className="grid grid-cols-[54px_max-content] items-center gap-x-2">
        <label className="text-zinc-500" htmlFor={`check-number-${staffId}`}>
          <WorkspaceText text="Check #:" />
        </label>
        <input
          className="h-11 w-32 lg:h-8 rounded border border-zinc-300 bg-white px-2 text-base lg:text-xs font-medium text-zinc-950 outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
          value={values.check}
          disabled={!canManage}
          id={`check-number-${staffId}`}
          name="check_number"
          onBlur={submitIfChanged}
          onChange={event => { const value = event.currentTarget.value; event.currentTarget.defaultValue = value; setValues(current => ({ ...current, check: value })); scheduleSave(); }}
        />
      </div>

      {canManage ? (
        <p
          aria-live="polite"
          className={`min-h-4 text-[11px] ${
            displayStatus === "error" ? "text-rose-700" : "text-zinc-400"
          }`}
          title={__vt(state.message ?? undefined)}
        >
          <WorkspaceText text={displayStatus === "error" ? state.message ?? "Could not save. Try again." : localStatus === "dirty" ? "Unsaved changes" : statusLabel} />
        </p>
      ) : null}
      {canManage && displayStatus === "error" && <button type="button" className="min-h-11 rounded border px-3 text-sm" onClick={submitIfChanged}><WorkspaceText text="Try again" /></button>}
    </form>
  );
}
