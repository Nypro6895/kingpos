import {
  addPosPayment,
  addPosTicketItem,
  cancelPosTicket,
  closePosTicket,
  createPosTicket,
  deletePosPayment,
  deletePosTicketItem,
  updatePosTicketItem,
  updatePosTicketItemStaff,
  updatePosTicketNotes,
} from "@/app/pos-tickets/actions";
import {
  getCurrentSalonPosTicketOptions,
  getCurrentSalonPosTickets,
  type PosTicketStaffOption,
  POS_TICKET_PERMISSIONS,
} from "@/lib/pos-tickets";
import { getCurrentBusinessContext } from "@/lib/current-context";
import {
  POS_PAYMENT_METHOD_LABELS,
  POS_PAYMENT_METHOD_OPTIONS,
} from "@/lib/pos-payments";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { hasPermission } from "@/lib/permissions";
import type { Customer } from "@/types/customer";
import type { PosPayment } from "@/types/pos-payment";
import type { PosTicketItemWithRelations } from "@/types/pos-ticket-item";
import type {
  PosTicketStatus,
  PosTicketWithRelations,
} from "@/types/pos-ticket";
import type { Service } from "@/types/service";
import { STAFF_WORKDAY_STATUS_LABELS } from "@/lib/staff-workdays";
import Link from "next/link";
import { redirect } from "next/navigation";

type PosTicketsPageProps = {
  searchParams: Promise<{
    checkout?: string;
    edit?: string;
    error?: string;
    itemEdit?: string;
    payments?: string;
  }>;
};

const STATUS_LABELS: Record<PosTicketStatus, string> = {
  open: "Open",
  closed: "Closed",
  cancelled: "Cancelled",
  voided: "Voided",
};

function formatTicketDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function toCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function toDateTimeLocalValue(value: Date) {
  const pad = (part: number) => part.toString().padStart(2, "0");

  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(
    value.getDate(),
  )}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function StatusBadge({ status }: { status: PosTicketStatus }) {
  const isOpen = status === "open";

  return (
    <span
      className={
        isOpen
          ? "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white"
          : "inline-flex rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
      }
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function MissingSalonState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">POS Tickets</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Manage customer service sessions for this salon.
      </p>
      <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        Please select a salon first.
      </p>
    </main>
  );
}

function PosTicketForm({
  customers,
  error,
}: {
  customers: Customer[];
  error?: string;
}) {
  return (
    <form
      action={createPosTicket}
      className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-2">
          {error}
        </p>
      ) : null}

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Customer</span>
        <select
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue=""
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
        <span className="text-sm font-medium text-zinc-700">Opened At</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={toDateTimeLocalValue(new Date())}
          name="opened_at"
          required
          type="datetime-local"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Closed At</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="closed_at"
          type="datetime-local"
        />
      </label>

      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-zinc-700">Notes</span>
        <textarea
          className="mt-2 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="notes"
        />
      </label>

      <div className="sm:col-span-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Create Ticket
        </button>
      </div>
    </form>
  );
}

function EditNotesForm({
  error,
  ticket,
}: {
  error?: string;
  ticket: PosTicketWithRelations;
}) {
  return (
    <form action={updatePosTicketNotes} className="grid gap-4">
      <input name="ticket_id" type="hidden" value={ticket.id} />

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Notes</span>
        <textarea
          className="mt-2 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={ticket.notes ?? ""}
          name="notes"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Save Notes
        </button>
        <Link
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
          href="/pos-tickets"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function AddTicketItemForm({
  services,
  ticket,
}: {
  services: Service[];
  ticket: PosTicketWithRelations;
}) {
  return (
    <form action={addPosTicketItem} className="mt-4 flex flex-col gap-3 sm:flex-row">
      <input name="ticket_id" type="hidden" value={ticket.id} />
      <select
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950 sm:max-w-xs"
        defaultValue=""
        name="service_id"
        required
      >
        <option value="">Add service to ticket</option>
        {services.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name} - {formatMoney(service.base_price)}
          </option>
        ))}
      </select>
      <button
        className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
        type="submit"
      >
        Add Service
      </button>
    </form>
  );
}

