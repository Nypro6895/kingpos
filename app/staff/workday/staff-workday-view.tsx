"use client";
import { WorkspaceText } from "@/components/workspace-language";
import { SubmitButton } from "@/components/submit-button";
import { checkInStaffWorkday, checkOutStaffWorkday, updateStaffWorkdayStatus } from "@/app/staff/workday/actions";
import { STAFF_WORKDAY_READ_LABELS as STAFF_WORKDAY_STATUS_LABELS, type StaffWorkdayReadData } from "@/lib/staff-read-view";
import type { StaffWorkdayStatus } from "@/types/staff-workday";
function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function StatusBadge({
  status,
}: {
  status: StaffWorkdayStatus | "not_checked_in";
}) {
  const checkedIn = status === "checked_in" || status === "working";

  return (
    <span
      className={
        checkedIn
          ? "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white"
          : "inline-flex rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
      }
    >
      <WorkspaceText text={STAFF_WORKDAY_STATUS_LABELS[status]} />
    </span>
  );
}

export function StaffWorkdayView({ data, error }: { data: StaffWorkdayReadData; error?: string }) {
  const { today, workday } = data;
  const status = workday?.status ?? "not_checked_in";
  const activity = data.activity ?? { assignedServiceAmount: 0, assignedServices: 0, completedServices: 0 };
  return (
    <main className="w-full min-w-0 px-4 py-6 sm:px-6">
      {error ? (
        <p className="content-surface border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 rounded-none border-y shadow-none">
          <WorkspaceText text={error} />
        </p>
      ) : null}

      <section className={error ? "mt-8" : ""}>
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Today Status" /></h2>
        <div className="content-surface mt-4 border-zinc-200 bg-white p-5 rounded-none border-y shadow-none">
          <StatusBadge status={status} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Today Information" /></h2>
        <div className="content-surface mt-4 grid gap-3 border-zinc-200 bg-white p-5 text-sm sm:grid-cols-2 rounded-none border-y shadow-none">
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Work Date" /></span>
            <span className="font-semibold text-zinc-950">
              <WorkspaceText text={formatDate(today)} />
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Salon" /></span>
            <span className="font-semibold text-zinc-950">
              {data.salonName}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Check In Time" /></span>
            <span className="font-semibold text-zinc-950">
              <WorkspaceText text={formatDateTime(workday?.checkInAt ?? null)} />
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Check Out Time" /></span>
            <span className="font-semibold text-zinc-950">
              <WorkspaceText text={formatDateTime(workday?.checkOutAt ?? null)} />
            </span>
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Today Summary" /></h2>
        <div className="content-surface mt-4 grid gap-3 border-zinc-200 bg-white p-5 text-sm sm:grid-cols-4 rounded-none border-y shadow-none">
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Assigned Services Today" /></span>
            <span className="font-semibold text-zinc-950">
              {activity.assignedServices}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Completed Services" /></span>
            <span className="font-semibold text-zinc-950">
              {activity.completedServices}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Current Status" /></span>
            <span className="font-semibold text-zinc-950">
              <WorkspaceText text={STAFF_WORKDAY_STATUS_LABELS[status]} />
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Assigned Service Amount" /></span>
            <span className="font-semibold text-zinc-950">
              {new Intl.NumberFormat("en-US", {
                currency: "USD",
                style: "currency",
              }).format(activity.assignedServiceAmount)}
            </span>
          </p>
        </div>
      </section>

      <section className="content-surface mt-8 border-zinc-200 bg-zinc-50 p-5 rounded-none border-y shadow-none">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Actions" /></h2>
        <div className="mt-4">
          {status === "not_checked_in" ? (
            <form action={checkInStaffWorkday}>
              <SubmitButton pendingLabel="Processing…"
                className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
                type="submit"
              >
                <WorkspaceText text="Check In" />
              </SubmitButton>
            </form>
          ) : null}

          {status !== "not_checked_in" && status !== "checked_out" ? (
            <div className="flex flex-wrap gap-3">
              {[
                ["working", "Start Working"],
                ["break", "Take Break"],
                ["unavailable", "Mark Unavailable"],
              ].map(([nextStatus, label]) => (
                <form action={updateStaffWorkdayStatus} key={nextStatus}>
                  <input name="status" type="hidden" value={nextStatus} />
                  <SubmitButton pendingLabel="Processing…"
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={status === nextStatus}
                    type="submit"
                  >
                    <WorkspaceText text={label} />
                  </SubmitButton>
                </form>
              ))}
              <form action={checkOutStaffWorkday}>
              <SubmitButton pendingLabel="Processing…"
                className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
                type="submit"
              >
                <WorkspaceText text="Check Out" />
              </SubmitButton>
              </form>
            </div>
          ) : null}

          {status === "checked_out" ? (
            <p className="text-sm text-zinc-600">
              <WorkspaceText text="Workday is checked out. Summary is read-only." />
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
