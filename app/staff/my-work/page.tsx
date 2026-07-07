import {
  getCurrentSalonStaffActivitySummaries,
  getCurrentStaffAssignedWork,
  getTodaysStaffWorkday,
  STAFF_WORKDAY_STATUS_LABELS,
} from "@/lib/staff-workdays";
import Link from "next/link";
import { redirect } from "next/navigation";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function StaffMyWorkPage() {
  const { context, staff, workItems } = await getCurrentStaffAssignedWork();

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">My Work</h1>
        <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
          Please select a salon first.
        </p>
      </main>
    );
  }

  if (!staff) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">My Work</h1>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          No active staff profile is linked to your account for this salon.
        </p>
      </main>
    );
  }

  const { workday } = await getTodaysStaffWorkday(context);
  const activityByStaffId = await getCurrentSalonStaffActivitySummaries(
    [staff.id],
    context,
  );
  const activity = activityByStaffId.get(staff.id) ?? {
    assignedServiceAmount: 0,
    assignedServices: 0,
    bigTurns: 0,
    completedServices: 0,
    smallTurns: 0,
    tipAmount: 0,
    totalEarning: 0,
  };
  const openItems = workItems.filter((item) => item.ticket?.status === "open");

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="border-b border-zinc-200 pb-6">
        <h1 className="text-3xl font-semibold text-zinc-950">My Work</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Assigned services for {staff.display_name} today.
        </p>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">My Activity Today</h2>
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm sm:grid-cols-7">
          <p>
            <span className="block text-zinc-500">Check In</span>
            <span className="font-semibold text-zinc-950">
              {formatDateTime(workday?.check_in_at ?? null)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Check Out</span>
            <span className="font-semibold text-zinc-950">
              {formatDateTime(workday?.check_out_at ?? null)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Status</span>
            <span className="font-semibold text-zinc-950">
              {STAFF_WORKDAY_STATUS_LABELS[workday?.status ?? "not_checked_in"]}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Turns</span>
            <span className="font-semibold text-zinc-950">
              {activity.bigTurns}|{activity.smallTurns}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Services</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(activity.assignedServiceAmount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Tip</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(activity.tipAmount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Total Earning</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(activity.totalEarning)}
            </span>
          </p>
        </div>
      </section>

      <section className="mt-8 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
          <div className="col-span-12 sm:col-span-2">Ticket</div>
          <div className="hidden sm:col-span-2 sm:block">Customer</div>
          <div className="hidden sm:col-span-3 sm:block">Service</div>
          <div className="hidden sm:col-span-1 sm:block">Price</div>
          <div className="hidden sm:col-span-2 sm:block">Status</div>
          <div className="hidden sm:col-span-2 sm:block">Assigned</div>
        </div>
        {openItems.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-600">
            No open assigned services for today.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {openItems.map((item) => (
              <li className="grid grid-cols-12 gap-3 px-4 py-3" key={item.id}>
                <div className="col-span-12 text-sm sm:col-span-2">
                  {item.ticket ? (
                    <Link
                      className="font-medium text-zinc-950 underline"
                      href={`/pos-tickets/${item.ticket.id}`}
                    >
                      {item.ticket.ticket_number}
                    </Link>
                  ) : (
                    <span className="font-medium text-zinc-950">Ticket</span>
                  )}
                </div>
                <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Customer:{" "}
                  </span>
                  {item.ticket?.customer?.name ?? "Unknown customer"}
                </div>
                <div className="col-span-12 text-sm text-zinc-700 sm:col-span-3">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Service:{" "}
                  </span>
                  {item.service?.name ?? "Unknown service"}
                </div>
                <div className="col-span-12 text-sm font-medium text-zinc-950 sm:col-span-1">
                  {formatMoney(item.line_total)}
                </div>
                <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Status:{" "}
                  </span>
                  {item.ticket?.status ?? "-"}
                </div>
                <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Assigned:{" "}
                  </span>
                  {formatDateTime(item.created_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
