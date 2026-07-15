import { updateCustomer } from "@/app/customers/actions";
import { CustomerForm } from "@/app/customers/customer-form";
import { getCurrentSalonCustomer } from "@/lib/customers";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type EditCustomerPageProps = {
  params: Promise<{
    customerId: string;
  }>;
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function EditCustomerPage({
  params,
  searchParams,
}: EditCustomerPageProps) {
  const [{ customerId }, { error }] = await Promise.all([params, searchParams]);
  await requireSalonManagePageContext(`/customers/${customerId}/edit`);
  const { context, customer } = await getCurrentSalonCustomer(customerId);

  if (!customer) {
    notFound();
  }

  const canManageCustomers = await hasPermission("customers.manage", context);

  if (!canManageCustomers) {
    redirect(
      `/customers/${customer.id}?error=You%20do%20not%20have%20permission%20to%20manage%20customers.`,
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="border-b border-zinc-200 pb-6">
        <p className="text-sm font-medium text-zinc-500">Customers</p>
        <h1 className="mt-1 text-3xl font-semibold text-zinc-950">Edit Customer</h1>
        <p className="mt-2 text-sm text-zinc-600">{customer.name}</p>
      </div>

      <CustomerForm
        action={updateCustomer}
        customer={customer}
        error={error}
        mode="edit"
      />

      <Link
        className="mt-6 inline-flex text-sm font-medium text-zinc-950 underline"
        href={`/customers/${customer.id}`}
      >
        Back to Customer
      </Link>
    </main>
  );
}
