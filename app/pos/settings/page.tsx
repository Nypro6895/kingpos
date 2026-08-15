import Link from "next/link";
/* eslint-disable @next/next/no-img-element */
import { CustomerDisplayInstallPanel } from "@/app/pos/settings/customer-display-install-panel";
import {
  createPortablePosAccessAction,
  updatePortablePosAccessCapabilitiesAction,
  updatePortablePosAccessStatusAction,
  updatePosSettingsAction,
} from "@/app/pos/settings/actions";
import { SettingsSaveBroadcast } from "@/app/pos/settings/settings-save-broadcast";
import { SettingsSubmitButton } from "@/app/pos/settings/settings-submit-button";
import { hasPermission } from "@/lib/permissions";
import {
  getCurrentSalonPortablePosAccessState,
  type PortablePosAccessKey,
} from "@/lib/pos-portable-access";
import {
  DEFAULT_CUSTOMER_DISPLAY_PROMO_SLIDE_URL,
  DEFAULT_CUSTOMER_DISPLAY_RECEIPT_BACKGROUND_URL,
} from "@/lib/pos-display-default-assets";
import {
  PORTABLE_POS_CAPABILITY_OPTIONS,
  type PortablePosCapability,
} from "@/lib/pos-portable-capabilities";
import { getCurrentSalonPosSettings, type PosSettingsView } from "@/lib/pos-settings";
import { POS_TICKET_PERMISSIONS } from "@/lib/pos-tickets";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";

type PosSettingsPageProps = {
  searchParams: Promise<{
    error?: string;
    saved?: string;
  }>;
};

function Field({
  autoComplete,
  defaultValue,
  label,
  min,
  name,
  required = false,
  step,
  type = "text",
}: {
  autoComplete?: string;
  defaultValue?: number | string | null;
  label: string;
  min?: number;
  name: string;
  required?: boolean;
  step?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
        defaultValue={defaultValue ?? ""}
        min={min}
        name={name}
        required={required}
        step={step}
        type={type}
      />
    </label>
  );
}

function TextArea({
  defaultValue,
  label,
  name,
  rows = 3,
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <textarea
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
        defaultValue={defaultValue ?? ""}
        name={name}
        rows={rows}
      />
    </label>
  );
}

function Checkbox({
  defaultChecked,
  label,
  name,
}: {
  defaultChecked: boolean;
  label: string;
  name: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-md border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-700">
      <input
        className="mt-1 h-4 w-4 rounded border-zinc-300"
        defaultChecked={defaultChecked}
        name={name}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function CapabilityCheckbox({
  defaultChecked,
  option,
}: {
  defaultChecked: boolean;
  option: (typeof PORTABLE_POS_CAPABILITY_OPTIONS)[number];
}) {
  return (
    <label className="flex min-h-20 items-start gap-3 rounded-md border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-700">
      <input
        className="mt-1 h-4 w-4 rounded border-zinc-300"
        defaultChecked={defaultChecked}
        name="capabilities"
        type="checkbox"
        value={option.value}
      />
      <span>
        <span className="block font-semibold text-zinc-950">
          {option.label}
        </span>
        <span className="mt-1 block text-xs leading-5 text-zinc-500">
          {option.description}
        </span>
      </span>
    </label>
  );
}

function CapabilityGrid({
  capabilities,
}: {
  capabilities?: PortablePosCapability[];
}) {
  const selected = new Set(capabilities);

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {PORTABLE_POS_CAPABILITY_OPTIONS.map((option) => (
        <CapabilityCheckbox
          defaultChecked={
            capabilities
              ? selected.has(option.value)
              : option.defaultEnabled
          }
          key={option.value}
          option={option}
        />
      ))}
    </div>
  );
}

function ImageUploadField({
  currentPath,
  currentUrl,
  description,
  fallbackUrl,
  label,
  name,
}: {
  currentPath: string | null;
  currentUrl: string | null;
  description?: string;
  fallbackUrl?: string;
  label: string;
  name: string;
}) {
  const previewUrl = currentUrl ?? fallbackUrl;

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">{label}</span>
        <input
          accept="image/jpeg,image/png,image/webp"
          className="mt-2 block w-full text-sm text-zinc-700 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-950 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
          name={`${name}_file`}
          type="file"
        />
      </label>
      {description ? (
        <p className="mt-2 text-xs leading-5 text-zinc-500">{description}</p>
      ) : null}
      <input name={`current_${name}_path`} type="hidden" value={currentPath ?? ""} />
      {previewUrl ? (
        <div className="mt-3 overflow-hidden rounded-md border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-500">
            {currentUrl ? "Current custom image" : "Default image"}
          </div>
          <img
            alt=""
            className="h-32 w-full bg-white object-contain"
            src={previewUrl}
          />
        </div>
      ) : null}
      {currentPath ? (
        <label className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
          <input name={`remove_${name}`} type="checkbox" />
          Remove custom image and use default
        </label>
      ) : null}
    </div>
  );
}

