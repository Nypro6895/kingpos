
import { SubmitButton } from "@/components/submit-button";
import { getSalonOwnerRoster } from "@/lib/owner-transfer";
import {
  createCurrentSalonSpecialHoursAction,
  deleteCurrentSalonSpecialHoursAction,
  refreshSalonMapLocation,
  updateSalonSettings,
} from "@/app/salon-settings/actions";
import { SalonOperatingStatusBadge } from "@/components/salon-operating-status-badge";
import { MapLocationPreview } from "@/app/salon-settings/map-location-preview";
import { SalonOwnershipSection } from "@/app/salon-settings/ownership-section";
import {
  PublicTeamSettingsEditor,
  type PublicTeamSettingsMember,
} from "@/app/salon-settings/public-team-settings-editor";
import { SalonLifecycleSection } from "@/app/salon-settings/salon-lifecycle-section";
import { isOwnerMembership } from "@/lib/current-context";
import {
  getCurrentSalonMapLocationState,
  type SalonMapLocationState,
} from "@/lib/location/salon-map-location";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import {
  getSalonClosureReview,
  getSalonLifecycle,
} from "@/lib/salon-lifecycle";
import {
  getCurrentSalonDiscoveryReadiness,
  getCurrentSalonSetting,
  type SalonDiscoveryReadiness,
} from "@/lib/salon-settings";
import { getCurrentSalonOperatingHoursSettings } from "@/lib/salon-operating-status";
import {
  getCurrentSalonStaffDirectory,
  type StaffDirectoryMember,
} from "@/lib/staff";
import type {
  SalonOperatingHoursSettings,
  SalonOperatingHoursWindow,
  SalonSpecialHours,
} from "@/types/salon-operating-status";
import type { SalonSetting } from "@/types/salon-setting";
import Link from "next/link";
import { StaffCreationPermission } from "@/app/staff/appointments/staff-create-appointment";

type SalonSettingsPageProps = {
  searchParams: Promise<{
    error?: string;
    lifecycle_error?: string;
    notice?: string;
    operating_notice?: string;
  }>;
};

type NavItem = {
  href: string;
  label: string;
  tone?: "danger" | "neutral";
};

const OPERATING_WEEK_DAYS = [
  { dayOfWeek: 1, label: "Monday" },
  { dayOfWeek: 2, label: "Tuesday" },
  { dayOfWeek: 3, label: "Wednesday" },
  { dayOfWeek: 4, label: "Thursday" },
  { dayOfWeek: 5, label: "Friday" },
  { dayOfWeek: 6, label: "Saturday" },
  { dayOfWeek: 0, label: "Sunday" },
] as const;

const OPERATING_TIMEZONE_OPTIONS = [
  { label: "Central", value: "America/Chicago" },
  { label: "Eastern", value: "America/New_York" },
  { label: "Mountain", value: "America/Denver" },
  { label: "Pacific", value: "America/Los_Angeles" },
  { label: "Arizona", value: "America/Phoenix" },
  { label: "Alaska", value: "America/Anchorage" },
  { label: "Hawaii", value: "Pacific/Honolulu" },
  { label: "UTC", value: "UTC" },
] as const;

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
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold text-zinc-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
        defaultValue={defaultValue ?? ""}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}

