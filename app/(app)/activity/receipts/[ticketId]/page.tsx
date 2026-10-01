import {
  getCustomerActivityReceipt,
  type CustomerActivityReceipt,
  type CustomerActivityReceiptService,
} from "@/lib/customer-activity";
import { VisitExperiencePrompt } from "@/app/activity/visit-experience-prompt";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type ActivityReceiptPageProps = {
  params: Promise<{
    ticketId: string;
  }>;
};

function classNames(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    style: "currency",
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Unavailable";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function initialsFor(value: string | null | undefined) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "R";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function addressLabel(receipt: CustomerActivityReceipt) {
  return [
    receipt.salon.addressLine1,
    receipt.salon.addressLine2,
    [receipt.salon.city, receipt.salon.state].filter(Boolean).join(", "),
    receipt.salon.postalCode,
  ]
    .filter(Boolean)
    .join(" ");
}

function paymentStatusLabel(status: CustomerActivityReceipt["paymentStatus"]) {
  if (status === "paid") {
    return "Paid";
  }

  return status === "partial" ? "Partially paid" : "Unpaid";
}

function SalonHeader({ receipt }: { receipt: CustomerActivityReceipt }) {
  const place = addressLabel(receipt);

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-brand-orange-soft text-lg font-extrabold text-brand-orange ring-1 ring-border-subtle">
          {receipt.salon.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${receipt.salon.name} logo`}
              className="h-full w-full object-cover"
              src={receipt.salon.imageUrl}
            />
          ) : (
            initialsFor(receipt.salon.name)
          )}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold leading-tight text-text-primary">
              {receipt.salon.name}
            </h1>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-800">
              Completed
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-text-secondary">
            Receipt {receipt.ticketNumber}
          </p>
          {place || receipt.salon.phone ? (
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              {[place, receipt.salon.phone].filter(Boolean).join(" / ")}
            </p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-border-subtle bg-surface-muted px-4 py-3 sm:text-right">
          <p className="text-xs font-bold uppercase text-text-muted">
            Total paid
          </p>
          <p className="mt-1 text-2xl font-extrabold text-text-primary">
            {formatMoney(receipt.totals.total, receipt.currency)}
          </p>
        </div>
      </div>
    </section>
  );
}

function ServiceLine({
  currency,
  service,
}: {
  currency: string;
  service: CustomerActivityReceiptService;
}) {
  return (
    <li className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-extrabold text-text-primary">
          {service.name}
        </p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">
          {[service.staffName, `Qty ${formatQuantity(service.quantity)}`]
            .filter(Boolean)
            .join(" / ")}
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 text-sm sm:block sm:text-right">
        <p className="font-semibold text-text-secondary">
          {formatMoney(service.unitPrice, currency)}
        </p>
        <p className="font-extrabold text-text-primary">
          {formatMoney(service.lineTotal, currency)}
        </p>
      </div>
    </li>
  );
}

function TotalsRow({
  emphasis,
  label,
  value,
}: {
  emphasis?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div
      className={classNames(
        "flex justify-between gap-4",
        emphasis && "border-t border-border-subtle pt-3 text-base",
      )}
    >
      <dt
        className={classNames(
          emphasis ? "font-extrabold text-text-primary" : "text-text-secondary",
        )}
      >
        {label}
      </dt>
      <dd className="font-extrabold text-text-primary">{value}</dd>
    </div>
  );
}

export default async function ActivityReceiptPage({
  params,
}: ActivityReceiptPageProps) {
  const { ticketId } = await params;
  const result = await getCustomerActivityReceipt(ticketId);

  if (!result.ok && result.code === "sign_in_required") {
    redirect(
      `/login?next=${encodeURIComponent(`/activity/receipts/${ticketId}`)}`,
    );
  }

  if (!result.ok || !result.data) {
    notFound();
  }

  const receipt = result.data;

  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <Link
          className="w-fit rounded-full px-2 py-1 text-sm font-bold text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href="/activity"
        >
          Back to Activity
        </Link>

        <SalonHeader receipt={receipt} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm">
            <div className="border-b border-border-subtle px-4 py-4">
              <h2 className="text-lg font-extrabold text-text-primary">
                Services
              </h2>
              <p className="mt-1 text-sm font-semibold text-text-secondary">
                {formatDateTime(receipt.closedAt ?? receipt.openedAt)}
              </p>
            </div>
            {receipt.services.length === 0 ? (
              <p className="px-4 py-6 text-sm font-semibold text-text-secondary">
                No receipt items were found.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {receipt.services.map((service) => (
                  <ServiceLine
                    currency={receipt.currency}
                    key={service.id ?? service.name}
                    service={service}
                  />
                ))}
              </ul>
            )}
          </section>

          <aside className="grid gap-5">
            {receipt.verifiedVisit ? (
              <VisitExperiencePrompt
                countsTowardReputation={
                  receipt.verifiedVisit.countsTowardReputation
                }
                initialBody={receipt.verifiedVisit.experienceBody}
                initialState={receipt.verifiedVisit.experienceState}
                salonName={receipt.salon.name}
                ticketId={receipt.ticketId}
                windowDays={receipt.verifiedVisit.windowDays}
              />
            ) : null}

            <section className="rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm">
              <h2 className="text-lg font-extrabold text-text-primary">
                Receipt total
              </h2>
              <dl className="mt-4 grid gap-3 text-sm">
                <TotalsRow
                  label="Subtotal"
                  value={formatMoney(receipt.totals.subtotal, receipt.currency)}
                />
                <TotalsRow
                  label="Discount"
                  value={formatMoney(
                    receipt.totals.discount_amount,
                    receipt.currency,
                  )}
                />
                <TotalsRow
                  label="Tax"
                  value={formatMoney(
                    receipt.totals.tax_amount,
                    receipt.currency,
                  )}
                />
                <TotalsRow
                  label="Tip"
                  value={formatMoney(
                    receipt.totals.tip_amount,
                    receipt.currency,
                  )}
                />
                <TotalsRow
                  emphasis
                  label="Total"
                  value={formatMoney(receipt.totals.total, receipt.currency)}
                />
                <TotalsRow
                  label="Paid"
                  value={formatMoney(receipt.totals.paid, receipt.currency)}
                />
                <TotalsRow
                  label="Status"
                  value={paymentStatusLabel(receipt.paymentStatus)}
                />
              </dl>
            </section>

            <section className="rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm">
              <h2 className="text-lg font-extrabold text-text-primary">
                Payments
              </h2>
              {receipt.payments.length === 0 ? (
                <p className="mt-3 text-sm font-semibold text-text-secondary">
                  No payments recorded.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-border-subtle">
                  {receipt.payments.map((payment) => (
                    <li
                      className="flex justify-between gap-4 py-3 text-sm"
                      key={payment.id ?? `${payment.method}-${payment.createdAt}`}
                    >
                      <span>
                        <span className="block font-extrabold text-text-primary">
                          {payment.label}
                        </span>
                        <span className="block text-xs font-semibold text-text-secondary">
                          {formatDateTime(payment.createdAt)}
                        </span>
                      </span>
                      <span className="font-extrabold text-text-primary">
                        {formatMoney(payment.amount, receipt.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
