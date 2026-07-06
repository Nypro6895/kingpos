import {
  addPosPayment,
  addPosTicketItem,
  cancelPosTicket,
  closePosTicket,
  deletePosPayment,
  deletePosTicketItem,
  reopenPosTicket,
  updatePosTicketDiscount,
  updatePosTicketItemStaff,
  updatePosTicketTaxRate,
  updatePosTicketTip,
  voidPosTicket,
} from "@/app/pos-tickets/actions";
import {
  getCurrentSalonPosTicket,
  getCurrentSalonPosTicketOptions,
  type PosTicketStaffOption,
  POS_TICKET_PERMISSIONS,
} from "@/lib/pos-tickets";
import { getCurrentBusinessContext } from "@/lib/current-context";
import {
  POS_PAYMENT_METHOD_LABELS,
  POS_PAYMENT_METHOD_OPTIONS,
} from "@/lib/pos-payments";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { buildTicketReceipt } from "@/lib/pos-ticket-receipt";
import { getTicketTimeline } from "@/lib/pos-ticket-timeline";
import { hasPermission } from "@/lib/permissions";
import type {
  PosTicketDiscountType,
  PosTicketStatus,
  PosTicketTipType,
} from "@/types/pos-ticket";
import type { Service } from "@/types/service";
import { STAFF_WORKDAY_STATUS_LABELS } from "@/lib/staff-workdays";
import Link from "next/link";
import { redirect } from "next/navigation";

type PosTicketDetailPageProps = {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{ error?: string }>;
};

const STATUS_LABELS: Record<PosTicketStatus, string> = {
  open: "Open",
  closed: "Closed",
  cancelled: "Cancelled",
  voided: "Voided",
};

const DISCOUNT_TYPE_LABELS: Record<PosTicketDiscountType, string> = {
  fixed_amount: "Fixed Amount",
  percentage: "Percentage",
};

const TIP_TYPE_LABELS: Record<PosTicketTipType, string> = {
  fixed_amount: "Fixed Amount",
  percentage: "Percentage",
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

function formatDuration(value: number | null | undefined) {
  if (!value) {
    return "-";
  }

  return `${value} min`;
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
      <h1 className="text-3xl font-semibold text-zinc-950">POS Ticket</h1>
      <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        Please select a salon first.
      </p>
    </main>
  );
}

function AddServiceForm({
  returnPath,
  services,
  ticketId,
}: {
  returnPath: string;
  services: Service[];
  ticketId: string;
}) {
  return (
    <form action={addPosTicketItem} className="mt-4 flex flex-col gap-3 sm:flex-row">
      <input name="ticket_id" type="hidden" value={ticketId} />
      <input name="return_to" type="hidden" value={returnPath} />
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
        Add Item
      </button>
    </form>
  );
}

