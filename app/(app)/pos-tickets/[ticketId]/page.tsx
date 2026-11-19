import { withExperiencePage } from "@/components/experience-page";
import { getWorkspaceTranslation } from "@/lib/workspace-language-server";
import { WorkspaceText } from "@/components/workspace-language";
import { ContextualSupport } from "@/components/contextual-support";

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
import { POS_PAYMENT_METHOD_OPTIONS } from "@/lib/pos-payments";
import { ClosedTicketDetailEditor, TicketDetailInlineHistory } from "@/app/pos-tickets/closed-ticket-correction-form";
import { TicketDetailView } from "@/app/pos-tickets/ticket-detail-view";
import styles from "@/app/pos-tickets/ticket-detail-view.module.css";
import { buildTicketDetailHref, buildTicketListHref, sanitizeTicketDetailReturnTo, ticketBusinessDate } from "@/lib/pos-ticket-navigation";
import { getContextBusinessTimezone } from "@/lib/salon-business-clock";
import { canApplyFinancialCorrections, FINANCIAL_CORRECTION_PERMISSIONS, isDailyClosingLocked } from "@/lib/daily-pos-report";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { buildTicketReceipt } from "@/lib/pos-ticket-receipt";
import { getTicketTimeline } from "@/lib/pos-ticket-timeline";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import type {
  PosTicketDiscountType,
  PosTicketTipType,
} from "@/types/pos-ticket";
import type { Service } from "@/types/service";
import { STAFF_WORKDAY_STATUS_LABELS } from "@/lib/staff-workdays";

import { isOwnerMembership } from "@/lib/current-context";
import { ticketFinancialView } from "@/lib/pos-ticket-financial-view";
import { TicketPaymentSummary } from "@/components/ticket-payment-summary";
import { TicketGiftDelivery } from "@/components/gift-card/ticket-gift-delivery";
import { ReceiptPrintActions } from "@/components/receipt-print-actions";

