import { createCustomer } from "@/app/customers/actions";
import { CustomerForm } from "@/app/customers/customer-form";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import Link from "next/link";
import { redirect } from "next/navigation";

type NewCustomerPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function NewCustomerPage({ searchParams }: NewCustomerPageProps) {
  const [{ error }, context] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentOrganization || !context.currentSalon) {
    redirect("/customers");
  }

  const canManageCustomers = await hasPermission("customers.manage", context);

  if (!canManageCustomers) {
    redirect("/customers?error=You%20do%20not%20have%20permission%20to%20manage%20customers.");
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="border-b border-zinc-200 pb-6">
        <p className="text-sm font-medium text-zinc-500">Customers</p>
        <h1 className="mt-1 text-3xl font-semibold text-zinc-950">Create Customer</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Add a customer profile to {context.currentSalon.name}.
        </p>
      </div>

      <CustomerForm action={createCustomer} error={error} mode="create" />

      <Link
        className="mt-6 inline-flex text-sm font-medium text-zinc-950 underline"
        href="/customers"
      >
        Back to Customers
      </Link>
    </main>
  );
}
