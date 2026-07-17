import { createService, saveServiceAddOnsAction } from "@/app/services/actions";
import { ServiceBookableStaffEditor } from "@/app/booking-setup/booking-setup-editors";
import { getCurrentSalonBookingSetup } from "@/lib/booking-setup";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { getCurrentSalonServices, type ServiceWithAddOns } from "@/lib/services";
import Link from "next/link";

type ServicesPageProps = {
  searchParams: Promise<{
    error?: string;
    service?: string | string[];
    setup?: string | string[];
  }>;
};

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function servicesHref(input: { serviceId?: string | null; setup?: string }) {
  const params = new URLSearchParams();

  if (input.serviceId) {
    params.set("service", input.serviceId);
  }

  if (input.setup) {
    params.set("setup", input.setup);
  }

  const query = params.toString();

  return query ? `/services?${query}` : "/services";
}

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

function ServicesList({
  canManageServices,
  selectedServiceId,
  services,
}: {
  canManageServices: boolean;
  selectedServiceId?: string | null;
  services: ServiceWithAddOns[];
}) {
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
        <div className="hidden sm:col-span-2 sm:block">Category</div>
        <div className="hidden sm:col-span-2 sm:block">Price</div>
        <div className="hidden sm:col-span-2 sm:block">Duration</div>
        <div className="hidden sm:col-span-1 sm:block">Status</div>
        <div className="hidden sm:col-span-2 sm:block">Booking</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {services.map((service) => (
          <li className="grid grid-cols-12 gap-3 px-5 py-4" key={service.id}>
            <div className="col-span-12 sm:col-span-3">
              <p className="font-medium text-zinc-950">{service.name}</p>
            </div>
            <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-2">
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
            <div className="col-span-6 self-center sm:col-span-1">
              <StatusBadge isActive={service.is_active} />
            </div>
            <div className="col-span-12 sm:col-span-2">
              <Link
                className={`inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-semibold ${
                  selectedServiceId === service.id
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-300 bg-white text-zinc-950"
                }`}
                href={servicesHref({
                  serviceId: service.id,
                  setup: "bookable_staff",
                })}
              >
                Bookable staff
              </Link>
            </div>
            <div className="col-span-12">
              <form
                action={saveServiceAddOnsAction}
                className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 p-3"
              >
                <input name="parent_service_id" type="hidden" value={service.id} />
                <p className="text-xs font-semibold uppercase text-zinc-500">
                  Add-ons for {service.name}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {services
                    .filter((candidate) => candidate.id !== service.id && candidate.is_active)
                    .map((candidate) => (
                      <label
                        className="flex items-center gap-2 text-sm text-zinc-700"
                        key={candidate.id}
                      >
                        <input
                          className="size-4"
                          defaultChecked={service.addOnServiceIds.includes(candidate.id)}
                          disabled={!canManageServices}
                          name="add_on_service_ids"
                          type="checkbox"
                          value={candidate.id}
                        />
                        {candidate.name}
                      </label>
                    ))}
                </div>
                {canManageServices ? (
                  <button
                    className="mt-3 rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white"
                    type="submit"
                  >
                    Save add-ons
                  </button>
                ) : null}
              </form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function ServicesPage({ searchParams }: ServicesPageProps) {
  const [params, context] = await Promise.all([
    searchParams,
    requireSalonManagePageContext("/services"),
  ]);
  const error = stringParam(params.error);
  const selectedServiceId = stringParam(params.service);
  const setupMode = stringParam(params.setup);

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

  const [{ services }, bookingSetup, canManageServices] = await Promise.all([
    getCurrentSalonServices(),
    getCurrentSalonBookingSetup(context),
    hasPermission("services.manage", context),
  ]);
  const selectedService =
    selectedServiceId && setupMode === "bookable_staff"
      ? bookingSetup.services.find((service) => service.id === selectedServiceId)
      : null;

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
        <ServicesList
          canManageServices={canManageServices}
          selectedServiceId={selectedService?.id ?? null}
          services={services}
        />
      </section>

      {setupMode === "bookable_staff" ? (
        <section className="mt-8">
          {selectedService ? (
            <ServiceBookableStaffEditor
              assignments={bookingSetup.assignments}
              canManage={bookingSetup.permissions.canManageAssignments}
              readinessByStaffId={bookingSetup.readinessByStaffId}
              service={selectedService}
              staff={bookingSetup.staff}
            />
          ) : (
            <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h2 className="text-base font-semibold text-zinc-950">
                Select a service
              </h2>
              <div className="flex flex-wrap gap-2">
                {bookingSetup.services.map((service) => (
                  <Link
                    className="min-h-10 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-950"
                    href={servicesHref({
                      serviceId: service.id,
                      setup: "bookable_staff",
                    })}
                    key={service.id}
                  >
                    {service.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
