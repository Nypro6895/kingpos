"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useExperienceScope } from "@/components/experience-scope";
import { useScopedUiDraft } from "@/lib/use-scoped-ui-draft";
import { usePayrollEdits } from "./payroll-edit-boundary";
import { usePayrollRefreshBatch } from "./use-payroll-refresh-batch";
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
  const __vt = useWorkspaceTranslation();
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
  const experience = useExperienceScope();
  const [needsReview, setNeedsReview] = useState(false);
  const localDraft = useScopedUiDraft({
    scope: experience?.context.authenticated ? experience.context.scope : undefined,
    domain: "payroll-input", params: { staffId, periodStart, periodEnd, cycleType },
    value: { bonus: values.bonus, check: values.check }, dirty: localStatus !== "saved", enabled: canManage,
    validate: (value: unknown): value is { bonus: string; check: string } => {
      const item = value as { bonus?: string; check?: string } | null;
      return Boolean(item && typeof item.bonus === "string" && item.bonus.length <= 50 && /^\d*(\.\d{0,2})?$/.test(item.bonus) && typeof item.check === "string" && item.check.length <= 200);
    },
    onRestore: saved => {
      if (pending) return;
      setValues({ ...saved, source: initialSignature }); setLocalStatus("dirty"); setNeedsReview(true);
    },
  });
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

  const submitIfChanged = useCallback((reviewed = false) => {
    if (!canManage || pending || !formRef.current || needsReview && !reviewed || !navigator.onLine) {
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

    if (reviewed) setNeedsReview(false);
    submittedSignatureRef.current=signature;
    setLocalStatus("submitted");
    formRef.current.requestSubmit();
  }, [canManage, pending, readSignature, needsReview]);

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

  return (
    <form action={formAction} data-payroll-autosave="true" className="grid gap-3" ref={formRef}
      onReset={event => event.preventDefault()}>
      <input name="cycle_type" type="hidden" value={cycleType} />
      <input name="period_start" type="hidden" value={periodStart} />
      <input name="period_end" type="hidden" value={periodEnd} />
      <input name="staff_id" type="hidden" value={staffId} />
      <input name="note" type="hidden" value={note ?? ""} />

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
            onBlur={() => submitIfChanged()}
            onChange={event => {
              const value = event.currentTarget.value;
              // A focused number input keeps its old default in React. Keep the
              // browser's form reset from restoring a value predating this edit.
              event.currentTarget.defaultValue = value;
              localDraft.markEdited(); setValues(current => ({ ...current, bonus: value })); scheduleSave();
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
          onBlur={() => submitIfChanged()}
          onChange={event => { localDraft.markEdited(); const value = event.currentTarget.value; event.currentTarget.defaultValue = value; setValues(current => ({ ...current, check: value })); scheduleSave(); }}
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
      {canManage && needsReview && localStatus !== "saved" && <button type="button" className="min-h-11 rounded border px-3 text-sm" onClick={() => submitIfChanged(true)}><WorkspaceText text="Save changes" /></button>}
      {canManage && displayStatus === "error" && <button type="button" className="min-h-11 rounded border px-3 text-sm" onClick={() => submitIfChanged(true)}><WorkspaceText text="Try again" /></button>}
    </form>
  );
}
