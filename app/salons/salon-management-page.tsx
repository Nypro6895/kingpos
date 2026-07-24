import { createSalonAction, setCurrentSalon } from "@/app/salons/actions";
import { CreateSalonSubmitButton } from "@/app/salons/create-salon-submit-button";
import {
  getCreateSalonAccount,
  getCurrentBusinessContext,
} from "@/lib/current-context";
import { routes, withSearchParams } from "@/lib/routes";
import type { Location } from "@/types/location";
import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

type SalonManagementMode = "create" | "list";

type SalonManagementSearchParams = {
  created?: string | string[];
  error?: string | string[];
};

type SalonManagementPageProps = {
  mode: SalonManagementMode;
  searchParams: Promise<SalonManagementSearchParams>;
};

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatAddress(salon: Location) {
  const cityStateZip = [salon.city, salon.state, salon.postal_code]
    .filter(Boolean)
    .join(", ");
  const lines = [
    salon.address_line1,
    salon.address_line2,
    cityStateZip,
  ].filter(Boolean);

  return lines.length > 0 ? lines.join(", ") : null;
}

function InputField({
  autoComplete,
  label,
  name,
  required = false,
}: {
  autoComplete?: string;
  label: string;
  name: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
        name={name}
        required={required}
        type="text"
      />
    </label>
  );
}

function SalonForm({ createRequestKey }: { createRequestKey: string }) {
  return (
    <form
      action={createSalonAction}
      className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      <input name="create_request_key" type="hidden" value={createRequestKey} />
      <div className="sm:col-span-2">
        <InputField
          autoComplete="Account"
          label="Salon name"
          name="name"
          required
        />
      </div>
      <InputField autoComplete="tel" label="Phone" name="phone" />
      <InputField
        autoComplete="address-line1"
        label="Address line 1"
        name="address_line1"
      />
      <InputField
        autoComplete="address-line2"
        label="Address line 2"
        name="address_line2"
      />
      <InputField autoComplete="address-level2" label="City" name="city" />
      <InputField autoComplete="address-level1" label="State" name="state" />
      <InputField
        autoComplete="postal-code"
        label="Zip code"
        name="postal_code"
      />

      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <CreateSalonSubmitButton />
        <Link
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          href={routes.salons.list()}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function SalonCreationUnavailable({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-5">
      <h2 className="text-sm font-semibold text-amber-950">{title}</h2>
      <p className="mt-2 text-sm text-amber-900">{description}</p>
      <Link
        className="mt-4 inline-flex rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-950 transition hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        href={routes.salons.list()}
      >
        Back to Salons
      </Link>
    </div>
  );
}

function SalonList({
  canSwitchSalon,
  currentSalonId,
  salons,
  showCreateAction,
}: {
  canSwitchSalon: boolean;
  currentSalonId: string | null;
  salons: Location[];
  showCreateAction: boolean;
}) {
  if (salons.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No salons yet</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Create your first salon so customers, services, tickets, and bookings
          have a home.
        </p>
        {showCreateAction ? (
          <Link
            className="mt-4 inline-flex rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            href={routes.salons.create()}
          >
            Create your first Salon
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-12 sm:col-span-3">Salon</div>
        <div className="hidden sm:col-span-3 sm:block">Address</div>
        <div className="hidden sm:col-span-2 sm:block">Phone</div>
        <div className="hidden sm:col-span-2 sm:block">Status</div>
        <div className="hidden sm:col-span-2 sm:block">Current</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {salons.map((salon) => {
          const address = formatAddress(salon);
          const isCurrentSalon = salon.id === currentSalonId;

          return (
            <li className="grid grid-cols-12 gap-3 px-5 py-4" key={salon.id}>
              <div className="col-span-12 sm:col-span-3">
                <p className="font-medium text-zinc-950">{salon.name}</p>
                {isCurrentSalon ? (
                  <span className="mt-2 inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white">
                    Current Salon
                  </span>
                ) : null}
              </div>
              <div className="col-span-12 self-center text-sm text-zinc-600 sm:col-span-3">
                <span className="font-medium text-zinc-500 sm:hidden">Address: </span>
                {address || "No address"}
              </div>
              <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
                <span className="font-medium text-zinc-500 sm:hidden">Phone: </span>
                {salon.phone || "-"}
              </div>
              <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-2">
                <span className="font-medium text-zinc-500 sm:hidden">Status: </span>
                {formatLabel(salon.status)}
              </div>
              <div className="col-span-12 self-center text-sm text-zinc-600 sm:col-span-2">
                {isCurrentSalon ? (
                  <span className="font-medium text-zinc-950">Selected</span>
                ) : canSwitchSalon ? (
                  <form action={setCurrentSalon}>
                    <input name="salon_id" type="hidden" value={salon.id} />
                    <button
                      className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                      type="submit"
                    >
                      Set as Current
                    </button>
                  </form>
                ) : (
                  <span>-</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export async function SalonManagementPage({
  mode,
  searchParams,
}: SalonManagementPageProps) {
  const [{ created, error }, context] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect(
      withSearchParams("/login", {
        next: mode === "create" ? routes.salons.create() : routes.salons.list(),
      }),
    );
  }

  const errorMessage = firstSearchParam(error);
  const createdMessage =
    firstSearchParam(created) === "1" ? "Salon created successfully." : null;
  const createSalonAccount = getCreateSalonAccount(context);
  const hasCreatePermission = Boolean(createSalonAccount);
  const salons = [...context.availableManageSalons].sort(
    (left, right) =>
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );

  if (mode === "create") {
    const targetAccountName =
      createSalonAccount?.name ?? context.accountName ?? "your account";

    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="border-b border-zinc-200 pb-6">
          <p className="text-sm font-medium text-zinc-500">KITY Platform</p>
          <h1 className="mt-1 text-3xl font-semibold text-zinc-950">
            Create Salon
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Set up a new salon under {targetAccountName}.
          </p>
        </div>

        {errorMessage ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errorMessage}
          </p>
        ) : null}

        {hasCreatePermission ? (
          <SalonForm createRequestKey={randomUUID()} />
        ) : (
          <SalonCreationUnavailable
            description="You do not have permission to create a salon."
            title="Create Salon is unavailable"
          />
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500">KITY Platform</p>
          <h1 className="mt-1 text-3xl font-semibold text-zinc-950">Salons</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Manage the salons connected to your Account.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {hasCreatePermission ? (
            <Link
              aria-label="Create Salon"
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              href={routes.salons.create()}
            >
              Create Salon
            </Link>
          ) : null}
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            href="/permissions"
          >
            Permissions
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            href="/roles"
          >
            Roles
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            href="/account"
          >
            Account
          </Link>
        </div>
      </div>

      {errorMessage ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorMessage}
        </p>
      ) : null}
      {createdMessage ? (
        <p className="mt-6 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {createdMessage}
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Your Salons</h2>
        <SalonList
          canSwitchSalon={Boolean(context.user)}
          currentSalonId={context.currentBusiness?.id ?? context.currentSalon?.id ?? null}
          salons={salons}
          showCreateAction={hasCreatePermission}
        />
      </section>
    </main>
  );
}
