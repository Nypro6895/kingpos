import { OwnerPosTabs } from "@/app/pos/owner-pos-tabs";
import { SettingsGroupForm } from "@/app/pos/settings/settings-group-form";
import { normalizeWorkspacePreferences } from "@/lib/pos-workspace-preferences";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { DesktopDownloadPanel } from "@/app/pos/settings/desktop-download-panel";
/* eslint-disable @next/next/no-img-element */
import { CustomerDisplayInstallPanel } from "@/app/pos/settings/customer-display-install-panel";
import {
  createPortablePosAccessAction,
  updatePortablePosAccessCapabilitiesAction,
  updatePortablePosAccessStatusAction,
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
    <label className="settings-toggle">
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
    <label className="settings-toggle">
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
        <span className="settings-capability-help">
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
    <div className="settings-image">
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
        <div className="mt-2 overflow-hidden rounded-md bg-zinc-50">
          <div className="px-2 py-1 text-xs text-zinc-500">
            {currentUrl ? "Current custom image" : "Default image"}
          </div>
          <img
            alt=""
            className="h-20 w-full bg-white object-contain"
            src={previewUrl}
          />
        </div>
      ) : null}
      {currentPath ? (
        <label className="mt-3 flex items-center gap-2 text-sm text-zinc-600">
          <input name={`remove_${name}`} type="checkbox" />
          Use default image
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

function OwnerPosMenu() { return <OwnerPosTabs active="settings"/>; }

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
    <section className="settings-section-body" id="portable-access">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">
          Staff access
        </h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600">
          Staff sign in with a POS ID, without your Owner account.
        </p>
      </div>

      <form
        action={createPortablePosAccessAction}
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
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
        <details className="settings-permissions sm:col-span-4"><summary>Allowed actions</summary><CapabilityGrid /></details>
      </form>

      <div className="mt-4 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-950">
              Devices
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Disable an ID to stop new access.
            </p>
          </div>

        </div>

        {accessKeys.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-5 text-sm text-zinc-600">
            No POS IDs yet.
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
                      {key.label || "Unnamed device"}
                    </p>
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
                  <details className="settings-permissions lg:col-span-3"><summary>Edit permissions</summary>
                  <form
                    action={updatePortablePosAccessCapabilitiesAction}
                    className="grid gap-3 pt-3"
                  >
                    <input name="key_id" type="hidden" value={key.id} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-zinc-950">
                        Permissions
                      </p>
                      <SettingsSubmitButton
                        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!canCreateAccess}
                        saved={saved === `portable-capabilities-${key.id}`}
                      >
                        Save permissions
                      </SettingsSubmitButton>
                    </div>
                    <CapabilityGrid capabilities={key.capabilities} />
                  </form>
                  </details>
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
  settings, snapshot,
}: {
  settings: PosSettingsView; snapshot: Record<string, unknown>;
}) {
  return (
    <section className="settings-section-body">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">
          Appearance
        </h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600">
          Customize what customers see.
        </p>
      </div>

      <SettingsGroupForm group="display" snapshot={snapshot}>
        <div className="grid gap-3 sm:grid-cols-2">
          <ImageUploadField
            currentPath={settings.customerBackgroundImagePath}
            currentUrl={settings.customerBackgroundImageUrl}
            description="Checkout and thank-you screens."
            fallbackUrl={DEFAULT_CUSTOMER_DISPLAY_RECEIPT_BACKGROUND_URL}
            label="Receipt background image"
            name="customer_background_image"
          />
          <ImageUploadField
            currentPath={settings.customerLeftAdImagePath}
            currentUrl={settings.customerLeftAdImageUrl}
            description="Shown while the display is idle."
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
            label="Customer app link (QR code)"
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

      </SettingsGroupForm>
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

  const supabase=await createAuthenticatedSupabaseServerClient();
  const {data:raw}=await supabase!.from('pos_settings').select('*').eq('salon_id',context.currentSalon!.id).maybeSingle();
  const snapshot=raw??{};
  const preferences=normalizeWorkspacePreferences(raw?.workspace_preferences);
  return (
    <main className="pos-settings mx-auto w-full max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
      <SettingsSaveBroadcast saved={saved} />
      <div className="settings-heading"><div><h1>POS settings</h1><p>Checkout, staff and devices</p></div><OwnerPosMenu /></div>

      {error ? (
        <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}


<div className="settings-sections">
        <details open><summary>Windows app &amp; devices</summary><DesktopDownloadPanel/></details>
        <details id="access"><summary>POS login &amp; permissions</summary><PortableAccessSection accessKeys={portableAccessState.keys} canManageSettings={canManageSettings} saved={saved} schemaReady={portableAccessState.schemaReady} setupMessage={portableAccessState.setupMessage}/></details>
        <details><summary>Staff &amp; turns</summary><SettingsGroupForm group="staff" snapshot={snapshot}>
          <Checkbox defaultChecked={settings.staffCheckInEnabled} label="Require staff check-in" name="staff_check_in_enabled"/>
          <Field defaultValue={settings.largeTurnThreshold} label="Large turn amount" min={1} step="0.01" type="number" name="large_turn_threshold"/>
          <p className="text-sm leading-6 text-zinc-500">Staff check in each day. Late arrivals and returning staff follow your turn rules.</p>
        </SettingsGroupForm></details>
        <details><summary>Checkout &amp; saved tickets</summary><SettingsGroupForm group="checkout" snapshot={snapshot}>
          <p className="text-sm font-semibold">Checkout options</p><div className="grid gap-2 sm:grid-cols-2">{([['showStaff','Staff'],['showServices','Services'],['showCustomer','Customer'],['showTip','Tip'],['showDiscount','Discount']] as const).map(([key,label])=><Checkbox key={key} name={key} label={label} defaultChecked={preferences[key]}/>)}</div>
          <p className="text-sm text-zinc-500">Staff is required when check-in is on.</p>
          <div className="grid gap-3 sm:grid-cols-4">{settings.tipSuggestions.map((amount,index)=><Field key={index} name={`tip_suggestion_${index+1}`} label={`Tip option ${index+1}`} defaultValue={amount} min={0} type="number" step="0.01"/>)}</div>
          <Checkbox defaultChecked={settings.touchKeyboardEnabled} label="Portable on-screen keyboard" name="touch_keyboard_enabled"/>
          <div className="grid gap-3 sm:grid-cols-2"><Field name="idleMinutes" label="Idle reminder (minutes)" defaultValue={preferences.idleMinutes} min={1} type="number"/><Field name="idleWarningSeconds" label="Response time (seconds)" defaultValue={preferences.idleWarningSeconds} min={15} type="number"/></div>
          <p className="text-sm text-zinc-500">Unfinished entries clear after the countdown. Saved and submitted tickets stay.</p>
        </SettingsGroupForm></details>
        <details><summary>Customer Display</summary><CustomerDisplayInstallPanel activeAccessKeyCount={portableAccessState.keys.filter(key=>key.is_active).length} displayPath="/pos/customer-display" schemaReady={portableAccessState.schemaReady} setupPath="/pos/customer-display/setup"/><CustomerDisplaySettingsSection settings={settings} snapshot={snapshot}/></details>
        <details><summary>Data &amp; sync</summary><div className="mt-3 space-y-3 text-sm leading-6 text-zinc-600"><p>Tickets save on the device and upload when connected. Check the sync icon for progress.</p><p>Reports update after each device reconnects.</p><p>Closing the app keeps saved tickets. Do not clear app or browser data before upload finishes.</p>{portableAccessState.keys.map(key=><div key={key.id} className="flex justify-between gap-4 border-t py-3"><strong>{key.label||key.access_id}</strong><span>Last contact: {formatAccessDate(key.last_used_at)}</span></div>)}</div></details>
      </div>
    </main>
  );
}
