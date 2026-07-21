"use client";

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
      Dismiss
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
      View Difference
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
  return (
    <button
      className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
      disabled={!canManage || !canMarkPaid}
      onClick={
        hasLiveDifference
          ? () => {
              window.alert(
                "This payroll has changed since the last printed statement. Review Staff Income or print a new statement before marking paid.",
              );
            }
          : undefined
      }
      type={hasLiveDifference ? "button" : "submit"}
    >
      Mark Paid
    </button>
  );
}
