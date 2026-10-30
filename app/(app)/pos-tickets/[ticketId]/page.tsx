import { withExperiencePage } from "@/components/experience-page";
import { getWorkspaceTranslation } from "@/lib/workspace-language-server";
import { WorkspaceText } from "@/components/workspace-language";
import { ContextualSupport } from "@/components/contextual-support";
import { isOwnerMembership } from "@/lib/current-context";

import { SubmitButton } from "@/components/submit-button";
import {
  addPosPayment,
  addPosTicketItem,
  cancelPosTicket,
  closePosTicket,
  deletePosPayment,
  deletePosTicketItem,
  reopenPosTicket,
  updatePosTicketDiscount,
  updatePosTicketItem,
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
import {
  POS_PAYMENT_METHOD_LABELS,
  POS_PAYMENT_METHOD_OPTIONS,
} from "@/lib/pos-payments";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { buildTicketReceipt } from "@/lib/pos-ticket-receipt";
import { getTicketTimeline } from "@/lib/pos-ticket-timeline";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import type {
  PosTicketDiscountType,
  PosTicketStatus,
  PosTicketTipType,
} from "@/types/pos-ticket";
import type { Service } from "@/types/service";
import { STAFF_WORKDAY_STATUS_LABELS } from "@/lib/staff-workdays";
import Link from "next/link";

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
      <WorkspaceText text={STATUS_LABELS[status]} />
    </span>
  );
}

function TicketInputFields({revision,note=true}:{revision:number;note?:boolean}) {
  return <>
    <input name="expected_revision" type="hidden" value={revision} />
    <input name="request_id" type="hidden" value={crypto.randomUUID()} />
    {note?<label className="block text-sm text-zinc-700"><WorkspaceText text="Edit note" /><input className="mt-1 min-h-10 w-full rounded border border-zinc-300 px-2 text-base" name="correction_reason" required maxLength={1000} /></label>:null}
  </>;
}

function ItemPriceForm({itemId,quantity,unitPrice,revision,returnPath}:{itemId:string;quantity:number;unitPrice:number;revision:number;returnPath:string}) {
  return <details className="mt-2"><summary className="cursor-pointer text-xs underline"><WorkspaceText text="Edit amount" /></summary>
    <form action={updatePosTicketItem} className="mt-2 grid gap-2">
      <input name="item_id" type="hidden" value={itemId} /><input name="return_to" type="hidden" value={returnPath} />
      <TicketInputFields revision={revision} />
      <label><WorkspaceText text="Quantity" /><input className="min-h-10 w-24 rounded border px-2" type="number" name="quantity" min="0.01" max="1000" step="0.01" required defaultValue={quantity} /></label>
      <label><WorkspaceText text="Unit price" /><input className="min-h-10 w-24 rounded border px-2" type="number" name="unit_price" min="0" step="0.01" required defaultValue={unitPrice} /></label>
      <SubmitButton type="submit" pendingLabel="Saving…"><WorkspaceText text="Save" /></SubmitButton>
    </form></details>;
}

function AddServiceForm({
  revision,
  returnPath,
  services,
  ticketId,
}: {
  revision: number;
  returnPath: string;
  services: Service[];
  ticketId: string;
}) {
  return (
    <form action={addPosTicketItem} className="mt-4 flex flex-col gap-3 sm:flex-row">
      <input name="ticket_id" type="hidden" value={ticketId} />
      <input name="return_to" type="hidden" value={returnPath} />
      <TicketInputFields revision={revision} />
      <select
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950 sm:max-w-xs"
        defaultValue=""
        name="service_id"
        required
      >
        <option value=""><WorkspaceText text="Add service to ticket" /></option>
        {services.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name} - {formatMoney(service.base_price)}
          </option>
        ))}
      </select>
      <SubmitButton pendingLabel="Saving…"
        className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
        type="submit"
      >
        <WorkspaceText text="Add Item" />
      </SubmitButton>
    </form>
  );
}

