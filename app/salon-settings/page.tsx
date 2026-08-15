import {
  refreshSalonMapLocation,
  updateSalonSettings,
} from "@/app/salon-settings/actions";
import { MapLocationPreview } from "@/app/salon-settings/map-location-preview";
import {
  PublicTeamSettingsEditor,
  type PublicTeamSettingsMember,
} from "@/app/salon-settings/public-team-settings-editor";
import { hasPermission } from "@/lib/permissions";
import {
  getCurrentSalonMapLocationState,
  type SalonMapLocationState,
} from "@/lib/location/salon-map-location";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import {
  getCurrentSalonDiscoveryReadiness,
  getCurrentSalonSetting,
  type SalonDiscoveryReadiness,
} from "@/lib/salon-settings";
import { getCurrentSalonStaffDirectory } from "@/lib/staff";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import type { SalonSetting } from "@/types/salon-setting";
import type { StaffDirectoryMember } from "@/lib/staff";
import Link from "next/link";

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

function PublicTeamSettingsSection({
  canManageSettings,
  staff,
}: {
  canManageSettings: boolean;
  staff: StaffDirectoryMember[];
}) {
  const members: PublicTeamSettingsMember[] = staff.map((member) => ({
    avatarUrl: getSalonProfileMediaUrl(member.public_profile_photo_path),
    displayName: member.display_name,
    id: member.id,
    isActive: member.is_active,
    jobTitle: member.job_title,
    onlineBookingEnabled: member.online_booking_enabled,
    ownerPublicEnabled: member.owner_public_enabled,
    profileDisplayOrder: member.profile_display_order,
    salonProfileContentPostingEnabled:
      member.salon_profile_content_posting_enabled,
    staffPublicConsentStatus: member.staff_public_consent_status,
  }));

  return (
    <section className="mt-8" id="public-team">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">
          Public team & staff profiles
        </h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600">
          Control which active staff can appear publicly, receive direct booking
          requests, and post to Salon Profile. Staff opt-out cannot be overridden here.
        </p>
      </div>

      <PublicTeamSettingsEditor
        canManageSettings={canManageSettings}
        members={members}
      />
    </section>
  );
}

function MapLocationSection({
  canManageSettings,
  mapLocation,
  salonName,
}: {
  canManageSettings: boolean;
  mapLocation: SalonMapLocationState;
  salonName: string;
}) {
  const publicMapConfigured = Boolean(
    process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim(),
  );
  const missingConfiguration = [
    ...mapLocation.providerMissingConfiguration,
    ...(publicMapConfigured ? [] : ["NEXT_PUBLIC_MAPTILER_KEY"]),
  ];
  const statusClass =
    mapLocation.status === "mapped"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : mapLocation.status === "provider_unavailable"
        ? "border-zinc-200 bg-zinc-50 text-zinc-700"
        : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <div className="grid gap-3 rounded-md border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-zinc-950">Map location</h4>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            {mapLocation.address.formattedAddress || "No public address yet."}
          </p>
        </div>
        <span
          className={[
            "w-fit rounded-md border px-2.5 py-1 text-xs font-semibold",
            statusClass,
          ].join(" ")}
        >
          {mapLocation.statusLabel}
        </span>
      </div>
      <p className="text-sm leading-6 text-zinc-600">
        {mapLocation.statusDescription}
      </p>
      {mapLocation.coordinates ? (
        <p className="text-xs font-medium text-zinc-500">
          Coordinates are stored for the current mapped address. Last geocoded:{" "}
          {mapLocation.geocodedAt
            ? new Intl.DateTimeFormat("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(mapLocation.geocodedAt))
            : "not recorded"}
          .
        </p>
      ) : null}
      {missingConfiguration.length > 0 ? (
        <p className="text-xs font-medium text-zinc-500">
          Configure {missingConfiguration.join(" and ")} to enable geocoding
          and map tiles.
        </p>
      ) : null}
      {mapLocation.providerConfigured &&
      publicMapConfigured &&
      mapLocation.coordinates &&
      mapLocation.status === "mapped" ? (
        <MapLocationPreview
          coordinates={mapLocation.coordinates}
          locationLabel={mapLocation.address.cityStateLabel || null}
          salonName={salonName}
        />
      ) : null}
      <div>
        <button
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canManageSettings || !mapLocation.refreshEnabled}
          formAction={refreshSalonMapLocation}
          type="submit"
        >
          Refresh map location
        </button>
      </div>
    </div>
  );
}