function EditTicketItemForm({
  error,
  item,
}: {
  error?: string;
  item: PosTicketItemWithRelations;
}) {
  return (
    <form
      action={updatePosTicketItem}
      className="mt-3 grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-4"
    >
      <input name="item_id" type="hidden" value={item.id} />

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-4">
          {error}
        </p>
      ) : null}

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Quantity</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={formatQuantity(item.quantity)}
          min="0.01"
          name="quantity"
          required
          step="0.01"
          type="number"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Unit Price</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={item.unit_price}
          min="0"
          name="unit_price"
          required
          step="0.01"
          type="number"
        />
      </label>

      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-zinc-700">Notes</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={item.notes ?? ""}
          name="notes"
          type="text"
        />
      </label>

      <div className="flex flex-wrap gap-3 sm:col-span-4">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Save Item
        </button>
        <Link
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
          href="/pos-tickets"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function AssignStaffForm({
  item,
  staff,
}: {
  item: PosTicketItemWithRelations;
  staff: PosTicketStaffOption[];
}) {
  return (
    <form action={updatePosTicketItemStaff} className="flex flex-wrap gap-2">
      <input name="item_id" type="hidden" value={item.id} />
      <select
        className="min-w-36 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-950 outline-none focus:border-zinc-950"
        defaultValue={item.assigned_staff_id ?? ""}
        name="assigned_staff_id"
      >
        <option value="">No staff</option>
        {staff.map((member) => (
          <option key={member.id} value={member.id}>
            {member.display_name} - {STAFF_WORKDAY_STATUS_LABELS[member.today_status]}
          </option>
        ))}
      </select>
      <button
        className="rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-950"
        type="submit"
      >
        Save
      </button>
    </form>
  );
}

function CheckoutSection({
  error,
  paid,
  remaining,
  subtotal,
  total,
  ticket,
}: {
  error?: string;
  paid: number;
  remaining: number;
  subtotal: number;
  total: number;
  ticket: PosTicketWithRelations;
}) {
  const hasItems = (ticket.ticket_items ?? []).length > 0;
  const totalCents = toCents(total);
  const paidCents = toCents(paid);
  const remainingCents = toCents(remaining);
  const checkoutAvailable =
    hasItems &&
    totalCents > 0 &&
    paidCents === totalCents &&
    remainingCents === 0;
  const checkoutUnavailableReason = !hasItems
    ? "Add at least one ticket item before checkout."
    : totalCents <= 0
      ? "Ticket Total must be greater than 0 before checkout."
      : paidCents > totalCents || remainingCents < 0
        ? "Paid Total cannot exceed Total."
        : paidCents < totalCents || remainingCents > 0
          ? "Collect full payment before checkout."
          : "";

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      {error ? (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-700">
          <p>Subtotal: {formatMoney(subtotal)}</p>
          <p className="mt-1 font-semibold text-zinc-950">
            Total: {formatMoney(total)}
          </p>
          <p className="mt-1 text-zinc-700">Paid: {formatMoney(paid)}</p>
          <p className="mt-1 text-zinc-700">
            Remaining: {formatMoney(remaining)}
          </p>
        </div>
        {checkoutAvailable ? (
          <form action={closePosTicket}>
            <input name="ticket_id" type="hidden" value={ticket.id} />
            <button
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              type="submit"
            >
              Checkout / Close Ticket
            </button>
          </form>
        ) : null}
      </div>
      {checkoutAvailable ? null : (
        <p className="mt-3 text-sm text-zinc-600">{checkoutUnavailableReason}</p>
      )}
    </div>
  );
}

function AddPaymentForm({
  error,
  ticket,
}: {
  error?: string;
  ticket: PosTicketWithRelations;
}) {
  return (
    <form
      action={addPosPayment}
      className="mt-4 grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-4"
    >
      <input name="ticket_id" type="hidden" value={ticket.id} />

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-4">
          {error}
        </p>
      ) : null}

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Amount</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          min="0.01"
          name="amount"
          required
          step="0.01"
          type="number"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Payment Method</span>
        <select
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue="cash"
          name="payment_method"
          required
        >
          {POS_PAYMENT_METHOD_OPTIONS.map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Note</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="note"
          type="text"
        />
      </label>

      <div className="sm:col-span-4">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Add Payment
        </button>
      </div>
    </form>
  );
}

