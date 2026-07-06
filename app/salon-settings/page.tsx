import { updateSalonSettings } from "@/app/salon-settings/actions";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { getCurrentSalonSetting } from "@/lib/salon-settings";
import type { SalonSetting } from "@/types/salon-setting";
import { redirect } from "next/navigation";

type SalonSettingsPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

function Field({
  label,
  name,
  autoComplete,
  defaultValue,
  required = false,
  type = "text",
}: {
  label: string;
  name: string;
  autoComplete?: string;
  defaultValue?: string | null;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
        defaultValue={defaultValue ?? ""}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}

function MissingSalonState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">Salon Settings</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Manage business information for this salon.
      </p>
      <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        Please select a salon first.
      </p>
    </main>
  );
}

function SalonSettingsForm({
  canManageSettings,
  error,
  setting,
}: {
  canManageSettings: boolean;
  error?: string;
  setting: SalonSetting;
}) {
  return (
    <form
      action={canManageSettings ? updateSalonSettings : undefined}
      className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-2">
          {error}
        </p>
      ) : null}

      {!canManageSettings ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600 sm:col-span-2">
          You do not have permission to manage salon settings.
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Field
          autoComplete="organization"
          defaultValue={setting.business_name}
          label="Business Name"
          name="business_name"
          required
        />
      </div>
      <Field
        autoComplete="tel"
        defaultValue={setting.phone}
        label="Phone"
        name="phone"
      />
      <Field
        autoComplete="email"
        defaultValue={setting.email}
        label="Email"
        name="email"
        type="email"
      />
      <Field
        autoComplete="url"
        defaultValue={setting.website}
        label="Website"
        name="website"
        type="url"
      />
      <Field
        autoComplete="address-line1"
        defaultValue={setting.address_line1}
        label="Address Line 1"
        name="address_line1"
      />
      <Field
        autoComplete="address-line2"
        defaultValue={setting.address_line2}
        label="Address Line 2"
        name="address_line2"
      />
      <Field
        autoComplete="address-level2"
        defaultValue={setting.city}
        label="City"
        name="city"
      />
      <Field
        autoComplete="address-level1"
        defaultValue={setting.state}
        label="State"
        name="state"
      />
      <Field
        autoComplete="postal-code"
        defaultValue={setting.postal_code}
        label="Postal Code"
        name="postal_code"
      />
      <Field
        autoComplete="country-name"
        defaultValue={setting.country}
        label="Country"
        name="country"
      />

      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-zinc-700">
          Business Description
        </span>
        <textarea
          className="mt-2 min-h-28 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={setting.business_description ?? ""}
          name="business_description"
        />
      </label>

      <div className="sm:col-span-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
          disabled={!canManageSettings}
          type="submit"
        >
          Save
        </button>
      </div>
    </form>
  );
}

export default async function SalonSettingsPage({
  searchParams,
}: SalonSettingsPageProps) {
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

  const canViewSettings = await hasPermission("salon_settings.view", context);

  if (!canViewSettings) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">Salon Settings</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Manage business information for this salon.
        </p>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to view salon settings.
        </p>
      </main>
    );
  }

  const [{ setting }, canManageSettings] = await Promise.all([
    getCurrentSalonSetting(),
    hasPermission("salon_settings.manage", context),
  ]);

  if (!setting) {
    throw new Error("Salon settings could not be loaded.");
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="border-b border-zinc-200 pb-6">
        <h1 className="text-3xl font-semibold text-zinc-950">Salon Settings</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Manage business information for this salon.
        </p>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">
          Business Information
        </h2>
        <SalonSettingsForm
          canManageSettings={canManageSettings}
          error={error}
          setting={setting}
        />
      </section>
    </main>
  );
}
