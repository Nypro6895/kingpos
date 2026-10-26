"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
export function DismissPayrollMismatchButton({ targetId }: { targetId: string }) {
  return (
    <button
      className="rounded-md border border-amber-300 px-3 py-2 font-medium text-amber-950"
      onClick={() => {
        const target = document.getElementById(targetId);
        if (target) {
          target.hidden = true;
        }
      }}
      type="button"
    >
      <WorkspaceText text="Dismiss" />
    </button>
  );
}

export function OpenPayrollDifferenceDetailsButton({
  targetId,
}: {
  targetId: string;
}) {
  return (
    <button
      className="rounded-md border border-amber-300 px-3 py-2 font-medium text-amber-950"
      onClick={() => {
        const target = document.getElementById(targetId);
        if (target instanceof HTMLDetailsElement) {
          target.open = true;
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }}
      type="button"
    >
      <WorkspaceText text="View Difference" />
    </button>
  );
}

export function MarkPaidButton({
  canManage,
  canMarkPaid,
  hasLiveDifference,
}: {
  canManage: boolean;
  canMarkPaid: boolean;
  hasLiveDifference: boolean;
}) {
  const __vt = useWorkspaceTranslation();

  return (
    <button
      className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
      disabled={!canManage || !canMarkPaid}
      onClick={
        hasLiveDifference
          ? () => {
              window.alert(
                __vt("This payroll has changed since the last printed statement. Review Staff Income or print a new statement before marking paid."),
              );
            }
          : canMarkPaid ? (event) => {
              if (!window.confirm(__vt("Mark this saved payroll statement as paid? This records payment; it does not transfer money."))) event.preventDefault();
            } : undefined
      }
      type={hasLiveDifference ? "button" : "submit"}
    >
      <WorkspaceText text="Mark Paid" />
    </button>
  );
}
