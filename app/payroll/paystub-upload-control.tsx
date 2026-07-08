"use client";

import { uploadPayrollPaystubAction } from "@/app/payroll/actions";
import { useRef } from "react";

export function PaystubUploadControl({
  hasPaystub,
  payrollRunId,
  returnPath,
  staffId,
}: {
  hasPaystub: boolean;
  payrollRunId: string | null;
  returnPath: string;
  staffId: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function openFilePicker() {
    if (!payrollRunId) {
      return;
    }

    if (
      hasPaystub &&
      !window.confirm(
        "This staff already has a paystub. Do you want to replace it?",
      )
    ) {
      return;
    }

    fileInputRef.current?.click();
  }

  return (
    <form action={uploadPayrollPaystubAction} ref={formRef}>
      <input name="return_to" type="hidden" value={returnPath} />
      <input name="payroll_run_id" type="hidden" value={payrollRunId ?? ""} />
      <input name="staff_id" type="hidden" value={staffId} />
      <input
        accept=".pdf,image/*"
        className="hidden"
        name="paystub_file"
        onChange={(event) => {
          if (event.currentTarget.files?.length) {
            formRef.current?.requestSubmit();
          }
        }}
        ref={fileInputRef}
        type="file"
      />
      <button
        className={`rounded border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-50 disabled:text-zinc-400 ${
          hasPaystub
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-amber-200 bg-amber-50 text-amber-700"
        }`}
        disabled={!payrollRunId}
        onClick={openFilePicker}
        type="button"
      >
        {hasPaystub ? "✓ Uploaded" : "Need upload"}
      </button>
    </form>
  );
}
