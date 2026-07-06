import {
  cancelBooking,
  createBooking,
  updateBooking,
} from "@/app/bookings/actions";
import {
  BOOKING_PERMISSIONS,
  getCurrentSalonBookingOptions,
  getCurrentSalonBookings,
} from "@/lib/bookings";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import type { BookingStatus, BookingWithRelations } from "@/types/booking";
import { BOOKING_STATUSES } from "@/types/booking";
import type { Customer } from "@/types/customer";
import type { Staff } from "@/types/staff";
import Link from "next/link";
import { redirect } from "next/navigation";

type BookingsPageProps = {
  searchParams: Promise<{
    edit?: string;
    error?: string;
  }>;
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  scheduled: "Scheduled",
  checked_in: "Checked In",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

function formatBookingDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDateTimeLocalValue(value: string) {
  const date = new Date(value);
  const pad = (part: number) => part.toString().padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function StatusBadge({ status }: { status: BookingStatus }) {
  const isClosed =
    status === "completed" || status === "cancelled" || status === "no_show";

  return (
    <span
      className={
        isClosed
          ? "inline-flex rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
          : "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white"
      }
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function MissingSalonState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">Bookings</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Manage appointments for this salon.
      </p>
      <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        Please select a salon first.
      </p>
    </main>
  );
}

function BookingForm({
  action,
  booking,
  customers,
  error,
  staff,
}: {
  action: (formData: FormData) => Promise<void>;
  booking?: BookingWithRelations;
  customers: Customer[];
  error?: string;
  staff: Staff[];
}) {
  return (
    <form
      action={action}
      className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      {booking ? <input name="booking_id" type="hidden" value={booking.id} /> : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-2">
          {error}
        </p>
      ) : null}

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Customer</span>
        <select
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={booking?.customer_id ?? ""}
          name="customer_id"
          required
        >
          <option value="">Select customer</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Assigned Staff</span>
        <select
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={booking?.staff_id ?? ""}
          name="staff_id"
        >
          <option value="">Unassigned</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.display_name}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Start</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={booking ? toDateTimeLocalValue(booking.start_at) : ""}
          name="start_at"
          required
          type="datetime-local"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">End</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={booking ? toDateTimeLocalValue(booking.end_at) : ""}
          name="end_at"
          required
          type="datetime-local"
        />
      </label>

      {booking ? (
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">Status</span>
          <select
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            defaultValue={booking.status}
            name="status"
          >
            {BOOKING_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-zinc-700">Notes</span>
        <textarea
          className="mt-2 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={booking?.notes ?? ""}
          name="notes"
        />
      </label>

      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          {booking ? "Save Booking" : "Create Booking"}
        </button>
        {booking ? (
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/bookings"
          >
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function BookingList({
  bookings,
  canManageBookings,
  customers,
  editBookingId,
  error,
  staff,
}: {
  bookings: BookingWithRelations[];
  canManageBookings: boolean;
  customers: Customer[];
  editBookingId?: string;
  error?: string;
  staff: Staff[];
}) {
  if (bookings.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No bookings yet</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Create your first appointment for this salon.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-12 sm:col-span-3">Customer</div>
        <div className="hidden sm:col-span-2 sm:block">Staff</div>
        <div className="hidden sm:col-span-2 sm:block">Start</div>
        <div className="hidden sm:col-span-2 sm:block">End</div>
        <div className="hidden sm:col-span-1 sm:block">Status</div>
        <div className="hidden sm:col-span-2 sm:block">Actions</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {bookings.map((booking) => (
          <li className="px-5 py-4" key={booking.id}>
            {editBookingId === booking.id ? (
              <BookingForm
                action={updateBooking}
                booking={booking}
                customers={customers}
                error={error}
                staff={staff}
              />
            ) : (
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-12 sm:col-span-3">
                  <p className="font-medium text-zinc-950">
                    {booking.customer?.name ?? "Unknown customer"}
                  </p>
                  {booking.notes ? (
                    <p className="mt-1 text-sm text-zinc-600">{booking.notes}</p>
                  ) : null}
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">Staff: </span>
                  {booking.staff?.display_name ?? "Unassigned"}
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">Start: </span>
                  {formatBookingDateTime(booking.start_at)}
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">End: </span>
                  {formatBookingDateTime(booking.end_at)}
                </div>
                <div className="col-span-6 self-center sm:col-span-1">
                  <StatusBadge status={booking.status} />
                </div>
                <div className="col-span-12 flex flex-wrap gap-3 self-center text-sm sm:col-span-2">
                  {canManageBookings ? (
                    <>
                      <Link
                        className="font-medium text-zinc-950 underline"
                        href={`/bookings?edit=${booking.id}`}
                      >
                        Edit
                      </Link>
                      {booking.status !== "cancelled" ? (
                        <form action={cancelBooking}>
                          <input name="booking_id" type="hidden" value={booking.id} />
                          <button
                            className="font-medium text-zinc-950 underline"
                            type="submit"
                          >
                            Cancel Booking
                          </button>
                        </form>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function BookingsPage({ searchParams }: BookingsPageProps) {
  const [{ edit, error }, context] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return <MissingSalonState />;
  }

  const canViewBookings = await hasPermission(BOOKING_PERMISSIONS.view, context);

  if (!canViewBookings) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">Bookings</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Manage appointments for this salon.
        </p>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to view bookings.
        </p>
      </main>
    );
  }

  const canManageBookings = await hasPermission(BOOKING_PERMISSIONS.manage, context);
  const [{ bookings }, options] = await Promise.all([
    getCurrentSalonBookings(),
    canManageBookings
      ? getCurrentSalonBookingOptions(context)
      : Promise.resolve({ customers: [], staff: [] }),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="border-b border-zinc-200 pb-6">
        <h1 className="text-3xl font-semibold text-zinc-950">Bookings</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Manage appointments for this salon.
        </p>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Create Booking</h2>
        {canManageBookings ? (
          <BookingForm
            action={createBooking}
            customers={options.customers}
            error={edit ? undefined : error}
            staff={options.staff}
          />
        ) : (
          <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
            You do not have permission to manage bookings.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-950">Bookings</h2>
        <BookingList
          bookings={bookings}
          canManageBookings={canManageBookings}
          customers={options.customers}
          editBookingId={edit}
          error={edit ? error : undefined}
          staff={options.staff}
        />
      </section>
    </main>
  );
}
