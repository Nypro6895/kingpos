import { createCustomer } from "@/app/customers/actions";
import { CustomerForm } from "@/app/customers/customer-form";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
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
    requireSalonManagePageContext("/customers/new"),
  ]);

  const canManageCustomers = await hasPermission("customers.manage", context);

  if (!canManageCustomers) {
    redirect("/customers?error=You%20do%20not%20have%20permission%20to%20manage%20customers.");
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
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