function AssignStaffForm({
  revision,
  itemId,
  returnPath,
  staff,
  staffId,
}: {
  itemId: string;
  revision: number;
  returnPath: string;
  staff: PosTicketStaffOption[];
  staffId: string | null;
}) {
  return (
    <form action={updatePosTicketItemStaff} className="flex flex-wrap gap-2">
      <input name="item_id" type="hidden" value={itemId} />
      <input name="return_to" type="hidden" value={returnPath} />
      <TicketInputFields revision={revision} />
      <select
        className="min-w-36 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-950 outline-none focus:border-zinc-950"
        defaultValue={staffId ?? ""}
        name="assigned_staff_id"
      >
        <option value=""><WorkspaceText text="No staff" /></option>
        {staff.map((member) => (
          <option key={member.id} value={member.id}>
            {member.display_name} - <WorkspaceText text={STAFF_WORKDAY_STATUS_LABELS[member.today_status]} />
          </option>
        ))}
      </select>
      <SubmitButton pendingLabel="Saving…"
        className="rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-950"
        type="submit"
      >
        <WorkspaceText text="Save" />
      </SubmitButton>
    </form>
  );
}

function AddPaymentForm({
  revision,
  remaining,
  returnPath,
  ticketId,
}: {
  remaining: number;
  revision: number;
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
      <TicketInputFields revision={revision} note={false} />

      <label className="block">
        <span className="text-sm font-medium text-zinc-700"><WorkspaceText text="Method" /></span>
        <select
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue="cash"
          name="payment_method"
          required
        >
          {POS_PAYMENT_METHOD_OPTIONS.map((method) => (
            <option key={method.value} value={method.value}>
              <WorkspaceText text={method.label} />
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700"><WorkspaceText text="Amount" /></span>
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
        <span className="text-sm font-medium text-zinc-700"><WorkspaceText text="Note" /></span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="note" required maxLength={1000}
          type="text"
        />
      </label>

      <div className="sm:col-span-3">
        <SubmitButton pendingLabel="Saving…"
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          <WorkspaceText text="Add Payment" />
        </SubmitButton>
      </div>
    </form>
  );
}

function WorkflowActionForm({
  revision,
  action,
  buttonLabel,
  returnPath,
  ticketId,
}: {
  action: (formData: FormData) => Promise<void>;
  revision: number;
  buttonLabel: string;
  returnPath: string;
  ticketId: string;
}) {
  return (
    <form action={action} className="grid min-w-0 gap-3 bg-white p-4">
      <input name="ticket_id" type="hidden" value={ticketId} />
      <input name="return_to" type="hidden" value={returnPath} />
      <TicketInputFields revision={revision} note={false} />
      <label className="block">
        <span className="text-sm font-medium text-zinc-700"><WorkspaceText text="Note" /></span>
        <input
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          minLength={1}
          name="note"
          required
          type="text"
        />
      </label>
      <SubmitButton pendingLabel="Processing…"
        className="w-fit rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
        type="submit"
      >
        <WorkspaceText text={buttonLabel} />
      </SubmitButton>
    </form>
  );
}

function DiscountForm({
  revision,
  discountType,
  discountValue,
  returnPath,
  ticketId,
}: {
  discountType: PosTicketDiscountType;
  revision: number;
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
      <TicketInputFields revision={revision} />

      <label className="block">
        <span className="text-sm font-medium text-zinc-700"><WorkspaceText text="Discount Type" /></span>
        <select
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={discountType}
          name="discount_type"
          required
        >
          <option value="fixed_amount"><WorkspaceText text="Fixed Amount" /></option>
          <option value="percentage"><WorkspaceText text="Percentage" /></option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700"><WorkspaceText text="Discount Value" /></span>
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
        <SubmitButton pendingLabel="Saving…"
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          <WorkspaceText text="Save" />
        </SubmitButton>
      </div>
    </form>
  );
}

function TaxForm({
  revision,
  returnPath,
  taxRate,
  ticketId,
}: {
  returnPath: string;
  taxRate: number;
  revision: number;
  ticketId: string;
}) {
  return (
    <form
      action={updatePosTicketTaxRate}
      className="mt-4 grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2"
    >
      <input name="ticket_id" type="hidden" value={ticketId} />
      <input name="return_to" type="hidden" value={returnPath} />
      <TicketInputFields revision={revision} />

      <label className="block">
        <span className="text-sm font-medium text-zinc-700"><WorkspaceText text="Tax Rate (%)" /></span>
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
        <SubmitButton pendingLabel="Saving…"
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          <WorkspaceText text="Save" />
        </SubmitButton>
      </div>
    </form>
  );
}

function TipForm({
  revision,
  returnPath,
  ticketId,
  tipType,
  tipValue,
}: {
  returnPath: string;
  ticketId: string;
  tipType: PosTicketTipType;
  revision: number;
  tipValue: number;
}) {
  return (
    <form
      action={updatePosTicketTip}
      className="mt-4 grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-3"
    >
      <input name="ticket_id" type="hidden" value={ticketId} />
      <input name="return_to" type="hidden" value={returnPath} />
      <TicketInputFields revision={revision} />

      <label className="block">
        <span className="text-sm font-medium text-zinc-700"><WorkspaceText text="Tip Type" /></span>
        <select
          className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={tipType}
          name="tip_type"
          required
        >
          <option value="fixed_amount"><WorkspaceText text="Fixed Amount" /></option>
          <option value="percentage"><WorkspaceText text="Percentage" /></option>
        </select>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700"><WorkspaceText text="Tip Value" /></span>
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
        <SubmitButton pendingLabel="Saving…"
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          <WorkspaceText text="Save" />
        </SubmitButton>
      </div>
    </form>
  );
}

async function PosTicketDetailPage({
  params,
  searchParams,
}: PosTicketDetailPageProps) {
  const __vt = await getWorkspaceTranslation();

  const [{ ticketId }, { error }, context] = await Promise.all([
    params,
    searchParams,
    params.then(({ ticketId: id }) =>
      requireSalonManagePageContext(`/pos-tickets/${id}`),
    ),
  ]);

  const canViewTickets = await hasPermission(POS_TICKET_PERMISSIONS.view, context);

  if (!canViewTickets) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          <WorkspaceText text="You do not have permission to view POS tickets." />
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
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          <WorkspaceText text="POS Ticket was not found for the current salon." />
        </p>
      </main>
    );
  }

  const isOpen = ticket.status === "open";
  const isClosed = ticket.status === "closed";
  const canWorkTicket = isOwnerMembership(context.currentMembership) && canManageTickets && isOpen;
  const canVoidOrReopenTicket = isOwnerMembership(context.currentMembership) && canVoidTickets && isClosed;
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
    <main className="min-w-0 w-full px-4 py-6 sm:px-6">
      <div className="border-b border-zinc-200 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link className="text-sm font-medium text-zinc-950 underline" href="/pos-tickets">
          <WorkspaceText text="Back to POS Tickets" />
          </Link>
          <div className="flex items-center gap-3"><StatusBadge status={ticket.status} /><ContextualSupport /></div>
        </div>
        <div className="mt-4 grid gap-3 text-sm text-zinc-700 sm:grid-cols-4">
          <p>
            <span className="font-medium text-zinc-950"><WorkspaceText text="Ticket:" /></span>{" "}
            {ticket.ticket_number}
          </p>
          <p>
            <span className="font-medium text-zinc-950"><WorkspaceText text="Created Time:" /></span>{" "}
            <WorkspaceText text={formatTicketDateTime(ticket.created_at)} />
          </p>
          <p>
            <span className="font-medium text-zinc-950"><WorkspaceText text="Closed Time:" /></span>{" "}
            <WorkspaceText text={formatTicketDateTime(ticket.closed_at)} />
          </p>
          <p>
            <span className="font-medium text-zinc-950"><WorkspaceText text="Assigned Salon:" /></span>{" "}
            {context.currentSalon.name}
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <WorkspaceText text={error} />
        </p>
      ) : null}

      {ticket.source_booking_id ? (
        <section className="mt-8 min-w-0 bg-sky-50 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase text-sky-800">
                <WorkspaceText text="From appointment" />
              </p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-950">
                <WorkspaceText text={ticket.source_booking
                  ? formatTicketDateTime(ticket.source_booking.start_at)
                  : "Linked appointment"} />
              </h2>
              <p className="mt-1 text-sm text-sky-900">
                <WorkspaceText text="Booking reference:" /> {ticket.source_booking_id}
              </p>
            </div>
            <Link
              className="inline-flex w-fit rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              href={
                ticket.source_booking
                  ? `/bookings?date=${ticket.source_booking.start_at.slice(0, 10)}&bookingId=${ticket.source_booking.id}`
                  : `/bookings?bookingId=${ticket.source_booking_id}`
              }
            >
              <WorkspaceText text="View appointment" />
            </Link>
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Customer" /></h2>
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
          <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Services" /></h2>
          {canWorkTicket ? (
            <span className="text-sm font-medium text-zinc-700">
              <WorkspaceText text="Service Actions" />
            </span>
          ) : null}
        </div>

        {(ticket.ticket_items ?? []).length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
            <WorkspaceText text="No services added yet." />
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
              <div className="col-span-12 sm:col-span-3"><WorkspaceText text="Service" /></div>
              <div className="hidden sm:col-span-1 sm:block"><WorkspaceText text="Duration" /></div>
              <div className="hidden sm:col-span-1 sm:block"><WorkspaceText text="Price" /></div>
              <div className="hidden sm:col-span-2 sm:block"><WorkspaceText text="Assigned Staff" /></div>
              <div className="hidden sm:col-span-1 sm:block"><WorkspaceText text="Quantity" /></div>
              <div className="hidden sm:col-span-2 sm:block"><WorkspaceText text="Subtotal" /></div>
              <div className="hidden sm:col-span-2 sm:block"><WorkspaceText text="Actions" /></div>
            </div>
            <ul className="divide-y divide-zinc-200">
              {(ticket.ticket_items ?? []).map((item) => (
                <li className="grid grid-cols-12 gap-3 px-4 py-3" key={item.id}>
                  <div className="col-span-12 text-sm font-medium text-zinc-950 sm:col-span-3">
                    <p>
                      {item.service_name_snapshot ??
                        item.service?.name ??
                        "Unknown service"}
                    </p>
                    {item.source_kind === "booking" ? (
                      <p className="mt-1 text-xs font-semibold text-sky-700">
                        <WorkspaceText text="Booking snapshot" />
                        <WorkspaceText text={item.source_booking_line_id
                          ? ` / line ${item.source_booking_line_id.slice(0, 8)}`
                          : ""} />
                      </p>
                    ) : null}
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-1">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      <WorkspaceText text="Duration:" />{" "}
                    </span>
                    <WorkspaceText text={formatDuration(item.service?.duration_minutes)} />
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-1">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      <WorkspaceText text="Price:" />{" "}
                    </span>
                    {formatMoney(item.unit_price)}
                    {canWorkTicket?<ItemPriceForm itemId={item.id} quantity={item.quantity} unitPrice={item.unit_price} revision={ticket.workspace_revision??0} returnPath={returnPath}/>:null}
                    {item.booked_unit_price_snapshot !== null ? (
                      <p className="mt-1 text-xs text-zinc-500">
                        <WorkspaceText text="Booked" /> {formatMoney(item.booked_unit_price_snapshot)}
                      </p>
                    ) : null}
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                    {canWorkTicket ? (
                      <AssignStaffForm
                        revision={ticket.workspace_revision??0}
                        itemId={item.id}
                        returnPath={returnPath}
                        staff={options.staff}
                        staffId={item.assigned_staff_id}
                      />
                    ) : (
                      <>
                        <span className="font-medium text-zinc-500 sm:hidden">
                          <WorkspaceText text="Assigned Staff:" />{" "}
                        </span>
                        {item.assigned_staff?.display_name ?? "-"}
                        {item.performed_staff ? (
                          <p className="mt-1 text-xs text-zinc-500">
                            <WorkspaceText text="Performed by" /> {item.performed_staff.display_name}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-1">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      <WorkspaceText text="Quantity:" />{" "}
                    </span>
                    {formatQuantity(item.quantity)}
                  </div>
                  <div className="col-span-12 text-sm font-medium text-zinc-950 sm:col-span-2">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      <WorkspaceText text="Subtotal:" />{" "}
                    </span>
                    {formatMoney(item.line_total)}
                  </div>
                  <div className="col-span-12 text-sm sm:col-span-2">
                    {canWorkTicket ? (
                      <form action={deletePosTicketItem}>
                        <input name="item_id" type="hidden" value={item.id} />
                        <input name="return_to" type="hidden" value={returnPath} />
                        <TicketInputFields revision={ticket.workspace_revision??0} />
                        <SubmitButton pendingLabel="Removing…"
                          className="font-medium text-zinc-950 underline"
                          type="submit"
                        >
                          <WorkspaceText text="Remove Item" />
                        </SubmitButton>
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
            revision={ticket.workspace_revision??0}
            returnPath={returnPath}
            services={options.services}
            ticketId={ticket.id}
          />
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Discount" /></h2>
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm sm:grid-cols-5">
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Current Discount" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.discount_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Discount Type" /></span>
            <span className="font-semibold text-zinc-950">
              <WorkspaceText text={DISCOUNT_TYPE_LABELS[ticket.discount_type]} />
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Discount Value" /></span>
            <span className="font-semibold text-zinc-950">
              {ticket.discount_type === "percentage"
                ? `${ticket.discount_value}%`
                : formatMoney(ticket.discount_value)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Discounted Amount" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.discount_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Updated Total" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.total)}
            </span>
          </p>
        </div>

        {canWorkTicket ? (
          <DiscountForm
            revision={ticket.workspace_revision??0}
            discountType={ticket.discount_type}
            discountValue={ticket.discount_value}
            returnPath={returnPath}
            ticketId={ticket.id}
          />
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Tax" /></h2>
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm sm:grid-cols-4">
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Tax Rate" /></span>
            <span className="font-semibold text-zinc-950">
              {ticket.tax_rate}%
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Taxable Amount" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.taxable_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Calculated Tax" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.tax_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Updated Total" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.total)}
            </span>
          </p>
        </div>

        {canWorkTicket ? (
          <TaxForm
            revision={ticket.workspace_revision??0}
            returnPath={returnPath}
            taxRate={ticket.tax_rate}
            ticketId={ticket.id}
          />
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Tip" /></h2>
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm sm:grid-cols-5">
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Tip Type" /></span>
            <span className="font-semibold text-zinc-950">
              <WorkspaceText text={TIP_TYPE_LABELS[ticket.tip_type]} />
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Tip Value" /></span>
            <span className="font-semibold text-zinc-950">
              {ticket.tip_type === "percentage"
                ? `${ticket.tip_value}%`
                : formatMoney(ticket.tip_value)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Calculated Tip" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.tip_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Updated Total" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.total)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Remaining" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.remaining)}
            </span>
          </p>
        </div>

        {canWorkTicket ? (
          <TipForm
            revision={ticket.workspace_revision??0}
            returnPath={returnPath}
            ticketId={ticket.id}
            tipType={ticket.tip_type}
            tipValue={ticket.tip_value}
          />
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Payment Summary" /></h2>
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 text-sm sm:grid-cols-5">
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Subtotal" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.subtotal)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Total" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.total)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Paid" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.paid)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Remaining" /></span>
            <span className="font-semibold text-zinc-950">
              {formatMoney(totals.remaining)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500"><WorkspaceText text="Payment Status" /></span>
            <span className="font-semibold text-zinc-950">
              <WorkspaceText text={paymentStatus} />
            </span>
          </p>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Payments" /></h2>
          {canWorkTicket ? (
            <span className="text-sm font-medium text-zinc-700">
              <WorkspaceText text="Payment Actions" />
            </span>
          ) : null}
        </div>

        <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-5 text-sm">
          <div className="grid gap-3 sm:grid-cols-4">
            <p>
              <span className="block text-zinc-500"><WorkspaceText text="Total" /></span>
              <span className="font-semibold text-zinc-950">
                {formatMoney(totals.total)}
              </span>
            </p>
            <p>
              <span className="block text-zinc-500"><WorkspaceText text="Paid" /></span>
              <span className="font-semibold text-zinc-950">
                {formatMoney(totals.paid)}
              </span>
            </p>
            <p>
              <span className="block text-zinc-500"><WorkspaceText text="Remaining" /></span>
              <span className="font-semibold text-zinc-950">
                {formatMoney(totals.remaining)}
              </span>
            </p>
            <p>
              <span className="block text-zinc-500"><WorkspaceText text="Payment Progress" /></span>
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
            <WorkspaceText text="No payments recorded yet." />
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
              <div className="col-span-12 sm:col-span-3"><WorkspaceText text="Method" /></div>
              <div className="hidden sm:col-span-2 sm:block"><WorkspaceText text="Amount" /></div>
              <div className="hidden sm:col-span-3 sm:block"><WorkspaceText text="Created Time" /></div>
              <div className="hidden sm:col-span-2 sm:block"><WorkspaceText text="Note" /></div>
              <div className="hidden sm:col-span-2 sm:block"><WorkspaceText text="Actions" /></div>
            </div>
            <ul className="divide-y divide-zinc-200">
              {(ticket.payments ?? []).map((payment) => (
                <li
                  className="grid grid-cols-12 gap-3 px-4 py-3"
                  key={payment.id}
                >
                  <div className="col-span-12 text-sm font-medium text-zinc-950 sm:col-span-3">
                    <WorkspaceText text={POS_PAYMENT_METHOD_LABELS[payment.payment_method]} />
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      <WorkspaceText text="Amount:" />{" "}
                    </span>
                    {formatMoney(payment.amount)}
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-3">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      <WorkspaceText text="Created Time:" />{" "}
                    </span>
                    <WorkspaceText text={formatTicketDateTime(payment.created_at)} />
                  </div>
                  <div className="col-span-12 text-sm text-zinc-700 sm:col-span-2">
                    <span className="font-medium text-zinc-500 sm:hidden">
                      <WorkspaceText text="Note:" />{" "}
                    </span>
                    {payment.note ?? "-"}
                  </div>
                  <div className="col-span-12 text-sm sm:col-span-2">
                    {canWorkTicket ? (
                      <form action={deletePosPayment}>
                        <input name="ticket_id" type="hidden" value={ticket.id} />
                        <input name="payment_id" type="hidden" value={payment.id} />
                        <input name="return_to" type="hidden" value={returnPath} />
                        <TicketInputFields revision={ticket.workspace_revision??0} />
                        <SubmitButton pendingLabel="Removing…"
                          className="font-medium text-zinc-950 underline"
                          type="submit"
                        >
                          <WorkspaceText text="Delete" />
                        </SubmitButton>
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
            revision={ticket.workspace_revision??0}
            remaining={totals.remaining}
            returnPath={returnPath}
            ticketId={ticket.id}
          />
        ) : null}
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Receipt Preview" /></h2>
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
                <span className="font-medium text-zinc-950"><WorkspaceText text="Ticket:" /></span>{" "}
                {receipt.header.ticket_number}
              </p>
              <p>
                <span className="font-medium text-zinc-950"><WorkspaceText text="Status:" /></span>{" "}
                {receipt.header.ticket_status}
              </p>
              <p>
                <span className="font-medium text-zinc-950"><WorkspaceText text="Customer:" /></span>{" "}
                {receipt.header.customer_name}
              </p>
              <p>
                <span className="font-medium text-zinc-950"><WorkspaceText text="Created:" /></span>{" "}
                <WorkspaceText text={formatTicketDateTime(receipt.header.created_time)} />
              </p>
              <p>
                <span className="font-medium text-zinc-950"><WorkspaceText text="Closed:" /></span>{" "}
                <WorkspaceText text={formatTicketDateTime(receipt.header.closed_time)} />
              </p>
            </div>
          </div>

          <div className="border-b border-zinc-200 py-4">
            <h3 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Items" /></h3>
            {receipt.items.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600"><WorkspaceText text="No items." /></p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-100">
                {receipt.items.map((item, index) => (
                  <li className="grid gap-2 py-3 text-sm sm:grid-cols-5" key={`${item.service_name}-${index}`}>
                    <p className="font-medium text-zinc-950">{item.service_name}</p>
                    <p className="text-zinc-700">{item.assigned_staff}</p>
                    <p className="text-zinc-700"><WorkspaceText text="Qty" /> {formatQuantity(item.quantity)}</p>
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
              <h3 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Totals" /></h3>
              <dl className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600"><WorkspaceText text="Subtotal" /></dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.subtotal)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600"><WorkspaceText text="Discount" /></dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.discount)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600"><WorkspaceText text="Tax" /></dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.tax)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600"><WorkspaceText text="Tip" /></dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.tip)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-zinc-200 pt-2">
                  <dt className="font-semibold text-zinc-950"><WorkspaceText text="Grand Total" /></dt>
                  <dd className="font-semibold text-zinc-950">
                    {formatMoney(receipt.totals.grand_total)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600"><WorkspaceText text="Paid" /></dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.paid)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-600"><WorkspaceText text="Remaining" /></dt>
                  <dd className="font-medium text-zinc-950">
                    {formatMoney(receipt.totals.remaining)}
                  </dd>
                </div>
              </dl>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Payments" /></h3>
              {receipt.payments.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-600"><WorkspaceText text="No payments." /></p>
              ) : (
                <ul className="mt-3 divide-y divide-zinc-100">
                  {receipt.payments.map((payment, index) => (
                    <li className="flex justify-between gap-3 py-3 text-sm" key={`${payment.method}-${index}`}>
                      <div>
                        <p className="font-medium text-zinc-950">{payment.method}</p>
                        <p className="text-xs text-zinc-500">
                          <WorkspaceText text={formatTicketDateTime(payment.created_time)} />
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
            <WorkspaceText text={receipt.footer.message} />
          </p>
        </div>
      </section>

      {canWorkTicket || canVoidOrReopenTicket ? (
        <section className="mt-8 min-w-0 border-t border-zinc-200 bg-white pt-5">
          <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Actions" /></h2>
          {canWorkTicket && !checkoutAvailable ? (
            <p className="mt-3 text-sm text-zinc-600">
              {checkoutUnavailableReason}
            </p>
          ) : null}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {canWorkTicket ? (
              <>
                {checkoutAvailable ? (
                  <form action={closePosTicket} className="min-w-0 bg-white p-4">
                    <input name="ticket_id" type="hidden" value={ticket.id} />
                    <input name="return_to" type="hidden" value={returnPath} />
                        <TicketInputFields revision={ticket.workspace_revision??0} />
                    <SubmitButton pendingLabel="Processing…"
                      className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
                      type="submit"
                    >
                      <WorkspaceText text="Checkout" />
                    </SubmitButton>
                  </form>
                ) : null}
                <WorkflowActionForm
                  revision={ticket.workspace_revision??0}
                  action={cancelPosTicket}
                  buttonLabel={__vt("Cancel Ticket")}
                  returnPath={returnPath}
                  ticketId={ticket.id}
                />
              </>
            ) : null}
            {canVoidOrReopenTicket ? (
              <>
                <WorkflowActionForm
                  revision={ticket.workspace_revision??0}
                  action={voidPosTicket}
                  buttonLabel={__vt("Void Ticket")}
                  returnPath={returnPath}
                  ticketId={ticket.id}
                />
                <WorkflowActionForm
                  revision={ticket.workspace_revision??0}
                  action={reopenPosTicket}
                  buttonLabel={__vt("Reopen Ticket")}
                  returnPath={returnPath}
                  ticketId={ticket.id}
                />
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Activity Timeline" /></h2>
        {timeline.length === 0 ? (
          <p className="mt-4 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
            <WorkspaceText text="No activity yet." />
          </p>
        ) : (
          <ol className="mt-4 border-l border-zinc-200">
            {timeline.map((item) => (
              <li className="relative pb-5 pl-5" key={item.id}>
                <span className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border border-zinc-300 bg-white" />
                <div className="min-w-0 bg-white py-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-zinc-950">
                      <WorkspaceText text={item.label} />
                    </p>
                    <p className="text-xs text-zinc-500">
                      <WorkspaceText text={formatTicketDateTime(item.timestamp)} />
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-zinc-700"><WorkspaceText text="User:" /> {item.user}</p>
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

export default withExperiencePage(PosTicketDetailPage);
