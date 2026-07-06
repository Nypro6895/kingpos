import { getCurrentSalonCustomer } from "@/lib/customers";
import { hasPermission } from "@/lib/permissions";
import type { Customer } from "@/types/customer";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type CustomerDetailPageProps = {
  params: Promise<{
    customerId: string;
  }>;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="border-b border-zinc-100 py-4 last:border-b-0">
      <dt className="text-sm font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm text-zinc-950">{value || "-"}</dd>
    </div>
  );
}

function StatusBadge({ customer }: { customer: Customer }) {
  return (
    <span
      className={
        customer.status === "active"
          ? "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white"
          : "inline-flex rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
      }
    >
      {customer.status === "active" ? "Active" : "Inactive"}
    </span>
  );
}

export default async function CustomerDetailPage({ params }: CustomerDetailPageProps) {
  const { customerId } = await params;
  const { context, customer } = await getCurrentSalonCustomer(customerId);

  if (!context.user) {
    redirect("/login");
  }

  if (!customer) {
    notFound();
  }

  const canManageCustomers = await hasPermission("customers.manage", context);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500">Customers</p>
          <h1 className="mt-1 text-3xl font-semibold text-zinc-950">{customer.name}</h1>
          <div className="mt-3">
            <StatusBadge customer={customer} />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/customers"
          >
            Customers
          </Link>
          {canManageCustomers ? (
            <Link
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              href={`/customers/${customer.id}/edit`}
            >
              Edit
            </Link>
          ) : null}
        </div>
      </div>

      <dl className="mt-8 rounded-lg border border-zinc-200 bg-white px-5">
        <DetailRow label="Customer Name" value={customer.name} />
        <DetailRow label="Phone" value={customer.phone} />
        <DetailRow label="Email" value={customer.email} />
        <DetailRow label="Notes" value={customer.notes} />
        <DetailRow label="Status" value={customer.status === "active" ? "Active" : "Inactive"} />
        <DetailRow label="Created At" value={formatDateTime(customer.created_at)} />
        <DetailRow label="Updated At" value={formatDateTime(customer.updated_at)} />
      </dl>
    </main>
  );
}
