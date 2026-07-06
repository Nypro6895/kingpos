import { createService } from "@/app/services/actions";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { getCurrentSalonServices } from "@/lib/services";
import type { Service } from "@/types/service";
import { redirect } from "next/navigation";

type ServicesPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

function Field({
  label,
  name,
  autoComplete,
  defaultValue,
  min,
  required = false,
  step,
  type = "text",
}: {
  label: string;
  name: string;
  autoComplete?: string;
  defaultValue?: string;
  min?: string;
  required?: boolean;
  step?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
        defaultValue={defaultValue}
        min={min}
        name={name}
        required={required}
        step={step}
        type={type}
      />
    </label>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={
        isActive
          ? "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white"
          : "inline-flex rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
      }
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function MissingSalonState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">Services</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Manage services for this salon.
      </p>
      <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        Please select a salon first.
      </p>
    </main>
  );
}

function ServicesForm({
  error,
  canManageServices,
}: {
  error?: string;
  canManageServices: boolean;
}) {
  if (!canManageServices) {
    return (
      <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
        You do not have permission to manage services.
      </p>
    );
  }

  return (
    <form
      action={createService}
      className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-2">
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Field label="Name" name="name" required />
      </div>
      <Field label="Category" name="category" />
      <Field
        defaultValue="0.00"
        label="Base Price"
        min="0"
        name="base_price"
        required
        step="0.01"
        type="number"
      />
      <Field
        defaultValue="30"
        label="Duration (minutes)"
        min="1"
        name="duration_minutes"
        required
        step="1"
        type="number"
      />

      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-zinc-700">Description</span>
        <textarea
          className="mt-2 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="description"
        />
      </label>

      <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 sm:col-span-2">
        <input
          className="size-4 rounded border-zinc-300"
          defaultChecked
          name="is_active"
          type="checkbox"
        />
        Active
      </label>

      <div className="sm:col-span-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Create
        </button>
      </div>
    </form>
  );
}

function ServicesList({ services }: { services: Service[] }) {
  if (services.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No services yet</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Create your first service for this salon.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-12 sm:col-span-3">Name</div>
        <div className="hidden sm:col-span-3 sm:block">Category</div>
        <div className="hidden sm:col-span-2 sm:block">Price</div>
        <div className="hidden sm:col-span-2 sm:block">Duration</div>
        <div className="hidden sm:col-span-2 sm:block">Status</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {services.map((service) => (
          <li className="grid grid-cols-12 gap-3 px-5 py-4" key={service.id}>
            <div className="col-span-12 sm:col-span-3">
              <p className="font-medium text-zinc-950">{service.name}</p>
            </div>
            <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-3">
              <span className="font-medium text-zinc-500 sm:hidden">Category: </span>
              {service.category || "-"}
            </div>
            <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
              <span className="font-medium text-zinc-500 sm:hidden">Price: </span>
              {formatPrice(service.base_price)}
            </div>
            <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
              <span className="font-medium text-zinc-500 sm:hidden">Duration: </span>
              {service.duration_minutes} min
            </div>
            <div className="col-span-6 self-center sm:col-span-2">
              <StatusBadge isActive={service.is_active} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function ServicesPage({ searchParams }: ServicesPageProps) {
  const [{ error }, context] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return <MissingSalonState />;
  }

  const canViewServices = await hasPermission("services.view", context);

  if (!canViewServices) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">Services</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Manage services for this salon.
        </p>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to view services.
        </p>
      </main>
    );
  }

  const [{ services }, canManageServices] = await Promise.all([
    getCurrentSalonServices(),
    hasPermission("services.manage", context),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="border-b border-zinc-200 pb-6">
        <h1 className="text-3xl font-semibold text-zinc-950">Services</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Manage services for this salon.
        </p>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Create Service</h2>
        <ServicesForm canManageServices={canManageServices} error={error} />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-950">Services</h2>
        <ServicesList services={services} />
      </section>
    </main>
  );
}