function AssignStaffForm({
  itemId,
  returnPath,
  staff,
  staffId,
}: {
  itemId: string;
  returnPath: string;
  staff: PosTicketStaffOption[];
  staffId: string | null;
}) {
  return (
    <form action={updatePosTicketItemStaff} className="flex flex-wrap gap-2">
      <input name="item_id" type="hidden" value={itemId} />
      <input name="return_to" type="hidden" value={returnPath} />
      <select
        className="min-w-36 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-950 outline-none focus:border-zinc-950"
        defaultValue={staffId ?? ""}
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

function AddPaymentForm({
  remaining,
  returnPath,
  ticketId,
}: {
  remaining: number;
  returnPath: string;
  ticketId: string;
}) {
  const defaultAmount = remaining > 0 ? remaining.toFixed(2) : "";

  return (
    <form
      action={addPosPayment}
      className="mt-4 grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-3"
    >
      <input name="ticket_id" type="hidden" value={ticketId} />
      <input name="return_to" type="hidden" value={returnPath} />

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Method</span>
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
        <span className="text-sm font-medium text-zinc-700">Amount</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={defaultAmount}
          min="0.01"
          name="amount"
          required
          step="0.01"
          type="number"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Note</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="note"
          type="text"
        />
      </label>

      <div className="sm:col-span-3">
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

function WorkflowActionForm({
  action,
  buttonLabel,
  returnPath,
  ticketId,
}: {
  action: (formData: FormData) => Promise<void>;
  buttonLabel: string;
  returnPath: string;
  ticketId: string;
}) {
  return (
    <form action={action} className="grid gap-3 rounded-md border border-zinc-200 bg-white p-4">
      <input name="ticket_id" type="hidden" value={ticketId} />
      <input name="return_to" type="hidden" value={returnPath} />
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Note</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          minLength={1}
          name="note"
          required
          type="text"
        />
      </label>
      <button
        className="w-fit rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
        type="submit"
      >
        {buttonLabel}
      </button>
    </form>
  );
}

function DiscountForm({
  discountType,
  discountValue,
  returnPath,
  ticketId,
}: {
  discountType: PosTicketDiscountType;
  discountValue: number;
  returnPath: string;
  ticketId: string;
}) {
  return (
    <form
      action={updatePosTicketDiscount}
      className="mt-4 grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-3"
    >
      <input name="ticket_id" type="hidden" value={ticketId} />
      <input name="return_to" type="hidden" value={returnPath} />

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Discount Type</span>
        <select
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={discountType}
          name="discount_type"
          required
        >
          <option value="fixed_amount">Fixed Amount</option>
          <option value="percentage">Percentage</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Discount Value</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={discountValue}
          min="0"
          name="discount_value"
          required
          step="0.01"
          type="number"
        />
      </label>

      <div className="self-end">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Save
        </button>
      </div>
    </form>
  );
}

function TaxForm({
  returnPath,
  taxRate,
  ticketId,
}: {
  returnPath: string;
  taxRate: number;
  ticketId: string;
}) {
  return (
    <form
      action={updatePosTicketTaxRate}
      className="mt-4 grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2"
    >
      <input name="ticket_id" type="hidden" value={ticketId} />
      <input name="return_to" type="hidden" value={returnPath} />

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Tax Rate (%)</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={taxRate}
          max="100"
          min="0"
          name="tax_rate"
          required
          step="0.01"
          type="number"
        />
      </label>

      <div className="self-end">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Save
        </button>
      </div>
    </form>
  );
}

function TipForm({
  returnPath,
  ticketId,
  tipType,
  tipValue,
}: {
  returnPath: string;
  ticketId: string;
  tipType: PosTicketTipType;
  tipValue: number;
}) {
  return (
    <form
      action={updatePosTicketTip}
      className="mt-4 grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-3"
    >
      <input name="ticket_id" type="hidden" value={ticketId} />
      <input name="return_to" type="hidden" value={returnPath} />

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Tip Type</span>
        <select
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={tipType}
          name="tip_type"
          required
        >
          <option value="fixed_amount">Fixed Amount</option>
          <option value="percentage">Percentage</option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Tip Value</span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={tipValue}
          min="0"
          name="tip_value"
          required
          step="0.01"
          type="number"
        />
      </label>

      <div className="self-end">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Save
        </button>
      </div>
    </form>
  );
}

export default async function PosTicketDetailPage({
  params,
  searchParams,
}: PosTicketDetailPageProps) {
  const [{ ticketId }, { error }, context] = await Promise.all([
    params,
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
        <h1 className="text-3xl font-semibold text-zinc-950">POS Ticket</h1>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to view POS tickets.
        </p>
      </main>
    );
  }

  const [{ ticket }, canManageTickets, canVoidTickets] = await Promise.all([
    getCurrentSalonPosTicket(ticketId),
    hasPermission(POS_TICKET_PERMISSIONS.manage, context),
    hasPermission(POS_TICKET_PERMISSIONS.void, context),
  ]);

  if (!ticket) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">POS Ticket</h1>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          POS Ticket was not found for the current salon.
        </p>
      </main>
    );
  }

  const isOpen = ticket.status === "open";
  const isClosed = ticket.status === "closed";
  const canWorkTicket = canManageTickets && isOpen;
  const canVoidOrReopenTicket = canVoidTickets && isClosed;
  const returnPath = `/pos-tickets/${ticket.id}`;
  const totals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items: ticket.ticket_items ?? [],
    payments: ticket.payments ?? [],
    taxRate: ticket.tax_rate,
    tipType: ticket.tip_type,
    tipValue: ticket.tip_value,
  });
  const options = canWorkTicket
    ? await getCurrentSalonPosTicketOptions(context)
    : { services: [], staff: [] };
  const hasItems = (ticket.ticket_items ?? []).length > 0;
  const totalCents = toCents(totals.total);
  const paidCents = toCents(totals.paid);
  const remainingCents = toCents(totals.remaining);
  const paymentStatus =
    paidCents <= 0
      ? "Unpaid"
      : remainingCents === 0 && paidCents === totalCents
        ? "Paid"
        : "Partially Paid";
  const paymentProgress =
    totalCents > 0
      ? Math.min(100, Math.max(0, (paidCents / totalCents) * 100))
      : 0;
  const checkoutAvailable =
    canWorkTicket &&
    hasItems &&
    totalCents > 0 &&
    paidCents === totalCents &&
    remainingCents === 0;
  const checkoutUnavailableReason = !hasItems
    ? "Add at least one service before checkout."
    : totalCents <= 0
      ? "Ticket Total must be greater than 0 before checkout."
      : paidCents > totalCents || remainingCents < 0
        ? "Paid Total cannot exceed Total."
        : paidCents < totalCents || remainingCents > 0
          ? "Collect full payment before checkout."
          : "";
  const receipt = buildTicketReceipt({
    customer: ticket.customer,
    items: ticket.ticket_items ?? [],
    payments: ticket.payments ?? [],
    salon: context.currentSalon,
    ticket,
    totals,
  });
  const timeline = getTicketTimeline(ticket);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="border-b border-zinc-200 pb-6">
        <Link className="text-sm font-medium text-zinc-950 underline" href="/pos-tickets">
          Back to POS Tickets
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-zinc-950">
            {ticket.ticket_number}
          </h1>
          <StatusBadge status={ticket.status} />
        </div>
        <div className="mt-4 grid gap-3 text-sm text-zinc-700 sm:grid-cols-3">
          <p>
            <span className="font-medium text-zinc-950">Created Time:</span>{" "}
            {formatTicketDateTime(ticket.created_at)}
          </p>
          <p>
            <span className="font-medium text-zinc-950">Closed Time:</span>{" "}
            {formatTicketDateTime(ticket.closed_at)}
          </p>
          <p>
            <span className="font-medium text-zinc-950">Assigned Salon:</span>{" "}
            {context.currentSalon.name}
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Customer</h2>
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-5 text-sm text-zinc-700">
          <p className="font-medium text-zinc-950">
            {ticket.customer?.name ?? "Unknown customer"}
          </p>
          <p className="mt-1">{ticket.customer?.phone ?? "-"}</p>
          <p className="mt-1">{ticket.customer?.email ?? "-"}</p>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-950">Services</h2>
          {canWorkTicket ? (
            <span className="text-sm font-medium text-zinc-700">
              Service Actions
            </span>
          ) : null}
        </div>

        {(ticket.ticket_items ?? []).length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
            No services added yet.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
              <div className="col-span-12 sm:col-span-3">Service</div>
              <div className="hidden sm:col-span-1 sm:block">Duration</div>
              <div className="hidden sm:col-span-1 sm:block">Price</div>
              <div className="hidden sm:col-span-2 sm:block">Assigned Staff</div>
              <div className="hidden sm:col-span-1 sm:block">Quantity</div>
              <div className="hidden sm:col-span-2 sm:block">Subtotal</div>
              <div className="hidden sm:col-span-2 sm:block">Actions</div>
            </div>
            <ul className="divide-y divide-zinc-200">
              {(ticket.ticket_items ?? []).map((item) => (
                <li className="grid grid-cols-12 gap-3 px-4 py-3" key={item.id}>
                  <div className="col-span-12 text-sm font-medium text-zinc-950 sm:col-span-3">
                    {item.service?.name ?? "Unknown service"}
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-1">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      Duration:{" "}
                    </span>
                    {formatDuration(item.service?.duration_minutes)}
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-1">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      Price:{" "}
                    </span>
                    {formatMoney(item.unit_price)}
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                    {canWorkTicket ? (
                      <AssignStaffForm
                        itemId={item.id}
                        returnPath={returnPath}
                        staff={options.staff}
                        staffId={item.assigned_staff_id}
                      />
                    ) : (
                      <>
                        <span className="font-medium text-zinc-500 sm:hidden">
                          Assigned Staff:{" "}
                        </span>
                        {item.assigned_staff?.display_name ?? "-"}
                      </>
                    )}
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-1">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      Quantity:{" "}
                    </span>
                    {formatQuantity(item.quantity)}
                  </div>
                  <div className="col-span-12 text-sm font-medium text-zinc-950 sm:col-span-2">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      Subtotal:{" "}
                    </span>
                    {formatMoney(item.line_total)}
                  </div>
                  <div className="col-span-12 text-sm sm:col-span-2">
                    {canWorkTicket ? (
                      <form action={deletePosTicketItem}>
                        <input name="item_id" type="hidden" value={item.id} />
                        <input name="return_to" type="hidden" value={returnPath} />
                        <button
                          className="font-medium text-zinc-950 underline"
                          type="submit"
                        >
                          Remove Item
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canWorkTicket ? (
          <AddServiceForm
            returnPath={returnPath}
            services={options.services}
            ticketId={ticket.id}
          />
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Discount</h2>
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm sm:grid-cols-5">
          <p>
            <span className="block text-zinc-500">Current Discount</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.discount_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Discount Type</span>
            <span className="font-semibold text-zinc-950">
              {DISCOUNT_TYPE_LABELS[ticket.discount_type]}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Discount Value</span>
            <span className="font-semibold text-zinc-950">
              {ticket.discount_type === "percentage"
                ? `${ticket.discount_value}%`
                : formatMoney(ticket.discount_value)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Discounted Amount</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.discount_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Updated Total</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.total)}
            </span>
          </p>
        </div>

        {canWorkTicket ? (
          <DiscountForm
            discountType={ticket.discount_type}
            discountValue={ticket.discount_value}
            returnPath={returnPath}
            ticketId={ticket.id}
          />
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Tax</h2>
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm sm:grid-cols-4">
          <p>
            <span className="block text-zinc-500">Tax Rate</span>
            <span className="font-semibold text-zinc-950">
              {ticket.tax_rate}%
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Taxable Amount</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.taxable_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Calculated Tax</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.tax_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Updated Total</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.total)}
            </span>
          </p>
        </div>

        {canWorkTicket ? (
          <TaxForm
            returnPath={returnPath}
            taxRate={ticket.tax_rate}
            ticketId={ticket.id}
          />
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Tip</h2>
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm sm:grid-cols-5">
          <p>
            <span className="block text-zinc-500">Tip Type</span>
            <span className="font-semibold text-zinc-950">
              {TIP_TYPE_LABELS[ticket.tip_type]}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Tip Value</span>
            <span className="font-semibold text-zinc-950">
              {ticket.tip_type === "percentage"
                ? `${ticket.tip_value}%`
                : formatMoney(ticket.tip_value)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Calculated Tip</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.tip_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Updated Total</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.total)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Remaining</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.remaining)}
            </span>
          </p>
        </div>

        {canWorkTicket ? (
          <TipForm
            returnPath={returnPath}
            ticketId={ticket.id}
            tipType={ticket.tip_type}
            tipValue={ticket.tip_value}
          />
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Payment Summary</h2>
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm sm:grid-cols-5">
          <p>
            <span className="block text-zinc-500">Subtotal</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.subtotal)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Total</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.total)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Paid</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.paid)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Remaining</span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.remaining)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Payment Status</span>
            <span className="font-semibold text-zinc-950">
              {paymentStatus}
            </span>
          </p>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-950">Payments</h2>
          {canWorkTicket ? (
            <span className="text-sm font-medium text-zinc-700">
              Payment Actions
            </span>
          ) : null}
        </div>

        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-5 text-sm">
          <div className="grid gap-3 sm:grid-cols-4">
            <p>
              <span className="block text-zinc-500">Total</span>
              <span className="font-semibold text-zinc-950">
                {formatMoney(totals.total)}
              </span>
            </p>
            <p>
              <span className="block text-zinc-500">Paid</span>
              <span className="font-semibold text-zinc-950">
                {formatMoney(totals.paid)}
              </span>
            </p>
            <p>
              <span className="block text-zinc-500">Remaining</span>
              <span className="font-semibold text-zinc-950">
                {formatMoney(totals.remaining)}
              </span>
            </p>
            <p>
              <span className="block text-zinc-500">Payment Progress</span>
              <span className="font-semibold text-zinc-950">
                {paymentProgress.toFixed(0)}%
              </span>
            </p>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full bg-zinc-950"
              style={{ width: `${paymentProgress}%` }}
            />
          </div>
        </div>

        {(ticket.payments ?? []).length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
            No payments recorded yet.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
              <div className="col-span-12 sm:col-span-3">Method</div>
              <div className="hidden sm:col-span-2 sm:block">Amount</div>
              <div className="hidden sm:col-span-3 sm:block">Created Time</div>
              <div className="hidden sm:col-span-2 sm:block">Note</div>
              <div className="hidden sm:col-span-2 sm:block">Actions</div>
            </div>
            <ul className="divide-y divide-zinc-200">
              {(ticket.payments ?? []).map((payment) => (
                <li
                  className="grid grid-cols-12 gap-3 px-4 py-3"
                  key={payment.id}
                >
                  <div className="col-span-12 text-sm font-medium text-zinc-950 sm:col-span-3">
                    {POS_PAYMENT_METHOD_LABELS[payment.payment_method]}
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      Amount:{" "}
                    </span>
                    {formatMoney(payment.amount)}
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-3">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      Created Time:{" "}
                    </span>
                    {formatTicketDateTime(payment.created_at)}
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      Note:{" "}
                    </span>
                    {payment.note ?? "-"}
                  </div>
                  <div className="col-span-12 text-sm sm:col-span-2">
                    {canWorkTicket ? (
                      <form action={deletePosPayment}>
                        <input name="payment_id" type="hidden" value={payment.id} />
                        <input name="return_to" type="hidden" value={returnPath} />
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

        {canWorkTicket && remainingCents > 0 ? (
          <AddPaymentForm
            remaining={totals.remaining}
            returnPath={returnPath}
            ticketId={ticket.id}
          />
        ) : null}
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-950">Receipt Preview</h2>
          <span className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700">
            {receipt.header.receipt_status}
          </span>
        </div>
        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-5">
          <div className="border-b border-zinc-200 pb-4 text-sm">
            <p className="text-lg font-semibold text-zinc-950">
              {receipt.header.salon_name}
            </p>
            {receipt.header.salon_phone ? (
              <p className="mt-1 text-zinc-700">{receipt.header.salon_phone}</p>
            ) : null}
            <div className="mt-4 grid gap-2 text-zinc-700 sm:grid-cols-2">
              <p>
                <span className="font-medium text-zinc-950">Ticket:</span>{" "}
                {receipt.header.ticket_number}
              </p>
              <p>
                <span className="font-medium text-zinc-950">Status:</span>{" "}
                {receipt.header.ticket_status}
              </p>
              <p>
                <span className="font-medium text-zinc-950">Customer:</span>{" "}
                {receipt.header.customer_name}
              </p>
              <p>
                <span className="font-medium text-zinc-950">Created:</span>{" "}
                {formatTicketDateTime(receipt.header.created_time)}
              </p>
              <p>
                <span className="font-medium text-zinc-950">Closed:</span>{" "}
                {formatTicketDateTime(receipt.header.closed_time)}
              </p>
            </div>
          </div>

          <div className="border-b border-zinc-200 py-4">
            <h3 className="text-sm font-semibold text-zinc-950">Items</h3>
            {receipt.items.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600">No items.</p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-100">
                {receipt.items.map((item, index) => (
                  <li className="grid gap-2 py-3 text-sm sm:grid-cols-5" key={`${item.service_name}-${index}`}>
                    <p className="font-medium text-zinc-950">{item.service_name}</p>
                    <p className="text-zinc-700">{item.assigned_staff}</p>
                    <p className="text-zinc-700">Qty {formatQuantity(item.quantity)}</p>
                    <p className="text-zinc-700">{formatMoney(item.unit_price)}</p>
                    <p className="font-medium text-zinc-950">
                      {formatMoney(item.line_total)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid gap-6 border-b border-zinc-200 py-4 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-zinc-950">Totals</h3>
              <dl className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600">Subtotal</dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.subtotal)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600">Discount</dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.discount)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600">Tax</dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.tax)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600">Tip</dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.tip)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2">
                  <dt className="font-semibold text-zinc-950">Grand Total</dt>
                  <dd className="font-semibold text-zinc-950">
                    {formatMoney(receipt.totals.grand_total)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600">Paid</dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.paid)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600">Remaining</dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.remaining)}
                  </dd>
                </div>
              </dl>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-zinc-950">Payments</h3>
              {receipt.payments.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-600">No payments.</p>
              ) : (
                <ul className="mt-3 divide-y divide-zinc-100">
                  {receipt.payments.map((payment, index) => (
                    <li className="flex justify-between gap-3 py-3 text-sm" key={`${payment.method}-${index}`}>
                      <div>
                        <p className="font-medium text-zinc-950">{payment.method}</p>
                        <p className="text-xs text-zinc-500">
                          {formatTicketDateTime(payment.created_time)}
                        </p>
                      </div>
                      <p className="font-medium text-zinc-950">
                        {formatMoney(payment.amount)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <p className="pt-4 text-center text-sm text-zinc-700">
            {receipt.footer.message}
          </p>
        </div>
      </section>

      {canWorkTicket || canVoidOrReopenTicket ? (
        <section className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 p-5">
          <h2 className="text-lg font-semibold text-zinc-950">Actions</h2>
          {canWorkTicket && !checkoutAvailable ? (
            <p className="mt-3 text-sm text-zinc-600">
              {checkoutUnavailableReason}
            </p>
          ) : null}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {canWorkTicket ? (
              <>
                {checkoutAvailable ? (
                  <form action={closePosTicket} className="rounded-md border border-zinc-200 bg-white p-4">
                    <input name="ticket_id" type="hidden" value={ticket.id} />
                    <input name="return_to" type="hidden" value={returnPath} />
                    <button
                      className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
                      type="submit"
                    >
                      Checkout
                    </button>
                  </form>
                ) : null}
                <WorkflowActionForm
                  action={cancelPosTicket}
                  buttonLabel="Cancel Ticket"
                  returnPath={returnPath}
                  ticketId={ticket.id}
                />
              </>
            ) : null}
            {canVoidOrReopenTicket ? (
              <>
                <WorkflowActionForm
                  action={voidPosTicket}
                  buttonLabel="Void Ticket"
                  returnPath={returnPath}
                  ticketId={ticket.id}
                />
                <WorkflowActionForm
                  action={reopenPosTicket}
                  buttonLabel="Reopen Ticket"
                  returnPath={returnPath}
                  ticketId={ticket.id}
                />
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Activity Timeline</h2>
        {timeline.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
            No activity yet.
          </p>
        ) : (
          <ol className="mt-4 border-l border-zinc-200">
            {timeline.map((item) => (
              <li className="relative pb-5 pl-5" key={item.id}>
                <span className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border border-zinc-300 bg-white" />
                <div className="rounded-lg border border-zinc-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-950">
                      {item.label}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {formatTicketDateTime(item.timestamp)}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-zinc-700">User: {item.user}</p>
                  {item.note ? (
                    <p className="mt-2 text-sm text-zinc-700">{item.note}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