function PaymentsSection({
  balanceDue,
  canManageTickets,
  error,
  paidTotal,
  payments,
  ticket,
  total,
}: {
  balanceDue: number;
  canManageTickets: boolean;
  error?: string;
  paidTotal: number;
  payments: PosPayment[];
  ticket: PosTicketWithRelations;
  total: number;
}) {
  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-950">Payments</h3>
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-zinc-700">Total: {formatMoney(total)}</span>
          <span className="text-zinc-700">Paid: {formatMoney(paidTotal)}</span>
          <span className="font-semibold text-zinc-950">
            Remaining: {formatMoney(balanceDue)}
          </span>
        </div>
      </div>

      {payments.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          No payments recorded yet.
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200">
          <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
            <div className="col-span-12 sm:col-span-2">Amount</div>
            <div className="hidden sm:col-span-2 sm:block">Method</div>
            <div className="hidden sm:col-span-3 sm:block">Created Time</div>
            <div className="hidden sm:col-span-3 sm:block">Note</div>
            <div className="hidden sm:col-span-2 sm:block">Actions</div>
          </div>
          <ul className="divide-y divide-zinc-200">
            {payments.map((payment) => (
              <li className="grid grid-cols-12 gap-3 px-4 py-3" key={payment.id}>
                <div className="col-span-12 text-sm font-medium text-zinc-950 sm:col-span-2">
                  {formatMoney(payment.amount)}
                </div>
                <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Method:{" "}
                  </span>
                  {POS_PAYMENT_METHOD_LABELS[payment.payment_method]}
                </div>
                <div className="col-span-12 text-sm text-zinc-700 sm:col-span-3">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Created Time:{" "}
                  </span>
                  {formatTicketDateTime(payment.created_at)}
                </div>
                <div className="col-span-12 text-sm text-zinc-700 sm:col-span-3">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Note:{" "}
                  </span>
                  {payment.note ?? "-"}
                </div>
                <div className="col-span-12 text-sm sm:col-span-2">
                  {canManageTickets ? (
                    <form action={deletePosPayment}>
                      <input name="payment_id" type="hidden" value={payment.id} />
                      <button
                        className="font-medium text-zinc-950 underline"
                        type="submit"
                      >
                        Delete
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManageTickets && ticket.status === "open" ? (
        <AddPaymentForm error={error} ticket={ticket} />
      ) : null}
    </div>
  );
}

function TicketItems({
  canManageTickets,
  error,
  itemEditId,
  items,
  staff,
}: {
  canManageTickets: boolean;
  error?: string;
  itemEditId?: string;
  items: PosTicketItemWithRelations[];
  staff: PosTicketStaffOption[];
}) {
  const staffStatusById = new Map(
    staff.map((member) => [member.id, member.today_status]),
  );

  if (items.length === 0) {
    return (
      <p className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
        No services added yet.
      </p>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200">
      <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-12 sm:col-span-3">Service</div>
        <div className="hidden sm:col-span-2 sm:block">Staff</div>
        <div className="hidden sm:col-span-2 sm:block">Quantity</div>
        <div className="hidden sm:col-span-1 sm:block">Unit Price</div>
        <div className="hidden sm:col-span-2 sm:block">Line Total</div>
        <div className="hidden sm:col-span-2 sm:block">Actions</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {items.map((item) => (
          <li className="px-4 py-3" key={item.id}>
            {canManageTickets && itemEditId === item.id ? (
              <EditTicketItemForm error={error} item={item} />
            ) : (
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-12 sm:col-span-3">
                  <p className="font-medium text-zinc-950">
                    {item.service?.name ?? "Unknown service"}
                  </p>
                  {item.notes ? (
                    <p className="mt-1 text-sm text-zinc-600">{item.notes}</p>
                  ) : null}
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Staff:{" "}
                  </span>
                  {item.assigned_staff?.display_name ?? "-"}
                  {item.assigned_staff_id &&
                  staffStatusById.has(item.assigned_staff_id) ? (
                    <span className="mt-1 block text-xs text-zinc-500">
                      {
                        STAFF_WORKDAY_STATUS_LABELS[
                          staffStatusById.get(item.assigned_staff_id)!
                        ]
                      }
                    </span>
                  ) : null}
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Quantity:{" "}
                  </span>
                  {formatQuantity(item.quantity)}
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-1">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Unit Price:{" "}
                  </span>
                  {formatMoney(item.unit_price)}
                </div>
                <div className="col-span-12 self-center text-sm font-medium text-zinc-950 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Line Total:{" "}
                  </span>
                  {formatMoney(item.line_total)}
                </div>
                <div className="col-span-12 flex flex-wrap gap-3 self-center text-sm sm:col-span-2">
                  {canManageTickets ? (
                    <>
                      <AssignStaffForm item={item} staff={staff} />
                      <Link
                        className="font-medium text-zinc-950 underline"
                        href={`/pos-tickets?itemEdit=${item.id}`}
                      >
                        Edit Item
                      </Link>
                      <form action={deletePosTicketItem}>
                        <input name="item_id" type="hidden" value={item.id} />
                        <button
                          className="font-medium text-zinc-950 underline"
                          type="submit"
                        >
                          Delete
                        </button>
                      </form>
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

function PosTicketList({
  canManageTickets,
  checkoutTicketId,
  editTicketId,
  error,
  itemEditId,
  itemError,
  paymentError,
  paymentsTicketId,
  services,
  staff,
  tickets,
}: {
  canManageTickets: boolean;
  checkoutTicketId?: string;
  editTicketId?: string;
  error?: string;
  itemEditId?: string;
  itemError?: string;
  paymentError?: string;
  paymentsTicketId?: string;
  services: Service[];
  staff: PosTicketStaffOption[];
  tickets: PosTicketWithRelations[];
}) {
  if (tickets.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No tickets yet</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Create your first POS ticket for this salon.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-12 sm:col-span-2">Ticket</div>
        <div className="hidden sm:col-span-3 sm:block">Customer</div>
        <div className="hidden sm:col-span-2 sm:block">Opened</div>
        <div className="hidden sm:col-span-2 sm:block">Closed</div>
        <div className="hidden sm:col-span-1 sm:block">Status</div>
        <div className="hidden sm:col-span-2 sm:block">Actions</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {tickets.map((ticket) => {
          const isOpen = ticket.status === "open";
          const canEditTicket = canManageTickets && isOpen;
          const totals = calculateTicketTotals({
            discountType: ticket.discount_type,
            discountValue: ticket.discount_value,
            items: ticket.ticket_items ?? [],
            payments: ticket.payments ?? [],
            taxRate: ticket.tax_rate,
            tipType: ticket.tip_type,
            tipValue: ticket.tip_value,
          });
          const balanceDue = totals.remaining;
          const showPayments = paymentsTicketId === ticket.id;

          return (
          <li className="px-5 py-4" key={ticket.id}>
            {canEditTicket && editTicketId === ticket.id ? (
              <EditNotesForm error={error} ticket={ticket} />
            ) : (
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-12 sm:col-span-2">
                  <p className="font-medium text-zinc-950">
                    {ticket.ticket_number}
                  </p>
                  {ticket.notes ? (
                    <p className="mt-1 text-sm text-zinc-600">{ticket.notes}</p>
                  ) : null}
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-3">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Customer:{" "}
                  </span>
                  {ticket.customer?.name ?? "Unknown customer"}
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Opened:{" "}
                  </span>
                  {formatTicketDateTime(ticket.opened_at)}
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Closed:{" "}
                  </span>
                  {formatTicketDateTime(ticket.closed_at)}
                </div>
                <div className="col-span-6 self-center sm:col-span-1">
                  <StatusBadge status={ticket.status} />
                </div>
                <div className="col-span-12 flex flex-wrap gap-3 self-center text-sm sm:col-span-2">
                  <Link
                    className="font-medium text-zinc-950 underline"
                    href={`/pos-tickets/${ticket.id}`}
                  >
                    View Detail
                  </Link>
                  <Link
                    className="font-medium text-zinc-950 underline"
                    href={
                      showPayments
                        ? "/pos-tickets"
                        : `/pos-tickets?payments=${ticket.id}`
                    }
                  >
                    {showPayments ? "Hide Payments" : "View Payments"}
                  </Link>
                  {canEditTicket ? (
                    <>
                      <Link
                        className="font-medium text-zinc-950 underline"
                        href={`/pos-tickets?edit=${ticket.id}`}
                      >
                        Edit Notes
                      </Link>
                      <form action={cancelPosTicket}>
                        <input
                          name="ticket_id"
                          type="hidden"
                          value={ticket.id}
                        />
                        <input name="return_to" type="hidden" value="/pos-tickets" />
                        <input
                          aria-label="Cancel note"
                          className="mr-2 max-w-32 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-950 outline-none focus:border-zinc-950"
                          name="note"
                          placeholder="Note"
                          required
                          type="text"
                        />
                        <button
                          className="font-medium text-zinc-950 underline"
                          type="submit"
                        >
                          Cancel
                        </button>
                      </form>
                    </>
                  ) : null}
                </div>
              </div>
            )}
            {editTicketId === ticket.id ? null : (
              <div className="mt-4 border-t border-zinc-100 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-zinc-950">
                    Ticket Items
                  </h3>
                  <div className="flex flex-wrap justify-end gap-4 text-sm">
                    <span className="font-semibold text-zinc-950">
                      Total: {formatMoney(totals.total)}
                    </span>
                    <span className="text-zinc-700">
                      Paid: {formatMoney(totals.paid)}
                    </span>
                    <span className="font-semibold text-zinc-950">
                      Remaining: {formatMoney(balanceDue)}
                    </span>
                  </div>
                </div>
                <TicketItems
                  canManageTickets={canEditTicket}
                  error={itemError}
                  itemEditId={itemEditId}
                  items={ticket.ticket_items ?? []}
                  staff={staff}
                />
                {canEditTicket ? (
                  <AddTicketItemForm services={services} ticket={ticket} />
                ) : null}
                {canEditTicket ? (
                  <CheckoutSection
                    error={checkoutTicketId === ticket.id ? error : undefined}
                    paid={totals.paid}
                    remaining={totals.remaining}
                    subtotal={totals.subtotal}
                    total={totals.total}
                    ticket={ticket}
                  />
                ) : null}
                {showPayments ? (
                  <PaymentsSection
                    balanceDue={balanceDue}
                    canManageTickets={canEditTicket}
                    error={paymentError}
                    paidTotal={totals.paid}
                    payments={ticket.payments ?? []}
                    ticket={ticket}
                    total={totals.total}
                  />
                ) : null}
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}

export default async function PosTicketsPage({
  searchParams,
}: PosTicketsPageProps) {
  const [{ checkout, edit, error, itemEdit, payments }, context] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return <MissingSalonState />;
  }

  const canViewTickets = await hasPermission(POS_TICKET_PERMISSIONS.view, context);

  if (!canViewTickets) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">POS Tickets</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Manage customer service sessions for this salon.
        </p>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to view POS tickets.
        </p>
      </main>
    );
  }

  const canManageTickets = await hasPermission(
    POS_TICKET_PERMISSIONS.manage,
    context,
  );
  const [{ tickets }, options] = await Promise.all([
    getCurrentSalonPosTickets(),
    canManageTickets
      ? getCurrentSalonPosTicketOptions(context)
      : Promise.resolve({ customers: [], services: [], staff: [] }),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="border-b border-zinc-200 pb-6">
        <h1 className="text-3xl font-semibold text-zinc-950">POS Tickets</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Manage customer service sessions for this salon.
        </p>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Create Ticket</h2>
        {canManageTickets ? (
          <PosTicketForm customers={options.customers} error={edit ? undefined : error} />
        ) : (
          <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
            You do not have permission to manage POS tickets.
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-950">POS Tickets</h2>
        <PosTicketList
          canManageTickets={canManageTickets}
          checkoutTicketId={checkout}
          editTicketId={edit}
          error={edit || checkout ? error : undefined}
          itemEditId={itemEdit}
          itemError={itemEdit ? error : undefined}
          paymentError={payments ? error : undefined}
          paymentsTicketId={payments}
          services={options.services}
          staff={options.staff}
          tickets={tickets}
        />
      </section>
    </main>
  );
}