function SalonSettingsForm({
  canManageSettings,
  discoveryReadiness,
  error,
  mapLocation,
  setting,
}: {
  canManageSettings: boolean;
  discoveryReadiness: SalonDiscoveryReadiness;
  error?: string;
  mapLocation: SalonMapLocationState;
  setting: SalonSetting;
}) {
  const canToggleDiscovery =
    canManageSettings &&
    (discoveryReadiness.canEnable || setting.public_discovery_enabled);
  const discoveryStatus = setting.public_discovery_enabled && discoveryReadiness.canEnable
    ? "Published on Explore"
    : discoveryReadiness.canEnable
      ? "Ready to publish"
      : "Missing required information";
  const discoveryStatusClass = setting.public_discovery_enabled && discoveryReadiness.canEnable
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : discoveryReadiness.canEnable
      ? "border-sky-200 bg-sky-50 text-sky-800"
      : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <form
      action={canManageSettings ? updateSalonSettings : undefined}
      className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
      id="business-information"
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
          autoComplete="Account"
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

      <div
        className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:col-span-2"
        id="public-profile-discovery"
      >
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-zinc-950">
              Public Profile & Discovery
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">
              Show this salon to customers on Explore. This does not affect
              staff applications.
            </p>
          </div>
          <span
            className={[
              "w-fit rounded-md border px-2.5 py-1 text-xs font-semibold",
              discoveryStatusClass,
            ].join(" ")}
          >
            {discoveryStatus}
          </span>
        </div>

        <label className="flex items-start gap-3 rounded-md border border-zinc-200 bg-white p-4 text-sm">
          <input
            className="mt-0.5 size-4 rounded border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
            defaultChecked={setting.public_discovery_enabled}
            disabled={!canToggleDiscovery}
            name="public_discovery_enabled"
            type="checkbox"
          />
          <span>
            <span className="block font-medium text-zinc-950">
              Show salon on Explore
            </span>
            <span className="mt-1 block text-zinc-600">
              Requires active location details, a public description, and at
              least one active service.
            </span>
          </span>
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          {discoveryReadiness.items.map((item) => (
            <div
              className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2"
              key={item.id}
            >
              <div>
                <p className="text-sm font-medium text-zinc-950">{item.label}</p>
                <p
                  className={[
                    "mt-0.5 text-xs font-semibold",
                    item.complete ? "text-emerald-700" : "text-amber-700",
                  ].join(" ")}
                >
                  {item.complete ? "Complete" : "Missing"}
                </p>
              </div>
              {!item.complete ? (
                item.href.startsWith("#") ? (
                  <a
                    className="text-sm font-semibold text-zinc-950 underline-offset-4 hover:underline"
                    href={item.href}
                  >
                    Update
                  </a>
                ) : (
                  <Link
                    className="text-sm font-semibold text-zinc-950 underline-offset-4 hover:underline"
                    href={item.href}
                  >
                    Open
                  </Link>
                )
              ) : null}
            </div>
          ))}
        </div>

        {!discoveryReadiness.canEnable ? (
          <p className="text-sm leading-6 text-zinc-600">
            Complete the missing items before enabling public discovery.
          </p>
        ) : null}

        <MapLocationSection
          canManageSettings={canManageSettings}
          mapLocation={mapLocation}
          salonName={setting.business_name}
        />
      </div>

      <label className="flex items-start gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm sm:col-span-2">
        <input
          className="mt-0.5 size-4 rounded border-zinc-300"
          defaultChecked={setting.allow_staff_applications}
          name="allow_staff_applications"
          type="checkbox"
        />
        <span>
          <span className="block font-medium text-zinc-950">
            Allow staff applications
          </span>
          <span className="mt-1 block text-zinc-600">
            Show this active salon in staff application search.
          </span>
        </span>
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
    requireSalonManagePageContext("/salon-settings"),
  ]);

  const canViewSettings = await hasPermission("salon_settings.view", context);

  if (!canViewSettings) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to view salon settings.
        </p>
      </main>
    );
  }

  const [{ setting }, canManageSettings, canViewStaff] = await Promise.all([
    getCurrentSalonSetting(),
    hasPermission("salon_settings.manage", context),
    hasPermission("staff.view", context),
  ]);

  if (!setting) {
    throw new Error("Salon settings could not be loaded.");
  }

  const [discoveryReadiness, mapLocation] = await Promise.all([
    getCurrentSalonDiscoveryReadiness(setting, context),
    getCurrentSalonMapLocationState({ context, setting }),
  ]);
  const staffDirectory = canViewStaff
    ? await getCurrentSalonStaffDirectory(context)
    : { staff: [] as StaffDirectoryMember[] };

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <section>
        <h2 className="text-lg font-semibold text-zinc-950">
          Business Information
        </h2>
        <SalonSettingsForm
          canManageSettings={canManageSettings}
          discoveryReadiness={discoveryReadiness}
          error={error}
          mapLocation={mapLocation}
          setting={setting}
        />
      </section>

      {canViewStaff ? (
        <PublicTeamSettingsSection
          canManageSettings={canManageSettings}
          staff={staffDirectory.staff}
        />
      ) : null}
    </main>
  );
}
