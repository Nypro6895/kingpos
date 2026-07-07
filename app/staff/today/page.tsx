import {
  getCurrentSalonStaffActivitySummaries,
  getCurrentSalonStaffTodayBoard,
  STAFF_WORKDAY_STATUS_LABELS,
} from "@/lib/staff-workdays";
import { hasPermission } from "@/lib/permissions";
import type { StaffWorkdayStatus } from "@/types/staff-workday";
import { redirect } from "next/navigation";

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
  }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function StatusBadge({
  status,
}: {
  status: StaffWorkdayStatus | "not_checked_in";
}) {
  const active = status === "checked_in" || status === "working";

  return (
    <span
      className={
        active
          ? "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white"
          : "inline-flex rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
      }
    >
      {STAFF_WORKDAY_STATUS_LABELS[status]}
    </span>
  );
}

export default async function StaffTodayPage() {
  const { context, staff, today } = await getCurrentSalonStaffTodayBoard();

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">Staff Today</h1>
        <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
          Please select a salon first.
        </p>
      </main>
    );
  }

  const canViewStaff = await hasPermission("staff.view", context);

  if (!canViewStaff) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">Staff Today</h1>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to view staff.
        </p>
      </main>
    );
  }

  const activityByStaffId = await getCurrentSalonStaffActivitySummaries(
    staff.map((member) => member.id),
    context,
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="border-b border-zinc-200 pb-6">
        <h1 className="text-3xl font-semibold text-zinc-950">Staff Today</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Current salon staff workday status for {context.currentSalon.name} on{" "}
          {formatDate(today)}.
        </p>
      </div>

      <section className="mt-8 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
          <div className="col-span-12 sm:col-span-2">Staff</div>
          <div className="hidden sm:col-span-2 sm:block">Work Date</div>
          <div className="hidden sm:col-span-2 sm:block">Status</div>
          <div className="hidden sm:col-span-2 sm:block">Check In</div>
          <div className="hidden sm:col-span-2 sm:block">Check Out</div>
          <div className="hidden sm:col-span-2 sm:block">Activity</div>
        </div>
        <ul className="divide-y divide-zinc-200">
          {staff.map((member) => {
            const summary = activityByStaffId.get(member.id);

            return (
              <li className="grid grid-cols-12 gap-3 px-4 py-3" key={member.id}>
                <div className="col-span-12 text-sm sm:col-span-2">
                  <p className="font-medium text-zinc-950">{member.display_name}</p>
                  <p className="text-zinc-500">{member.job_title ?? "Staff"}</p>
                </div>
                <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Work Date:{" "}
                  </span>
                  {formatDate(member.today_workday?.work_date ?? today)}
                </div>
                <div className="col-span-12 sm:col-span-2">
                  <StatusBadge status={member.today_status} />
                </div>
                <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Check In:{" "}
                  </span>
                  {formatDateTime(member.today_workday?.check_in_at ?? null)}
                </div>
                <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Check Out:{" "}
                  </span>
                  {formatDateTime(member.today_workday?.check_out_at ?? null)}
                </div>
                <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                  <p>
                    Turn {summary?.bigTurns ?? 0}|{summary?.smallTurns ?? 0}
                  </p>
                  <p>{formatMoney(summary?.assignedServiceAmount ?? 0)} services</p>
                  <p>{formatMoney(summary?.tipAmount ?? 0)} tip</p>
                  <p>{formatMoney(summary?.totalEarning ?? 0)} earning</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
