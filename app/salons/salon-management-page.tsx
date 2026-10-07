
import { SubmitButton } from "@/components/submit-button";
﻿import { createSalonAction, setCurrentSalon } from "@/app/salons/actions";
import { CreateSalonSubmitButton } from "@/app/salons/create-salon-submit-button";
import { ClaimSuggestions, ClearSalonCreationDraft } from "@/app/salons/claim-suggestions";
import { QueryErrorDialog } from "@/app/query-error-dialog";
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
  [key: string]: string | string[] | undefined;
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
  defaultValue,
}: {
  autoComplete?: string;
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
        name={name}
        defaultValue={defaultValue}
        required={required}
        type="text"
      />
    </label>
  );
}

function SalonForm({ createRequestKey, draft }: { createRequestKey: string; draft: SalonManagementSearchParams }) {
  const value = (key: string) => firstSearchParam(draft[key]);
  return (
    <ClaimSuggestions>
    <form
      action={createSalonAction}
      className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      <input name="create_request_key" type="hidden" value={createRequestKey} />
      <input name="duplicate_acknowledged" type="hidden" defaultValue="no" />
      <div className="sm:col-span-2">
        <InputField
          autoComplete="Account"
          label="Salon name"
          name="name"
          required
          defaultValue={value('name')}
        />
      </div>
      <InputField autoComplete="tel" label="Phone" name="phone" defaultValue={value('phone')} />
      <InputField
        autoComplete="address-line1"
        label="Address line 1"
        name="address_line1"
        defaultValue={value('address_line1')}
      />
      <InputField
        autoComplete="address-line2"
        label="Address line 2"
        name="address_line2"
        defaultValue={value('address_line2')}
      />
      <InputField autoComplete="address-level2" label="City" name="city" defaultValue={value('city')} />
      <InputField autoComplete="address-level1" label="State" name="state" defaultValue={value('state')} />
      <InputField
        autoComplete="postal-code"
        label="Zip code"
        name="postal_code"
        defaultValue={value('postal_code')}
      />

      <label className="flex items-start gap-3 rounded-md border border-zinc-200 p-4 sm:col-span-2">
        <input type="checkbox" name="owner_is_staff" value="yes" defaultChecked={value("owner_is_staff") === "yes"} className="mt-1" />
        <span><span className="block text-sm font-medium">I also work as staff at this salon</span>
          <span className="mt-1 block text-sm text-zinc-600">Create my staff profile using my personal name, email, and phone. I will keep my Owner access.</span>
        </span>
      </label>
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
    </ClaimSuggestions>
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
                    <SubmitButton pendingLabel="Processing…"
                      className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                      type="submit"
                    >
                      Set as Current
                    </SubmitButton>
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
  const [query, context] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
  ]);
  const {created,error}=query;

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
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <QueryErrorDialog
          message={errorMessage}
          primaryLabel="Review form"
          secondaryHref={routes.salons.list()}
          secondaryLabel="Salons"
          title="Salon action needed"
        />

        {hasCreatePermission ? (
          <SalonForm createRequestKey={randomUUID()} draft={query} />
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
      <div className="flex flex-wrap justify-end gap-3">
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
            href="/account"
          >
            Account
          </Link>
        </div>
      </div>

      <QueryErrorDialog
        message={errorMessage}
        primaryLabel="Review salons"
        secondaryHref="/my-place"
        secondaryLabel="My Place"
        title="Salon action needed"
      />
      {createdMessage ? (
        <><ClearSalonCreationDraft /><p className="mt-6 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {createdMessage}
        </p></>
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