type PosTicketDetailPageProps = {
  params: Promise<{ ticketId: string }>;
  searchParams: Promise<{ edit?: string | string[]; error?: string | string[]; returnTo?: string | string[] }>;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function toCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
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
  const [{ ticketId }, query, context, translate] = await Promise.all([
    params,
    searchParams,
    params.then(({ ticketId: id }) =>
      requireSalonManagePageContext(`/pos-tickets/${id}`),
    ),
    getWorkspaceTranslation(),
  ]);
  const canViewTickets = await hasPermission(POS_TICKET_PERMISSIONS.view, context);
  if (!canViewTickets) {
    return <main className="mx-auto w-full max-w-3xl px-6 py-12"><p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600"><WorkspaceText text="You do not have permission to view POS tickets." /></p></main>;
  }
  const [{ ticket }, canManageTickets, canVoidTickets, timeZone] = await Promise.all([
    getCurrentSalonPosTicket(ticketId),
    hasPermission(POS_TICKET_PERMISSIONS.manage, context),
    hasPermission(POS_TICKET_PERMISSIONS.void, context),
    getContextBusinessTimezone(context),
  ]);
  if (!ticket) {
    return <main className="mx-auto w-full max-w-3xl px-6 py-12"><p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600"><WorkspaceText text="POS Ticket was not found for the current salon." /></p></main>;
  }

  const businessDate = ticketBusinessDate(ticket.opened_at, timeZone);
  const [isBusinessDateLocked, canRequestStaffCorrection, canApplyFinancialCorrection] = await Promise.all([
    isDailyClosingLocked(businessDate, context),
    hasPermission(FINANCIAL_CORRECTION_PERMISSIONS.request, context),
    canApplyFinancialCorrections(context),
  ]);
  const isOwner = isOwnerMembership(context.currentMembership);
  const isOpen = ticket.status === "open";
  const isClosed = ticket.status === "closed";
  const canWorkTicket = isOwner && canManageTickets && isOpen;
  const canVoidOrReopenTicket = isOwner && canVoidTickets && isClosed;
  // Match the daily ticket screen's financial-lock and correction permissions.
  const serviceTotals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items: ticket.ticket_items ?? [],
    payments: ticket.payments ?? [],
    taxRate: ticket.tax_rate,
    tipType: ticket.tip_type,
    tipValue: ticket.tip_value,
  });
  const financial = ticketFinancialView(ticket, serviceTotals);
  const totals = financial.totals;
  const canCorrectTickets = canManageTickets || canVoidTickets;
  const canEditClosedTicket = isOwner && isClosed && !financial.giftOnly && (isBusinessDateLocked
    ? canCorrectTickets || canRequestStaffCorrection || canApplyFinancialCorrection
    : canCorrectTickets);
  const isEditing = query.edit === "1" && (canWorkTicket || canEditClosedTicket);
  const backHref = sanitizeTicketDetailReturnTo(typeof query.returnTo === "string" ? query.returnTo : undefined, buildTicketListHref({ date: businessDate, ticketId: ticket.id }));
  const viewHref = buildTicketDetailHref(ticket.id, { returnTo: backHref });
  const editHref = buildTicketDetailHref(ticket.id, { edit: true, returnTo: backHref });
  const returnPath = isEditing && canWorkTicket ? editHref : viewHref;
  const options = isEditing
    ? await getCurrentSalonPosTicketOptions(context)
    : { services: [], staff: [] };
  const hasItems = (ticket.ticket_items ?? []).length > 0;
  const totalCents = toCents(totals.total);
  const paidCents = toCents(totals.paid);
  const remainingCents = toCents(totals.remaining);
  const paymentStatus = paidCents <= 0
    ? "Unpaid"
    : remainingCents === 0 && paidCents === totalCents ? "Paid" : "Partially Paid";
  const checkoutAvailable = canWorkTicket && hasItems && totalCents > 0 && paidCents === totalCents && remainingCents === 0;
  const checkoutUnavailableReason = !hasItems
    ? "Add at least one service before checkout."
    : totalCents <= 0
      ? "Ticket Total must be greater than 0 before checkout."
      : paidCents > totalCents || remainingCents < 0
        ? "Paid Total cannot exceed Total."
        : paidCents < totalCents || remainingCents > 0
          ? "Collect full payment before checkout."
          : "";
  const receipt = buildTicketReceipt({ customer: ticket.customer, items: ticket.ticket_items ?? [], payments: ticket.payments ?? [], salon: context.currentSalon, ticket, totals: serviceTotals });
  const timeline = getTicketTimeline(ticket);
  const editingOpenTicket = isEditing && canWorkTicket;
  const translatedStatus = translate(ticket.status);
  const ticketStatusLabel = translatedStatus !== ticket.status ? translatedStatus : translate({ open: "Open", closed: "Closed", cancelled: "Cancelled", voided: "Voided" }[ticket.status]);

  return <TicketDetailView
    backHref={backHref}
    backLabel={/^\/(reports|pos\/report)(?:\?|$)/.test(backHref) ? "Back to Reports" : "POS tickets"}
    editHref={isEditing ? (canWorkTicket ? viewHref : undefined) : canWorkTicket || canEditClosedTicket ? editHref : undefined}
    editLabel={isEditing ? "Done" : "Edit"}
    error={typeof query.error === "string" ? query.error : undefined}
    support={<ContextualSupport />}
    ticket={ticket}
    ticketStatusLabel={ticketStatusLabel}
    totals={totals}
    totalLabel={isEditing && canEditClosedTicket ? "Saved total" : "Total"}
    paymentStatus={paymentStatus}
    receipt={receipt}
    receiptActions={<ReceiptPrintActions receipt={receipt} receiptId={ticket.id} context={{ scope: `salon:${context.currentSalon.id}`, timezone: timeZone, brand: { salonName: context.currentSalon.name, phone: context.currentSalon.phone, address: [context.currentSalon.address_line1, context.currentSalon.address_line2, context.currentSalon.city, context.currentSalon.state, context.currentSalon.postal_code].filter(Boolean).join(", ") } }} />}
    recordedHistory={<TicketDetailInlineHistory ticket={ticket} salonId={context.currentSalon.id} businessDate={businessDate} timeZone={timeZone} timeline={timeline}><div className="min-h-11 py-3 text-sm font-medium"><WorkspaceText text="Recorded ticket history" /></div></TicketDetailInlineHistory>}
    giftItems={financial.giftSales.map(sale=><li key={sale.id} className={styles.service} data-ticket-gift-item><div className={styles.row}><span className={styles.serviceName}><WorkspaceText text="Gift card" /> · •••• {sale.last4}{sale.status === "voided" ? " · Voided" : ""}</span><span className={styles.amount}>{formatMoney(sale.amountCents/100)}</span></div><p className={styles.small}><WorkspaceText text="Gift purchase" /></p><span data-ticket-gift-staff aria-hidden="true" />{canManageTickets && ticket.status === "closed" && sale.status === "completed" ? <TicketGiftDelivery ticketId={ticket.id} saleId={sale.id} last4={sale.last4} /> : null}</li>)}
    paymentSummary={(financial.giftSales.length > 0 || financial.giftRedeemed > 0) && !canWorkTicket ? <TicketPaymentSummary payments={financial.payments} timeZone={timeZone} /> : undefined}
    timeline={timeline}
    salonName={context.currentSalon.name}
    timeZone={timeZone}
    serviceEditor={isEditing && canEditClosedTicket ? <ClosedTicketDetailEditor
      ticket={ticket}
      services={options.services}
      staff={options.staff}
      returnTo={viewHref}
      cancelHref={viewHref}
      canEdit={canEditClosedTicket}
      isBusinessDateLocked={isBusinessDateLocked}
      canApplyFinancialCorrection={canApplyFinancialCorrection}
      timeZone={timeZone}
      businessDateCompactLabel={new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(ticket.opened_at))}
    /> : undefined}
    itemEditors={editingOpenTicket ? Object.fromEntries((ticket.ticket_items ?? []).map(item => [item.id,
      <details key={item.id} className="text-sm"><summary className="min-h-10 cursor-pointer text-xs font-medium text-emerald-800"><WorkspaceText text="Edit service" /></summary><div className="grid gap-3 pb-1 pt-2"><AssignStaffForm revision={ticket.workspace_revision ?? 0} itemId={item.id} returnPath={returnPath} staff={options.staff} staffId={item.assigned_staff_id} /><ItemPriceForm itemId={item.id} quantity={item.quantity} unitPrice={item.unit_price} revision={ticket.workspace_revision ?? 0} returnPath={returnPath} /><form action={deletePosTicketItem}><TicketInputFields revision={ticket.workspace_revision ?? 0} /><input name="item_id" type="hidden" value={item.id} /><input name="return_to" type="hidden" value={returnPath} /><SubmitButton pendingLabel="Removing…" className="min-h-10 text-xs font-medium text-red-700" type="submit"><WorkspaceText text="Remove Item" /></SubmitButton></form></div></details>
    ])) : undefined}
    serviceActions={editingOpenTicket ? <AddServiceForm revision={ticket.workspace_revision ?? 0} returnPath={returnPath} services={options.services} ticketId={ticket.id} /> : undefined}
    financialEditor={editingOpenTicket ? <div className="mt-4 grid gap-3">
      <details className="rounded-md border border-zinc-200 p-3"><summary className="cursor-pointer text-sm font-medium"><WorkspaceText text="Discount" /></summary><DiscountForm revision={ticket.workspace_revision ?? 0} discountType={ticket.discount_type} discountValue={ticket.discount_value} returnPath={returnPath} ticketId={ticket.id} /></details>
      <details className="rounded-md border border-zinc-200 p-3"><summary className="cursor-pointer text-sm font-medium"><WorkspaceText text="Tax" /></summary><TaxForm revision={ticket.workspace_revision ?? 0} returnPath={returnPath} taxRate={ticket.tax_rate} ticketId={ticket.id} /></details>
      <details className="rounded-md border border-zinc-200 p-3"><summary className="cursor-pointer text-sm font-medium"><WorkspaceText text="Tip" /></summary><TipForm revision={ticket.workspace_revision ?? 0} returnPath={returnPath} ticketId={ticket.id} tipType={ticket.tip_type} tipValue={ticket.tip_value} /></details>
    </div> : undefined}
    paymentEditors={editingOpenTicket ? Object.fromEntries((ticket.payments ?? []).map(payment => [payment.id,
      <form action={deletePosPayment} key={payment.id}><TicketInputFields revision={ticket.workspace_revision ?? 0} /><input name="payment_id" type="hidden" value={payment.id} /><input name="return_to" type="hidden" value={returnPath} /><SubmitButton pendingLabel="Removing…" className="min-h-10 text-xs font-medium text-red-700" type="submit"><WorkspaceText text="Delete" /></SubmitButton></form>
    ])) : undefined}
    paymentEditor={editingOpenTicket && remainingCents > 0 ? <AddPaymentForm revision={ticket.workspace_revision ?? 0} remaining={totals.remaining} returnPath={returnPath} ticketId={ticket.id} /> : undefined}
    actions={canWorkTicket || canVoidOrReopenTicket ? <>
      {canWorkTicket && !checkoutAvailable ? <p className={styles.notice}><WorkspaceText text={checkoutUnavailableReason} /></p> : null}
      <div className={styles.actionForms}>
        {checkoutAvailable ? <form action={closePosTicket}><TicketInputFields revision={ticket.workspace_revision ?? 0} note={false} /><input name="ticket_id" type="hidden" value={ticket.id} /><input name="return_to" type="hidden" value={viewHref} /><SubmitButton pendingLabel="Processing…" className="min-h-11 rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white" type="submit"><WorkspaceText text="Checkout" /></SubmitButton></form> : null}
        {canWorkTicket ? <details><summary><WorkspaceText text="Cancel Ticket" /></summary><WorkflowActionForm revision={ticket.workspace_revision ?? 0} action={cancelPosTicket} buttonLabel="Cancel Ticket" returnPath={returnPath} ticketId={ticket.id} /></details> : null}
        {canVoidOrReopenTicket ? <>
          {!financial.giftSales.length ? <details><summary><WorkspaceText text="Reopen Ticket" /></summary><WorkflowActionForm revision={ticket.workspace_revision ?? 0} action={reopenPosTicket} buttonLabel="Reopen Ticket" returnPath={viewHref} ticketId={ticket.id} /></details> : null}
          <details><summary className="text-red-700"><WorkspaceText text="Void Ticket" /></summary><WorkflowActionForm revision={ticket.workspace_revision ?? 0} action={voidPosTicket} buttonLabel="Void Ticket" returnPath={viewHref} ticketId={ticket.id} /></details>
        </> : null}
      </div>
    </> : undefined}
  />;
}

export default withExperiencePage(PosTicketDetailPage);
