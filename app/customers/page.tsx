import { getCurrentSalonCustomers } from "@/lib/customers";
import { hasPermission } from "@/lib/permissions";
import type { Customer } from "@/types/customer";
import Link from "next/link";
import { redirect } from "next/navigation";

type CustomersPageProps = {
  searchParams: Promise<{
    error?: string;
    q?: string;
  }>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: Customer["status"] }) {
  return (
    <span
      className={
        status === "active"
          ? "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white"
          : "inline-flex rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
      }
    >
      {status === "active" ? "Active" : "Inactive"}
    </span>
  );
}

function EmptySetupState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">Customers</h1>
      <p className="mt-2 text-sm text-zinc-600">Manage your salon customers.</p>
      <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">Choose a Salon first</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Customers belong to the current Salon, so set up and select a Salon before
          managing customer profiles.
        </p>
        <Link
          className="mt-5 inline-flex rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          href="/salons"
        >
          Go to Salons
        </Link>
      </div>
    </main>
  );
}

function CustomerList({
  customers,
  canManageCustomers,
}: {
  customers: Customer[];
  canManageCustomers: boolean;
}) {
  if (customers.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No customers yet</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Create your first customer to start using Booking and POS.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-12 sm:col-span-3">Customer Name</div>
        <div className="hidden sm:col-span-2 sm:block">Phone</div>
        <div className="hidden sm:col-span-3 sm:block">Email</div>
        <div className="hidden sm:col-span-2 sm:block">Status</div>
        <div className="hidden sm:col-span-1 sm:block">Created</div>
        <div className="hidden sm:col-span-1 sm:block">Actions</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {customers.map((customer) => (
          <li className="grid grid-cols-12 gap-3 px-5 py-4" key={customer.id}>
            <div className="col-span-12 sm:col-span-3">
              <p className="font-medium text-zinc-950">{customer.name}</p>
            </div>
            <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
              <span className="font-medium text-zinc-500 sm:hidden">Phone: </span>
              {customer.phone || "-"}
            </div>
            <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-3">
              <span className="font-medium text-zinc-500 sm:hidden">Email: </span>
              {customer.email || "-"}
            </div>
            <div className="col-span-6 self-center sm:col-span-2">
              <StatusBadge status={customer.status} />
            </div>
            <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-1">
              <span className="font-medium text-zinc-500 sm:hidden">Created: </span>
              {formatDate(customer.created_at)}
            </div>
            <div className="col-span-12 flex flex-wrap gap-2 self-center text-sm sm:col-span-1 sm:block sm:space-y-2">
              <Link className="font-medium text-zinc-950 underline" href={`/customers/${customer.id}`}>
                View
              </Link>
              {canManageCustomers ? (
                <Link
                  className="font-medium text-zinc-950 underline sm:block"
                  href={`/customers/${customer.id}/edit`}
                >
                  Edit
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const { error, q } = await searchParams;
  const { context, customers } = await getCurrentSalonCustomers(q);

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentOrganization || !context.currentSalon) {
    return <EmptySetupState />;
  }

  const canManageCustomers = await hasPermission("customers.manage", context);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-zinc-950">Customers</h1>
          <p className="mt-2 text-sm text-zinc-600">Manage your salon customers.</p>
        </div>
        {canManageCustomers ? (
          <Link
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
            href="/customers/new"
          >
            + Create Customer
          </Link>
        ) : null}
      </div>

      {error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <section className="border-b border-zinc-200 py-6">
        <form className="flex flex-col gap-3 sm:flex-row" action="/customers">
          <input
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950 sm:max-w-sm"
            defaultValue={q ?? ""}
            name="q"
            placeholder="Search customers..."
            type="search"
          />
          <button
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
            type="submit"
          >
            Search
          </button>
          {q ? (
            <Link
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
              href="/customers"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </section>

      <section className="pt-6">
        <CustomerList customers={customers} canManageCustomers={canManageCustomers} />
      </section>
    </main>
  );
}