function formatAccessDate(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getAccessSessionState(key: PortablePosAccessKey) {
  if (!key.last_login_at) {
    return {
      label: "Never logged in",
      tone: "border-zinc-200 bg-zinc-50 text-zinc-600",
    };
  }

  const loginTime = new Date(key.last_login_at).getTime();
  const logoutTime = key.last_logout_at
    ? new Date(key.last_logout_at).getTime()
    : 0;

  if (loginTime > logoutTime) {
    return {
      label: "Logged in",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    };
  }

  return {
    label: "Logged out",
    tone: "border-zinc-200 bg-zinc-50 text-zinc-600",
  };
}

function OwnerPosMenu() {
  return (
    <nav
      aria-label="Owner POS tools"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm"
    >
      <Link
        className="rounded-md border border-zinc-300 px-3 py-2 font-semibold text-zinc-800 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
        href="/pos"
      >
        POS
      </Link>
      <Link
        className="rounded-md border border-zinc-300 px-3 py-2 font-semibold text-zinc-800 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
        href="/pos/portable"
      >
        Portable POS
      </Link>
      <Link
        className="rounded-md border border-zinc-300 px-3 py-2 font-semibold text-zinc-800 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
        href="/pos/customer-display"
      >
        Customer POS
      </Link>
      <span className="rounded-md bg-zinc-950 px-3 py-2 font-semibold text-white">
        POS Setting
      </span>
    </nav>
  );
}

function PortableAccessSection({
  accessKeys,
  canManageSettings,
  saved,
  schemaReady,
  setupMessage,
}: {
  accessKeys: PortablePosAccessKey[];
  canManageSettings: boolean;
  saved?: string;
  schemaReady: boolean;
  setupMessage: string | null;
}) {
  const canCreateAccess = canManageSettings && schemaReady;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5" id="portable-access">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">
          Portable POS Access
        </h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600">
          Create standalone POS IDs and track which device or station last logged in.
        </p>
      </div>

      <form
        action={createPortablePosAccessAction}
        className="mt-4 grid gap-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
      >
        {setupMessage ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 sm:col-span-4">
            {setupMessage}
          </p>
        ) : null}
        <Field autoComplete="off" label="POS ID" name="access_id" required />
        <Field
          autoComplete="new-password"
          label="Passcode"
          name="passcode"
          required
          type="password"
        />
        <Field autoComplete="off" label="Device / position" name="label" />
        <SettingsSubmitButton
          className="min-h-11 rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
          disabled={!canCreateAccess}
          saved={saved === "portable-create"}
        >
          Create
        </SettingsSubmitButton>
        <div className="grid gap-2 sm:col-span-4">
          <p className="text-sm font-semibold text-zinc-950">
            Default device capabilities
          </p>
          <CapabilityGrid />
        </div>
      </form>

      <div className="mt-4 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-950">
              Portable POS IDs
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Disable an ID to revoke portable access immediately.
            </p>
          </div>
          <Link
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50"
            href="/pos/portable"
          >
            Open Portable POS
          </Link>
        </div>

        {accessKeys.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-5 text-sm text-zinc-600">
            No Portable POS ID has been created yet.
          </p>
        ) : (
          <div className="grid gap-2">
            {accessKeys.map((key) => {
              const sessionState = getAccessSessionState(key);

              return (
                <article
                  className="grid gap-3 rounded-md border border-zinc-200 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,auto)_auto] lg:items-center"
                  key={key.id}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-zinc-950">
                        {key.access_id}
                      </p>
                      <span
                        className={[
                          "rounded-md border px-2 py-0.5 text-xs font-semibold",
                          key.is_active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-zinc-200 bg-zinc-50 text-zinc-600",
                        ].join(" ")}
                      >
                        {key.is_active ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-zinc-600">
                      {key.label || "No device / position label"}
                    </p>
                    {key.last_user_agent ? (
                      <p className="mt-1 truncate text-xs text-zinc-500">
                        {key.last_user_agent}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-1 text-xs text-zinc-500">
                    <span
                      className={[
                        "w-fit rounded-md border px-2 py-0.5 font-semibold",
                        sessionState.tone,
                      ].join(" ")}
                    >
                      {sessionState.label}
                    </span>
                    <span>Login: {formatAccessDate(key.last_login_at)}</span>
                    <span>Logout: {formatAccessDate(key.last_logout_at)}</span>
                  </div>
                  <form action={updatePortablePosAccessStatusAction}>
                    <input name="key_id" type="hidden" value={key.id} />
                    <input
                      name="next_active"
                      type="hidden"
                      value={key.is_active ? "false" : "true"}
                    />
                    <SettingsSubmitButton
                      className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={!canCreateAccess}
                      saved={saved === `portable-status-${key.id}`}
                    >
                      {key.is_active ? "Disable" : "Enable"}
                    </SettingsSubmitButton>
                  </form>
                  <form
                    action={updatePortablePosAccessCapabilitiesAction}
                    className="grid gap-3 rounded-md bg-zinc-50 p-3 lg:col-span-3"
                  >
                    <input name="key_id" type="hidden" value={key.id} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-zinc-950">
                        Device capabilities
                      </p>
                      <SettingsSubmitButton
                        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!canCreateAccess}
                        saved={saved === `portable-capabilities-${key.id}`}
                      >
                        Save capabilities
                      </SettingsSubmitButton>
                    </div>
                    <CapabilityGrid capabilities={key.capabilities} />
                  </form>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function CustomerDisplaySettingsSection({
  canManageSettings,
  saved,
  settings,
}: {
  canManageSettings: boolean;
  saved?: boolean;
  settings: PosSettingsView;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">
          Customer POS Display
        </h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600">
          Configure the full-screen customer display, ads, barcode, and tip options.
        </p>
      </div>

      <form
        action={updatePosSettingsAction}
        className="mt-4 grid gap-6"
      >
        <div className="grid gap-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 md:grid-cols-5">
          <Field
            defaultValue={settings.largeTurnThreshold}
            label="Large turn amount"
            min={1}
            name="large_turn_threshold"
            step="0.01"
            type="number"
          />
          {settings.tipSuggestions.map((amount, index) => (
            <Field
              defaultValue={amount}
              key={index}
              label={`Tip option ${index + 1}`}
              min={0}
              name={`tip_suggestion_${index + 1}`}
              step="0.01"
              type="number"
            />
          ))}
        </div>

        <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <Checkbox
              defaultChecked={settings.staffCheckInEnabled}
              label="Enable staff check-in"
              name="staff_check_in_enabled"
            />
            <SettingsSubmitButton
              className="min-h-11 rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canManageSettings}
              saved={saved}
            >
              Save staff check-in
            </SettingsSubmitButton>
          </div>
          <p className="text-sm leading-6 text-amber-900">
            When enabled, Portable POS only shows staff who are checked in and
            working for the current salon day. Turning this on mid-day can hide
            staff from new assignments until they check in; existing receipt
            lines and totals are not recalculated.
          </p>
        </div>

        <div className="grid gap-4 rounded-md border border-zinc-200 bg-zinc-50 p-4 lg:grid-cols-2">
          <ImageUploadField
            currentPath={settings.customerBackgroundImagePath}
            currentUrl={settings.customerBackgroundImageUrl}
            description="Used behind the receipt, phone, tip, and thank-you screens. Removing a custom image restores the light salon default."
            fallbackUrl={DEFAULT_CUSTOMER_DISPLAY_RECEIPT_BACKGROUND_URL}
            label="Receipt background image"
            name="customer_background_image"
          />
          <ImageUploadField
            currentPath={settings.customerLeftAdImagePath}
            currentUrl={settings.customerLeftAdImageUrl}
            description="Used on the idle slideshow. Removing a custom image restores the default Reylumi app promo."
            fallbackUrl={DEFAULT_CUSTOMER_DISPLAY_PROMO_SLIDE_URL}
            label="Reylumi promotional slide"
            name="customer_left_ad_image"
          />
          <input
            name="current_customer_right_ad_image_path"
            type="hidden"
            value={settings.customerRightAdImagePath ?? ""}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Field
            defaultValue={settings.customerPromoTitle}
            label="Welcome headline"
            name="customer_promo_title"
          />
          <Field
            defaultValue={settings.appDownloadUrl}
            label="App download URL"
            name="app_download_url"
          />
          <TextArea
            defaultValue={settings.customerPromoBody}
            label="Welcome subtitle"
            name="customer_promo_body"
          />
          <TextArea
            defaultValue={settings.customerLeftAdText}
            label="Promo headline"
            name="customer_left_ad_text"
          />
          <TextArea
            defaultValue={settings.customerRightAdText}
            label="Promo feature text"
            name="customer_right_ad_text"
            rows={4}
          />
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <Checkbox
            defaultChecked={settings.customerShowSalonName}
            label="Show salon name"
            name="customer_show_salon_name"
          />
          <Checkbox
            defaultChecked={settings.customerShowCustomerName}
            label="Show customer name"
            name="customer_show_customer_name"
          />
          <Checkbox
            defaultChecked={settings.customerShowReceiptStatus}
            label="Show receipt status"
            name="customer_show_receipt_status"
          />
          <Checkbox
            defaultChecked={settings.customerShowServiceName}
            label="Show service names"
            name="customer_show_service_name"
          />
          <Checkbox
            defaultChecked={settings.customerShowStaffName}
            label="Show staff names"
            name="customer_show_staff_name"
          />
          <Checkbox
            defaultChecked={settings.customerShowBarcode}
            label="Show Reylumi barcode"
            name="customer_show_barcode"
          />
        </div>

        <div className="flex justify-end">
          <SettingsSubmitButton
            className="min-h-11 rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            disabled={!canManageSettings}
            saved={saved}
          >
            Save POS Settings
          </SettingsSubmitButton>
        </div>
      </form>
    </section>
  );
}

export default async function PosSettingsPage({
  searchParams,
}: PosSettingsPageProps) {
  const [{ error, saved }, context] = await Promise.all([
    searchParams,
    requireSalonManagePageContext("/pos/settings"),
  ]);
  const canManageSettings = await hasPermission(
    POS_TICKET_PERMISSIONS.manage,
    context,
  );

  if (!canManageSettings) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <OwnerPosMenu />
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to manage POS settings.
        </p>
      </main>
    );
  }

  const [portableAccessState, settings] = await Promise.all([
    getCurrentSalonPortablePosAccessState(context),
    getCurrentSalonPosSettings(context),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <SettingsSaveBroadcast saved={saved} />
      <OwnerPosMenu />

      {error ? (
        <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6">
        <PortableAccessSection
          accessKeys={portableAccessState.keys}
          canManageSettings={canManageSettings}
          saved={saved}
          schemaReady={portableAccessState.schemaReady}
          setupMessage={portableAccessState.setupMessage}
        />
        <CustomerDisplayInstallPanel
          activeAccessKeyCount={
            portableAccessState.keys.filter((key) => key.is_active).length
          }
          displayPath="/pos/customer-display"
          schemaReady={portableAccessState.schemaReady}
          setupPath="/pos/customer-display/setup"
        />
        <CustomerDisplaySettingsSection
          canManageSettings={canManageSettings}
          saved={saved === "pos-settings"}
          settings={settings}
        />
      </div>
    </main>
  );
}
