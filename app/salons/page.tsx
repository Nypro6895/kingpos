import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import {
  isOwnerMembership,
  LOCATION_SELECT,
  setCurrentManageSalonCookie,
  setCurrentOrganizationCookie,
} from "@/lib/current-context";
import { requireOrganizationPageContext } from "@/lib/route-context-guards";
import { setCurrentSalon } from "@/app/salons/actions";
import type { Location } from "@/types/location";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";

type SalonsPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

function readRequiredString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function readOptionalString(formData: FormData, key: string) {
  const value = readRequiredString(formData, key);
  return value || null;
}

function redirectWithError(message: string): never {
  redirect(`/salons?error=${encodeURIComponent(message)}`);
}

async function createSalon(formData: FormData) {
  "use server";

  const supabase = await createAuthenticatedSupabaseServerClient();
  const context = await requireOrganizationPageContext("/salons");

  if (!supabase || !context.user) {
    redirect("/login");
  }

  const name = readRequiredString(formData, "name");

  if (!name) {
    redirectWithError("Salon name is required.");
  }

  const membership = context.currentMembership;
  const organization = context.currentOrganization;

  if (!membership || !organization) {
    redirectWithError("Create an organization before adding your first Salon.");
  }

  if (!isOwnerMembership(membership)) {
    redirectWithError("Only an Owner can create Salons for this organization.");
  }

  const { data: salon, error } = await supabase
    .from("locations")
    .insert({
      organization_id: organization.id,
      name,
      phone: readOptionalString(formData, "phone"),
      address_line1: readOptionalString(formData, "address_line1"),
      address_line2: readOptionalString(formData, "address_line2"),
      city: readOptionalString(formData, "city"),
      state: readOptionalString(formData, "state"),
      postal_code: readOptionalString(formData, "postal_code"),
      country: "US",
      status: "active",
    })
    .select(LOCATION_SELECT)
    .single<Location>();

  if (error) {
    console.error("Supabase create salon failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      organizationId: organization.id,
      userId: context.user.id,
    });
    redirectWithError(error.message);
  }

  if (context.salons.length === 0 && salon) {
    await setCurrentOrganizationCookie(organization.id);
    await setCurrentManageSalonCookie(salon.id);
  }

  revalidatePath("/salons");
  revalidatePath("/", "layout");
  redirect("/salons");
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
  const lines = [salon.address_line1, salon.address_line2, cityStateZip].filter(Boolean);

  return lines.length > 0 ? lines.join(", ") : null;
}

function InputField({
  label,
  name,
  autoComplete,
  required = false,
}: {
  label: string;
  name: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
        name={name}
        required={required}
        type="text"
      />
    </label>
  );
}

function SalonForm() {
  return (
    <form
      action={createSalon}
      className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <InputField
          autoComplete="organization"
          label="Salon name"
          name="name"
          required
        />
      </div>
      <InputField autoComplete="tel" label="Phone" name="phone" />
      <InputField autoComplete="address-line1" label="Address line 1" name="address_line1" />
      <InputField autoComplete="address-line2" label="Address line 2" name="address_line2" />
      <InputField autoComplete="address-level2" label="City" name="city" />
      <InputField autoComplete="address-level1" label="State" name="state" />
      <InputField autoComplete="postal-code" label="Zip code" name="postal_code" />

      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Create Salon
        </button>
      </div>
    </form>
  );
}

function SalonList({
  salons,
  currentSalonId,
  canSwitchSalon,
}: {
  salons: Location[];
  currentSalonId: string | null;
  canSwitchSalon: boolean;
}) {
  if (salons.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No Salons yet</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Create your first Salon so future customers, services, tickets, and bookings have
          a home.
        </p>
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
        <div className="hidden sm:col-span-2 sm:block">Current Salon</div>
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
                      className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950"
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

export default async function SalonsPage({ searchParams }: SalonsPageProps) {
  const [{ error }, context] = await Promise.all([
    searchParams,
    requireOrganizationPageContext("/salons"),
  ]);

  const membership = context.currentMembership;
  const organization = context.currentOrganization;

  if (!membership || !organization) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="text-sm font-medium text-zinc-500">KingPOS Platform</p>
        <h1 className="mt-1 text-3xl font-semibold text-zinc-950">Salons</h1>
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
          <h2 className="text-lg font-semibold text-zinc-950">Set up an organization first</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Your first Salon needs to belong to an organization before it can be created.
          </p>
          <Link
            className="mt-5 inline-flex rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
            href="/organizations"
          >
            Go to organization setup
          </Link>
        </div>
      </main>
    );
  }

  const salons = [...context.salons].sort(
    (left, right) =>
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-500">KingPOS Platform</p>
          <h1 className="mt-1 text-3xl font-semibold text-zinc-950">Salons</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Manage the Salons connected to your organization.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/organizations"
          >
            Organizations
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/permissions"
          >
            Permissions
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/roles"
          >
            Roles
          </Link>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/account"
          >
            Account
          </Link>
        </div>
      </div>

      {error ? (
        <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Your Salons</h2>
        <SalonList
          canSwitchSalon={isOwnerMembership(membership)}
          currentSalonId={context.currentSalon?.id ?? null}
          salons={salons}
        />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-950">Create Salon</h2>
        {isOwnerMembership(membership) ? (
          <SalonForm />
        ) : (
          <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
            Only an Owner can create Salons for this organization.
          </p>
        )}
      </section>
    </main>
  );
}
