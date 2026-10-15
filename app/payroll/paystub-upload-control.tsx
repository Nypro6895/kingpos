"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { uploadPayrollPaystubAction } from "@/app/payroll/actions";
import { uploadTaxPaystub } from "@/app/tax-company/actions";
import { useRef } from "react";
import { useFormStatus } from "react-dom";

function UploadButton({ hasPaystub, payrollRunId, onClick }: { hasPaystub: boolean; payrollRunId: string | null; onClick: () => void }) {
  const { pending } = useFormStatus();
  return <button type="button" onClick={onClick} disabled={pending || !payrollRunId} aria-busy={pending}
    className={`min-h-11 rounded border px-3 py-2 text-sm font-medium disabled:opacity-50 ${hasPaystub ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
    <WorkspaceText text={pending ? "Uploading…" : hasPaystub ? "✓ Uploaded" : "Need upload"} />
  </button>;
}

export function PaystubUploadControl({
  hasPaystub,
  payrollRunId,
  returnPath,
  staffId,
  taxSalonId,
}: {
  hasPaystub: boolean;
  payrollRunId: string | null;
  returnPath: string;
  staffId: string;
  taxSalonId?: string;
}) {
  const __vt = useWorkspaceTranslation();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function openFilePicker() {
    if (!payrollRunId) {
      return;
    }

    if (
      hasPaystub &&
      !window.confirm(
        __vt("This staff already has a paystub. Do you want to replace it?"),
      )
    ) {
      return;
    }

    fileInputRef.current?.click();
  }

  return (
    <form action={taxSalonId ? uploadTaxPaystub : uploadPayrollPaystubAction} ref={formRef}>
      {taxSalonId && <input name="tax_salon_id" type="hidden" value={taxSalonId} />}
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
      <UploadButton hasPaystub={hasPaystub} payrollRunId={payrollRunId} onClick={openFilePicker} />
    </form>
  );
}
