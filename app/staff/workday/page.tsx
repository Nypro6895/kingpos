import {
  checkInStaffWorkday,
  checkOutStaffWorkday,
  updateStaffWorkdayStatus,
} from "@/app/staff/workday/actions";
import {
  getCurrentSalonStaffActivitySummaries,
  getTodaysStaffWorkday,
  STAFF_WORKDAY_STATUS_LABELS,
} from "@/lib/staff-workdays";
import type { StaffWorkdayStatus } from "@/types/staff-workday";
import { redirect } from "next/navigation";

type StaffWorkdayPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

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
      {STAFF_WORKDAY_STATUS_LABELS[status]}
    </span>
  );
}

function MissingSalonState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">My Work Today</h1>
      <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        Please select a salon first.
      </p>
    </main>
  );
}

export default async function StaffWorkdayPage({
  searchParams,
}: StaffWorkdayPageProps) {
  const { error } = await searchParams;
  const { context, staff, today, workday } = await getTodaysStaffWorkday();

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return <MissingSalonState />;
  }

  if (!staff) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">My Work Today</h1>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          No active staff profile is linked to your account for this salon.
        </p>
      </main>
    );
  }

  const status = workday?.status ?? "not_checked_in";
  const activityByStaffId = await getCurrentSalonStaffActivitySummaries(
    [staff.id],
    context,
  );
  const activity = activityByStaffId.get(staff.id) ?? {
    assignedServiceAmount: 0,
    assignedServices: 0,
    completedServices: 0,
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="border-b border-zinc-200 pb-6">
        <h1 className="text-3xl font-semibold text-zinc-950">My Work Today</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Daily staff workflow for {staff.display_name}.
        </p>
      </div>

      {error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Today Status</h2>
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-5">
          <StatusBadge status={status} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Today Information</h2>
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm sm:grid-cols-2">
          <p>
            <span className="block text-zinc-500">Work Date</span>
            <span className="font-semibold text-zinc-950">
              {formatDate(today)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Salon</span>
            <span className="font-semibold text-zinc-950">
              {context.currentSalon.name}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Check In Time</span>
            <span className="font-semibold text-zinc-950">
              {formatDateTime(workday?.check_in_at ?? null)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Check Out Time</span>
            <span className="font-semibold text-zinc-950">
              {formatDateTime(workday?.check_out_at ?? null)}
            </span>
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Today Summary</h2>
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm sm:grid-cols-4">
          <p>
            <span className="block text-zinc-500">Assigned Services Today</span>
            <span className="font-semibold text-zinc-950">
              {activity.assignedServices}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Completed Services</span>
            <span className="font-semibold text-zinc-950">
              {activity.completedServices}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Current Status</span>
            <span className="font-semibold text-zinc-950">
              {STAFF_WORKDAY_STATUS_LABELS[status]}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Assigned Service Amount</span>
            <span className="font-semibold text-zinc-950">
              {new Intl.NumberFormat("en-US", {
                currency: "USD",
                style: "currency",
              }).format(activity.assignedServiceAmount)}
            </span>
          </p>
        </div>
      </section>

      <section className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 p-5">
        <h2 className="text-lg font-semibold text-zinc-950">Actions</h2>
        <div className="mt-4">
          {status === "not_checked_in" ? (
            <form action={checkInStaffWorkday}>
              <button
                className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
                type="submit"
              >
                Check In
              </button>
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
                  <button
                    className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={status === nextStatus}
                    type="submit"
                  >
                    {label}
                  </button>
                </form>
              ))}
              <form action={checkOutStaffWorkday}>
              <button
                className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
                type="submit"
              >
                Check Out
              </button>
              </form>
            </div>
          ) : null}

          {status === "checked_out" ? (
            <p className="text-sm text-zinc-600">
              Workday is checked out. Summary is read-only.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
