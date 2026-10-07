"use client";
import { WindowsPosDownloadLinks } from "@/components/windows-pos-download";
import { parseLoginUserAgent } from "@/lib/account-security-shared";
import { SettingsGroupForm } from "@/app/pos/settings/settings-group-form";
import { normalizeWorkspacePreferences } from "@/lib/pos-workspace-preferences";
import { PORTABLE_POS_CAPABILITY_OPTIONS } from "@/lib/pos-portable-capabilities";
import {
  saveDirectPosGroup,
  saveDirectPortableAccess,
} from "./direct-pos-actions";
import {
  Field,
  Check,
  InlineForm,
  inputClass,
  type DirectData,
} from "./direct-settings-ui";

export function PosSettingsPanel({
  data,
  onSaved,
}: {
  data: Extract<DirectData, { kind: "pos-display" }>;
  onSaved: () => Promise<void>;
}) {
  const v = data.view,
    p = normalizeWorkspacePreferences(data.snapshot.workspace_preferences);
  if (!data.canManage)
    return (
      <p className="text-sm text-zinc-500">
        You do not have permission to change POS settings.
      </p>
    );
  const save = (form: FormData) => saveDirectPosGroup(data.salonId, form);
  return (
    <div className="grid gap-4">
      <details open>
        <summary className="cursor-pointer font-semibold">
          Staff check-in & turns
        </summary>
        <SettingsGroupForm
          group="staff"
          snapshot={data.snapshot}
          saveAction={save}
        >
          <Check
            name="staff_check_in_enabled"
            label="Enable staff check-in"
            checked={v.staffCheckInEnabled}
          />
          <Field
            name="large_turn_threshold"
            label="Large turn threshold ($)"
            type="number"
            min={1}
            value={v.largeTurnThreshold}
            required
          />
        </SettingsGroupForm>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">
          Checkout & workspace
        </summary>
        <SettingsGroupForm
          group="checkout"
          snapshot={data.snapshot}
          saveAction={save}
        >
          <div className="grid grid-cols-2 gap-3">
            {v.tipSuggestions.map((tip, i) => (
              <Field
                key={i}
                name={`tip_suggestion_${i + 1}`}
                label={`Tip suggestion ${i + 1} (%)`}
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={tip}
              />
            ))}
          </div>
          <Check
            name="touch_keyboard_enabled"
            label="Enable touch keyboard"
            checked={v.touchKeyboardEnabled}
          />
          {(
            [
              ["showStaff", "Show staff"],
              ["showServices", "Show services"],
              ["showCustomer", "Show customer"],
              ["showTip", "Show tips"],
              ["showDiscount", "Show discounts"],
            ] as const
          ).map(([name, label]) => (
            <Check key={name} name={name} label={label} checked={p[name]} />
          ))}
          <Field
            name="idleMinutes"
            label="Idle timeout (minutes)"
            type="number"
            min={1}
            max={60}
            value={p.idleMinutes}
          />
          <Field
            name="idleWarningSeconds"
            label="Idle warning (seconds)"
            type="number"
            min={15}
            max={300}
            value={p.idleWarningSeconds}
          />
        </SettingsGroupForm>
      </details>
      <details>
        <summary className="cursor-pointer font-semibold">
          Customer display
        </summary>
        <SettingsGroupForm
          group="display"
          snapshot={data.snapshot}
          saveAction={save}
        >
          <Field
            name="app_download_url"
            label="Customer app link"
            type="url"
            value={v.appDownloadUrl}
          />
          <Field
            name="customer_promo_title"
            label="Welcome title"
            value={v.customerPromoTitle}
          />
          <Field
            name="customer_promo_body"
            label="Welcome message"
            value={v.customerPromoBody}
          />
          <Field
            name="customer_left_ad_text"
            label="Left promotion text"
            value={v.customerLeftAdText}
          />
          <Field
            name="customer_right_ad_text"
            label="Right promotion text"
            value={v.customerRightAdText}
          />
          {(
            [
              [
                "customer_show_salon_name",
                "Salon name",
                v.customerShowSalonName,
              ],
              [
                "customer_show_customer_name",
                "Customer name",
                v.customerShowCustomerName,
              ],
              [
                "customer_show_receipt_status",
                "Receipt status",
                v.customerShowReceiptStatus,
              ],
              [
                "customer_show_service_name",
                "Service names",
                v.customerShowServiceName,
              ],
              [
                "customer_show_staff_name",
                "Staff names",
                v.customerShowStaffName,
              ],
              ["customer_show_barcode", "Barcode", v.customerShowBarcode],
            ] as const
          ).map(([name, label, checked]) => (
            <Check
              name={name}
              key={name}
              label={`Show ${label.toLowerCase()}`}
              checked={checked}
            />
          ))}
          {(
            [
              [
                "customer_background_image",
                "Background image",
                v.customerBackgroundImagePath,
              ],
              [
                "customer_left_ad_image",
                "Left promotion image",
                v.customerLeftAdImagePath,
              ],
              [
                "customer_right_ad_image",
                "Right promotion image",
                v.customerRightAdImagePath,
              ],
            ] as const
          ).map(([name, label, path]) => (
            <div
              className="grid gap-2 border-t border-zinc-100 pt-3"
              key={name}
            >
              <input
                type="hidden"
                name={`current_${name}_path`}
                value={path ?? ""}
              />
              <label className="grid gap-1 text-sm">
                {label}
                <input
                  className={inputClass}
                  name={`${name}_file`}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                />
              </label>
              <Check name={`remove_${name}`} label="Remove saved image" />
            </div>
          ))}
        </SettingsGroupForm>
      </details>
      {data.canManagePortable?<details>
        <summary className="cursor-pointer font-semibold">
          Portable POS access
        </summary>
        <div className="mt-3 grid gap-3">
          {!data.portable.schemaReady ? (
            <p className="text-sm text-amber-800">
              {data.portable.setupMessage}
            </p>
          ) : (
            <>
              {data.portable.keys.map((key) => (
                <details
                  className="rounded-lg border border-zinc-200 bg-white p-3"
                  key={key.id}
                >
                  <summary className="cursor-pointer text-sm font-semibold">
                    {key.label ?? key.access_id} ·{" "}
                    {key.is_active ? "Active" : "Disabled"}
                  </summary>
                  <div className="mt-3 grid gap-3">
                    <dl className="grid gap-1 text-sm text-zinc-600"><div>POS ID: {key.access_id}</div><div>Last device: {key.last_user_agent?parseLoginUserAgent(key.last_user_agent).deviceLabel:'No device has signed in'}</div><div>Last sign-in: {key.last_login_at?new Date(key.last_login_at).toLocaleString('en-US'):'Never'}</div><div>Last used: {key.last_used_at?new Date(key.last_used_at).toLocaleString('en-US'):'Never'}</div><div>Last sign-out: {key.last_logout_at?new Date(key.last_logout_at).toLocaleString('en-US'):'Not recorded'}</div></dl>
                    <InlineForm save={form=>saveDirectPortableAccess(data.salonId,form)} onSaved={onSaved} label="Rename device"><input type="hidden" name="action" value="label"/><input type="hidden" name="key_id" value={key.id}/><Field name="label" label="Device name" value={key.label}/></InlineForm>
                    <details><summary className="cursor-pointer text-sm font-semibold">Change passcode & sign out sessions</summary><div className="mt-3"><InlineForm save={form=>saveDirectPortableAccess(data.salonId,form)} onSaved={onSaved} label="Change passcode"><input type="hidden" name="action" value="passcode"/><input type="hidden" name="key_id" value={key.id}/><Field name="passcode" label="New passcode (4–32 characters)" type="password" required/><p className="text-sm text-zinc-500">Devices using this POS ID must sign in again with the new passcode.</p></InlineForm></div></details>
                    {!key.last_used_at&&!key.last_login_at?<details><summary className="cursor-pointer text-sm font-semibold text-red-700">Delete unused access key</summary><div className="mt-3"><InlineForm danger save={form=>saveDirectPortableAccess(data.salonId,form)} onSaved={onSaved} label="Delete access key"><input type="hidden" name="action" value="delete"/><input type="hidden" name="key_id" value={key.id}/><Check name="confirmed" label={`Permanently delete ${key.label||key.access_id}`} required/></InlineForm></div></details>:null}

                    <InlineForm
                      save={(form) =>
                        saveDirectPortableAccess(data.salonId, form)
                      }
                      onSaved={onSaved}
                      label="Save access"
                    >
                      <input type="hidden" name="action" value="capabilities" />
                      <input type="hidden" name="key_id" value={key.id} />
                      {PORTABLE_POS_CAPABILITY_OPTIONS.map((option) => (
                        <label
                          className="flex min-h-10 items-center gap-2 text-sm"
                          key={option.value}
                        >
                          <input
                            type="checkbox"
                            name="capabilities"
                            value={option.value}
                            defaultChecked={key.capabilities.includes(
                              option.value,
                            )}
                          />
                          {option.label}
                        </label>
                      ))}
                    </InlineForm>
                    <InlineForm
                      save={(form) =>
                        saveDirectPortableAccess(data.salonId, form)
                      }
                      onSaved={onSaved}
                      label={key.is_active ? "Disable access" : "Enable access"}
                    >
                      <input type="hidden" name="action" value="status" />
                      <input type="hidden" name="key_id" value={key.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={String(!key.is_active)}
                      />
                      <p className="text-sm text-zinc-500">
                        POS ID: {key.access_id}
                      </p>
                    </InlineForm>
                  </div>
                </details>
              ))}
              <InlineForm
                save={(form) => saveDirectPortableAccess(data.salonId, form)}
                onSaved={onSaved}
                label="Create POS access"
              >
                <input type="hidden" name="action" value="create" />
                <Field name="access_id" label="POS ID" required />
                <Field name="label" label="Device label (optional)" />
                <Field
                  name="passcode"
                  label="Passcode"
                  type="password"
                  required
                />
                {PORTABLE_POS_CAPABILITY_OPTIONS.map((option) => (
                  <label
                    className="flex min-h-10 items-center gap-2 text-sm"
                    key={option.value}
                  >
                    <input
                      type="checkbox"
                      name="capabilities"
                      value={option.value}
                      defaultChecked={option.defaultEnabled}
                    />
                    {option.label}
                  </label>
                ))}
              </InlineForm>
            </>
          )}
        </div>
      </details>:null}
      <details>
        <summary className="cursor-pointer font-semibold">
          Install POS & customer display
        </summary>
        <div className="mt-3 grid gap-4">
          {data.installer ? (
            <WindowsPosDownloadLinks href={data.installer}/>
          ) : (
            <p className="text-sm text-zinc-500">
              Windows download is unavailable.
            </p>
          )}
          <p className="text-sm text-zinc-600">On the display device, use its POS ID and passcode to pair the customer display. Manage that ID in Portable POS access above.</p>
        </div>
      </details>
    </div>
  );
}