function StatusPill({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span
      className={[
        "inline-flex min-h-7 w-fit items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset",
        className,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function SectionHeader({
  description,
  id,
  status,
  statusClass,
  title,
}: {
  description: string;
  id?: string;
  status?: string;
  statusClass?: string;
  title: string;
}) {
  return (
    <div
      className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"
      id={id}
    >
      <div>
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-500">{description}</p>
      </div>
      {status ? (
        <StatusPill
          className={statusClass ?? "bg-zinc-100 text-zinc-600 ring-zinc-200"}
          label={status}
        />
      ) : null}
    </div>
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
    avatarUrl: member.staff_profile_avatar_url,
    displayName: member.staff_profile_display_name,
    id: member.id,
    isActive: member.is_active,
    jobTitle: member.job_title,
    onlineBookingEnabled: member.online_booking_enabled,
    profileDisplayOrder: member.profile_display_order,
    salonProfileContentPostingEnabled:
      member.salon_profile_content_posting_enabled,
  }));

  return (
    <section className="scroll-mt-6" id="public-team">
      <SectionHeader
        description="Choose who appears publicly, who accepts online booking, and who can post to the salon profile."
        status={`${members.length} staff`}
        title="Public team"
      />

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
  operatingStatus,
  salonName,
}: {
  canManageSettings: boolean;
  mapLocation: SalonMapLocationState;
  operatingStatus: SalonOperatingHoursSettings["status"];
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
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : mapLocation.status === "provider_unavailable"
        ? "bg-zinc-100 text-zinc-600 ring-zinc-200"
        : "bg-amber-50 text-amber-700 ring-amber-200";

  return (
    <div className="border-t border-zinc-100 px-4 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">Map location</h3>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            {mapLocation.address.formattedAddress || "No public address yet."}
          </p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            {mapLocation.statusDescription}
          </p>
        </div>
        <StatusPill className={statusClass} label={mapLocation.statusLabel} />
      </div>

      {mapLocation.coordinates ? (
        <p className="mt-3 text-xs font-medium text-zinc-500">
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
        <p className="mt-2 text-xs font-medium text-zinc-500">
          Configure {missingConfiguration.join(" and ")} to enable geocoding
          and map tiles.
        </p>
      ) : null}
      {mapLocation.providerConfigured &&
      publicMapConfigured &&
      mapLocation.coordinates &&
      mapLocation.status === "mapped" ? (
        <div className="mt-4">
          <MapLocationPreview
            coordinates={mapLocation.coordinates}
            locationLabel={mapLocation.address.cityStateLabel || null}
            operatingStatus={operatingStatus}
            salonName={salonName}
          />
        </div>
      ) : null}
      <div className="mt-4">
        <SubmitButton pendingLabel="Processing…"
          className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canManageSettings || !mapLocation.refreshEnabled}
          formAction={refreshSalonMapLocation}
          type="submit"
        >
          Refresh map location
        </SubmitButton>
      </div>
    </div>
  );
}

function weeklyWindowByDay(weeklyHours: SalonOperatingHoursWindow[]) {
  const byDay = new Map<number, SalonOperatingHoursWindow>();

  for (const window of weeklyHours) {
    if (!byDay.has(window.dayOfWeek)) {
      byDay.set(window.dayOfWeek, window);
    }
  }

  return byDay;
}

function formatSpecialHoursDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatSpecialHoursSummary(special: SalonSpecialHours) {
  if (special.status === "closed") {
    return special.reason ? `Closed - ${special.reason}` : "Closed";
  }

  const timeRange =
    special.opensAtLocal && special.closesAtLocal
      ? `${special.opensAtLocal} - ${special.closesAtLocal}`
      : "Custom hours";

  return special.reason ? `${timeRange} - ${special.reason}` : timeRange;
}

function OperatingHoursSection({
  canManageSettings,
  operatingSettings,
}: {
  canManageSettings: boolean;
  operatingSettings: SalonOperatingHoursSettings;
}) {
  const byDay = weeklyWindowByDay(operatingSettings.weeklyHours);
  const currentTimezoneKnown = OPERATING_TIMEZONE_OPTIONS.some(
    (option) => option.value === operatingSettings.timeZone,
  );

  return (
    <section className="scroll-mt-6">
      <SectionHeader
        description="Set the customer-facing open or closed status shown on the profile, Explore, and search cards."
        id="operating-hours"
        title="Operating status"
      />
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-zinc-100 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-950">
              Customer status preview
            </h3>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Permanent closure is managed from Salon status below.
            </p>
          </div>
          <SalonOperatingStatusBadge
            className="max-w-full"
            showDetail
            status={operatingSettings.status}
          />
        </div>

        <div className="grid gap-4 px-4 py-4">
          <label className="grid gap-1.5 sm:max-w-xs">
            <span className="text-sm font-semibold text-zinc-700">
              Salon timezone
            </span>
            <select
              className="min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60"
              defaultValue={operatingSettings.timeZone}
              disabled={!canManageSettings}
              name="operating_timezone_iana"
            >
              {!currentTimezoneKnown ? (
                <option value={operatingSettings.timeZone}>
                  {operatingSettings.timeZone}
                </option>
              ) : null}
              {OPERATING_TIMEZONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.value}
                </option>
              ))}
            </select>
          </label>

          <div className="overflow-hidden rounded-lg border border-zinc-200">
            {OPERATING_WEEK_DAYS.map((day) => {
              const window = byDay.get(day.dayOfWeek);

              return (
                <div
                  className="grid gap-3 border-b border-zinc-100 px-3 py-3 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center"
                  key={day.dayOfWeek}
                >
                  <label className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-950">
                    <input
                      className="size-4 rounded border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
                      defaultChecked={Boolean(window)}
                      disabled={!canManageSettings}
                      name={`operating_day_${day.dayOfWeek}_enabled`}
                      type="checkbox"
                    />
                    <span>{day.label}</span>
                  </label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                    <input
                      aria-label={`${day.label} opening time`}
                      className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={window?.opensAtLocal ?? "09:00"}
                      disabled={!canManageSettings}
                      name={`operating_day_${day.dayOfWeek}_opens`}
                      type="time"
                    />
                    <span
                      aria-hidden
                      className="hidden text-sm font-semibold text-zinc-400 sm:block"
                    >
                      -
                    </span>
                    <input
                      aria-label={`${day.label} closing time`}
                      className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60"
                      defaultValue={window?.closesAtLocal ?? "17:00"}
                      disabled={!canManageSettings}
                      name={`operating_day_${day.dayOfWeek}_closes`}
                      type="time"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs font-medium leading-5 text-zinc-500">
            Closing after midnight is supported. Leave a day unchecked when the
            salon is closed all day.
          </p>
        </div>

        <div className="border-t border-zinc-100 px-4 py-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-950">
                Special dates
              </h3>
              <p className="mt-1 text-sm leading-6 text-zinc-500">
                Holiday closures and one-day custom hours override the weekly
                schedule.
              </p>
            </div>
            <StatusPill
              className="bg-zinc-100 text-zinc-600 ring-zinc-200"
              label={`${operatingSettings.specialHours.length} active`}
            />
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200">
            {operatingSettings.specialHours.length > 0 ? (
              operatingSettings.specialHours.map((special) => (
                <div
                  className="flex min-h-14 flex-col gap-2 border-b border-zinc-100 px-3 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                  key={special.id}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-950">
                      {formatSpecialHoursDate(special.localDate)}
                    </p>
                    <p className="mt-0.5 truncate text-xs font-medium text-zinc-500">
                      {formatSpecialHoursSummary(special)}
                    </p>
                  </div>
                  <SubmitButton pendingLabel="Removing…"
                    className="w-fit rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canManageSettings}
                    formAction={deleteCurrentSalonSpecialHoursAction}
                    name="special_hours_id"
                    type="submit"
                    value={special.id}
                  >
                    Remove
                  </SubmitButton>
                </div>
              ))
            ) : (
              <p className="px-3 py-4 text-sm text-zinc-500">
                No special dates are scheduled.
              </p>
            )}
          </div>

          <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.35fr)_auto] lg:items-end">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-zinc-600">Date</span>
              <input
                className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canManageSettings}
                name="special_local_date"
                type="date"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-zinc-600">
                Override
              </span>
              <select
                className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60"
                defaultValue="closed"
                disabled={!canManageSettings}
                name="special_status"
              >
                <option value="closed">Closed all day</option>
                <option value="custom_hours">Custom hours</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-zinc-600">Open</span>
              <input
                className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60"
                defaultValue="09:00"
                disabled={!canManageSettings}
                name="special_opens_at_local"
                type="time"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-zinc-600">
                Close / reason
              </span>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  aria-label="Special date closing time"
                  className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60"
                  defaultValue="17:00"
                  disabled={!canManageSettings}
                  name="special_closes_at_local"
                  type="time"
                />
                <input
                  aria-label="Special date reason"
                  className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!canManageSettings}
                  name="special_reason"
                  placeholder="Holiday"
                  type="text"
                />
              </div>
            </label>
            <SubmitButton pendingLabel="Saving…"
              className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canManageSettings}
              formAction={createCurrentSalonSpecialHoursAction}
              type="submit"
            >
              Add
            </SubmitButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function SalonSettingsForm({
  canManageSettings,
  discoveryReadiness,
  error,
  mapLocation,
  notice,
  operatingSettings,
  setting,
}: {
  canManageSettings: boolean;
  discoveryReadiness: SalonDiscoveryReadiness;
  error?: string;
  mapLocation: SalonMapLocationState;
  notice?: string;
  operatingSettings: SalonOperatingHoursSettings;
  setting: SalonSetting;
}) {
  const canToggleDiscovery =
    canManageSettings &&
    (discoveryReadiness.canEnable || setting.public_discovery_enabled);
  const discoveryStatus =
    setting.public_discovery_enabled && discoveryReadiness.canEnable
      ? "Published"
      : discoveryReadiness.canEnable
        ? "Ready"
        : "Missing info";
  const discoveryStatusClass =
    setting.public_discovery_enabled && discoveryReadiness.canEnable
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : discoveryReadiness.canEnable
        ? "bg-sky-50 text-sky-700 ring-sky-200"
        : "bg-amber-50 text-amber-700 ring-amber-200";

  return (
    <form
      action={canManageSettings ? updateSalonSettings : undefined}
      className="grid gap-5"
    >
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {notice}
        </p>
      ) : null}

      {!canManageSettings ? (
        <p className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
          You do not have permission to manage salon settings.
        </p>
      ) : null}

      <section className="scroll-mt-6">
        <SectionHeader
          description="Core business details customers and staff see across booking, receipts, and public pages."
          id="business-information"
          title="Business info"
        />
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                autoComplete="organization-title"
                defaultValue={setting.business_name}
                label="Business name"
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
              label="Address line 1"
              name="address_line1"
            />
            <Field
              autoComplete="address-line2"
              defaultValue={setting.address_line2}
              label="Address line 2"
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
              label="Postal code"
              name="postal_code"
            />
            <Field
              autoComplete="country-name"
              defaultValue={setting.country}
              label="Country"
              name="country"
            />
            <label className="grid gap-1.5 sm:col-span-2">
              <span className="text-sm font-semibold text-zinc-700">
                Business description
              </span>
              <textarea
                className="min-h-28 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                defaultValue={setting.business_description ?? ""}
                name="business_description"
              />
            </label>
          </div>
        </div>
      </section>

      <section className="scroll-mt-6">
        <SectionHeader
          description="Publish the salon on Explore, keep map details accurate, and control staff application visibility."
          id="public-profile-discovery"
          status={discoveryStatus}
          statusClass={discoveryStatusClass}
          title="Public profile & discovery"
        />
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <label className="flex items-start gap-3 px-4 py-4 text-sm">
            <input
              className="mt-1 size-4 rounded border-zinc-300 disabled:cursor-not-allowed disabled:opacity-60"
              defaultChecked={setting.public_discovery_enabled}
              disabled={!canToggleDiscovery}
              name="public_discovery_enabled"
              type="checkbox"
            />
            <span>
              <span className="block font-semibold text-zinc-950">
                Show salon on Explore
              </span>
              <span className="mt-1 block leading-6 text-zinc-600">
                Requires active location details, a public description, and at
                least one active service.
              </span>
            </span>
          </label>

          <div className="border-t border-zinc-100 px-4 py-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-950">
                  Readiness checklist
                </h3>
                <p className="mt-1 text-sm leading-6 text-zinc-500">
                  Fix missing items directly from each row.
                </p>
              </div>
              {!discoveryReadiness.canEnable ? (
                <span className="text-xs font-semibold text-amber-700">
                  Complete missing rows to publish
                </span>
              ) : null}
            </div>
            <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200">
              {discoveryReadiness.items.map((item) => (
                <div
                  className="flex min-h-14 items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2 last:border-b-0"
                  key={item.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-950">
                      {item.label}
                    </p>
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
                        className="shrink-0 text-sm font-semibold text-zinc-950 underline-offset-4 hover:underline"
                        href={item.href}
                      >
                        Update
                      </a>
                    ) : (
                      <Link
                        className="shrink-0 text-sm font-semibold text-zinc-950 underline-offset-4 hover:underline"
                        href={item.href}
                      >
                        Open
                      </Link>
                    )
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <MapLocationSection
            canManageSettings={canManageSettings}
            mapLocation={mapLocation}
            operatingStatus={operatingSettings.status}
            salonName={setting.business_name}
          />

          <label className="flex items-start gap-3 border-t border-zinc-100 px-4 py-4 text-sm">
            <input
              className="mt-1 size-4 rounded border-zinc-300"
              defaultChecked={setting.allow_staff_applications}
              disabled={!canManageSettings}
              name="allow_staff_applications"
              type="checkbox"
            />
            <span>
              <span className="block font-semibold text-zinc-950">
                Allow staff applications
              </span>
              <span className="mt-1 block leading-6 text-zinc-600">
                Show this active salon in staff application search.
              </span>
            </span>
          </label>
        </div>
      </section>

      <OperatingHoursSection
        canManageSettings={canManageSettings}
        operatingSettings={operatingSettings}
      />

      <div className="sticky bottom-0 z-20 rounded-lg border border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-10px_30px_rgba(24,24,27,.08)] backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zinc-600">
            Saves only changed salon details and operating hours.
          </p>
          <SubmitButton pendingLabel="Saving…"
            className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            disabled={!canManageSettings}
            type="submit"
          >
            Save settings
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

export default async function SalonSettingsPage({
  searchParams,
}: SalonSettingsPageProps) {
  const [
    {
      error,
      lifecycle_error: lifecycleError,
      notice,
      operating_notice: operatingNotice,
    },
    context,
  ] =
    await Promise.all([
      searchParams,
      requireSalonManagePageContext("/salon-settings"),
    ]);

  const canViewSettings = await hasPermission("salon_settings.view", context);

  if (!canViewSettings) {
    return (
      <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
          You do not have permission to view salon settings.
        </div>
      </main>
    );
  }

  const [
    { setting },
    canManageSettings,
    canViewStaff,
    lifecycle,
    operatingSettings,
  ] =
    await Promise.all([
      getCurrentSalonSetting(),
      hasPermission("salon_settings.manage", context),
      hasPermission("staff.view", context),
      getSalonLifecycle(context.currentSalon.id),
      getCurrentSalonOperatingHoursSettings(context),
    ]);

  if (!setting || !lifecycle) {
    throw new Error("Salon settings could not be loaded.");
  }

  const canManageLifecycle =
    canManageSettings &&
    lifecycle.lifecycleStatus !== "permanently_closed" &&
    (isOwnerMembership(context.currentMembership) ||
      context.permissionCodes.includes("account.manage"));
  const canManageOwnership =
    canManageSettings &&
    (isOwnerMembership(context.currentMembership) ||
      context.permissionCodes.includes("account.manage"));
  const [discoveryReadiness,mapLocation,staffDirectory,ownerRoster,closureReview] = await Promise.all([
    getCurrentSalonDiscoveryReadiness(setting,context),
    getCurrentSalonMapLocationState({context,setting}),
    canViewStaff ? getCurrentSalonStaffDirectory(context) : Promise.resolve({staff:[] as StaffDirectoryMember[]}),
    isOwnerMembership(context.currentMembership) ? getSalonOwnerRoster(context.currentSalon.id) : Promise.resolve(null),
    canManageLifecycle ? getSalonClosureReview({context,salonId:context.currentSalon.id}) : Promise.resolve(null),
  ]);

  const navItems: NavItem[] = [
    { href: "#business-information", label: "Business info" },
    { href: "#public-profile-discovery", label: "Public profile" },
    { href: "#operating-hours", label: "Operating status" },
    ...(isOwnerMembership(context.currentMembership) ? [{ href: "#staff-appointment-permission", label: "Staff appointments" }] : []),
    { href: "#ownership-admins", label: "Ownership" },
    { href: "#salon-status", label: "Salon status", tone: "danger" },
    ...(canViewStaff ? [{ href: "#public-team", label: "Public team" }] : []),
  ];

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="h-fit rounded-lg border border-border-subtle bg-white p-3 lg:sticky lg:top-5">
          <div className="border-b border-zinc-100 px-2 pb-3">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Salon settings
            </p>
            <h1 className="mt-1 truncate text-lg font-semibold text-zinc-950">
              {setting.business_name}
            </h1>
            <p className="mt-1 truncate text-sm text-zinc-500">
              {context.currentWorkspace?.label ?? "Current salon"}
            </p>
          </div>
          <nav aria-label="Salon settings sections" className="mt-3 grid gap-1">
            {navItems.map((item) => (
              <a
                className={[
                  "flex min-h-10 items-center rounded-md px-2.5 py-2 text-sm font-semibold transition hover:bg-zinc-100",
                  item.tone === "danger" ? "text-red-700" : "text-zinc-700",
                ].join(" ")}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <Link
            className="mt-3 flex min-h-10 items-center rounded-md border border-zinc-200 px-2.5 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
            href="/settings"
          >
            All settings
          </Link>
        </aside>

        <div className="grid gap-5">
          <header className="rounded-lg border border-border-subtle bg-white px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase text-zinc-500">
                  Salon controls
                </p>
                <h2 className="mt-1 text-2xl font-semibold tracking-normal text-zinc-950">
                  Salon settings
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                  Business details, public visibility, ownership, salon
                  lifecycle, and staff profile controls in one compact workflow.
                </p>
              </div>
              <StatusPill
                className="bg-zinc-100 text-zinc-700 ring-zinc-200"
                label={lifecycle.lifecycleStatus.replace("_", " ")}
              />
            </div>
          </header>

          <SalonSettingsForm
            canManageSettings={canManageSettings}
            discoveryReadiness={discoveryReadiness}
            error={error}
            mapLocation={mapLocation}
            notice={operatingNotice}
            operatingSettings={operatingSettings}
            setting={setting}
          />

          {isOwnerMembership(context.currentMembership) ? <StaffCreationPermission salonId={context.currentSalon.id} /> : null}
          <SalonOwnershipSection
            canManageOwnership={canManageOwnership}
            ownerRoster={ownerRoster}
            permissionsHref="/permissions"
            rolesHref="/roles"
            salon={{
              id: context.currentSalon.id,
              name: setting.business_name,
            }}
          />

          <SalonLifecycleSection
            canManageLifecycle={canManageLifecycle}
            closureReview={closureReview}
            error={lifecycleError}
            notice={notice}
            salon={{
              closedAt: lifecycle.closed_at,
              disabledAt: lifecycle.disabled_at,
              lifecycleStatus: lifecycle.lifecycleStatus,
              name: lifecycle.name,
              status: lifecycle.status,
            }}
          />

          {canViewStaff ? (
            <PublicTeamSettingsSection
              canManageSettings={canManageSettings}
              staff={staffDirectory.staff}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}
