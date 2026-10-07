"use client";
import { useState } from "react";
import {
  saveDirectSalonProfile,
  saveDirectHours,
  saveDirectSpecialHours,
  saveDirectBooking,
} from "./direct-settings-actions";
import {
  Field,
  Check,
  Select,
  InlineForm,
  inputClass,
  buttonClass,
  text,
  number,
  checked,
  type DirectData,
} from "./direct-settings-ui";
import { SalonProfilePreferencesPanel } from "./salon-profile-preferences-panel";
import { StaffAvailabilityEditor } from "@/app/booking-setup/booking-setup-editors";
import { SalonMediaUploader } from "@/app/salon-profile/salon-profile-studio";
import { saveSettingsProfileIdentity } from "./settings-extra-actions";
import { refreshSettingsMap } from "./settings-extra-actions";
import type { SalonOperatingHoursSettings } from "@/types/salon-operating-status";

type ProfileData = Extract<
  DirectData,
  { kind: "salon-profile" | "public-profile" }
>;
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
function OperatingHours({
  data,
  onSaved,
}: {
  data: Extract<DirectData,{kind:"salon-profile"}>;
  onSaved: () => Promise<void>;
}) {
  const [windows, setWindows] = useState<
    SalonOperatingHoursSettings["weeklyHours"]
  >(data.hours.weeklyHours);
  return (
    <InlineForm
      save={(form) =>
        saveDirectHours(data.salonId, {
          timeZone: text(form, "timezone"),
          weeklyHours: windows,
        })
      }
      onSaved={onSaved}
      onCancel={() => setWindows(data.hours.weeklyHours)}
      label="Save opening hours"
    >
      <Field
        name="timezone"
        label="Time zone"
        value={data.hours.timeZone}
        required
      />
      {days.map((day, dayOfWeek) => (
        <div className="grid gap-2 border-t border-zinc-100 pt-3" key={day}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{day}</span>
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                setWindows([
                  ...windows,
                  {
                    dayOfWeek,
                    opensAtLocal: "09:00",
                    closesAtLocal: "17:00",
                    sortOrder: windows.filter((w) => w.dayOfWeek === dayOfWeek)
                      .length,
                  },
                ])
              }
            >
              Add hours
            </button>
          </div>
          {!windows.some((w) => w.dayOfWeek === dayOfWeek) && (
            <span className="text-sm text-zinc-500">Closed</span>
          )}
          {windows.map((window, index) =>
            window.dayOfWeek === dayOfWeek ? (
              <div
                className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                key={`${day}-${index}`}
              >
                {(["opensAtLocal", "closesAtLocal"] as const).map((key) => (
                  <label className="grid gap-1 text-sm" key={key}>
                    {key === "opensAtLocal" ? "Opens" : "Closes"}
                    <input className={inputClass} type="time" required
                      value={window[key].slice(0, 5)}
                      onChange={(event) => setWindows((current) => current.map((item, i) => i === index ? {...item, [key]: event.target.value} : item))} />
                  </label>
                ))}
                <button
                  className={buttonClass}
                  type="button"
                  aria-label={`Remove ${day} hours`}
                  onClick={() =>
                    setWindows(windows.filter((_, i) => i !== index))
                  }
                >
                  Remove
                </button>
              </div>
            ) : null,
          )}
        </div>
      ))}
    </InlineForm>
  );
}
function PublicIdentity({data,onSaved}:{data:Extract<DirectData,{kind:"public-profile"}>;onSaved:()=>Promise<void>}){
 const [paths,setPaths]=useState<{logo:string|null;cover:string|null}>({logo:null,cover:null}),[removed,setRemoved]=useState({logo:false,cover:false}),[uploading,setUploading]=useState({logo:false,cover:false}),[reset,setReset]=useState(0);
 return <details><summary className="cursor-pointer text-sm font-semibold">Tagline, story, logo & cover</summary><div className="mt-3"><InlineForm disabled={uploading.logo||uploading.cover} save={form=>saveSettingsProfileIdentity(data.salonId,form)} onSaved={async()=>{await onSaved();setReset(v=>v+1);setPaths({logo:null,cover:null});setRemoved({logo:false,cover:false});}} onCancel={()=>{setReset(v=>v+1);setPaths({logo:null,cover:null});setRemoved({logo:false,cover:false});}}>
 <Field name="tagline" label="Tagline" value={data.profileIdentity?.public_profile_tagline}/><label className="grid gap-1 text-sm">Salon story<textarea className={inputClass} name="story" rows={4} defaultValue={data.profileIdentity?.public_profile_story||''}/></label>
 {(['logo','cover'] as const).map(kind=><div key={kind}><input type="hidden" name={`${kind}_path`} value={paths[kind]||''}/><input type="hidden" name={`remove_${kind}`} value={String(removed[kind])}/><SalonMediaUploader key={`${kind}-${reset}`} onUploadStateChange={busy=>setUploading(v=>v[kind]===busy?v:{...v,[kind]:busy})} expectedSalonId={data.salonId} currentPath={kind==='logo'?data.profileIdentity?.public_profile_logo_path||null:data.profileIdentity?.public_profile_cover_path||null} currentUrl={kind==='logo'?data.logoUrl:data.coverUrl} intent="identity" kind={kind} label={kind==='logo'?'Salon logo':'Cover image'} onRemoveExisting={()=>setRemoved(v=>({...v,[kind]:true}))} onUploaded={path=>{setPaths(v=>({...v,[kind]:path}));if(path)setRemoved(v=>({...v,[kind]:false}));}}/></div>)}
 </InlineForm></div></details>;
}
export function SalonDetailsPanel({
  data,
  onSaved,
}: {
  data: ProfileData;
  onSaved: () => Promise<void>;
}) {
  const s = data.setting;
  if (!data.canManage)
    return (
      <p className="text-sm text-zinc-500">
        You can view this salon but do not have permission to change its
        settings.
      </p>
    );
  if (data.kind === "public-profile")
    return (
      <div className="grid gap-4">
        <PublicIdentity data={data} onSaved={onSaved}/>
        {data.canManageSalon?<InlineForm
          save={(form) =>
            saveDirectSalonProfile(data.salonId, {
              business_name: s.business_name,
              public_discovery_enabled: checked(
                form,
                "public_discovery_enabled",
              ),
              allow_staff_applications: checked(
                form,
                "allow_staff_applications",
              ),
            })
          }
          onSaved={onSaved}
        >
          <Check
            name="public_discovery_enabled"
            label="Show salon in Explore"
            checked={s.public_discovery_enabled}
          />
          <Check
            name="allow_staff_applications"
            label="Allow staff applications"
            checked={s.allow_staff_applications}
          />
          {!data.readiness.canEnable && (
            <p className="text-sm text-amber-800">
              Required before enabling Explore:{" "}
              {data.readiness.missingLabels.join(", ")}.
            </p>
          )}
        </InlineForm>:null}
        <SalonProfilePreferencesPanel expectedSalonId={data.salonId} />
      </div>
    );
  return (
    <div className="grid gap-4">
      <InlineForm
        save={(form) =>
          saveDirectSalonProfile(data.salonId, {
            business_name: text(form, "business_name"),
            phone: text(form, "phone") || null,
            email: text(form, "email") || null,
            website: text(form, "website") || null,
            business_description: text(form, "business_description") || null,
            address_line1: text(form, "address_line1") || null,
            address_line2: text(form, "address_line2") || null,
            city: text(form, "city") || null,
            state: text(form, "state") || null,
            postal_code: text(form, "postal_code") || null,
            country: text(form, "country") || null,
          })
        }
        onSaved={onSaved}
      >
        <Field
          name="business_name"
          label="Salon name"
          value={s.business_name}
          required
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="phone" label="Phone" type="tel" value={s.phone} />
          <Field name="email" label="Email" type="email" value={s.email} />
        </div>
        <Field name="website" label="Website" type="url" value={s.website} />
        <label className="grid gap-1 text-sm">
          Description
          <textarea
            name="business_description"
            className={inputClass}
            defaultValue={s.business_description ?? ""}
            rows={3}
          />
        </label>
        <Field name="address_line1" label="Address" value={s.address_line1} />
        <Field
          name="address_line2"
          label="Unit / suite"
          value={s.address_line2}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="city" label="City" value={s.city} />
          <Field name="state" label="State" value={s.state} />
          <Field name="postal_code" label="ZIP code" value={s.postal_code} />
          <Field name="country" label="Country code" value={s.country} />
        </div>
      </InlineForm>
      <details><summary className="cursor-pointer text-sm font-semibold">Map location</summary><div className="mt-3">
        <InlineForm save={()=>refreshSettingsMap(data.salonId)} onSaved={onSaved} label="Update map from saved address">
          <p className="text-sm">{[s.address_line1,s.city,s.state,s.postal_code].filter(Boolean).join(", ")}</p>
          {data.mapLocation.coordinates?<p className="text-xs text-zinc-500">Latitude {data.mapLocation.coordinates.latitude} · Longitude {data.mapLocation.coordinates.longitude}</p>:null}
          <p className="text-sm">{data.mapLocation.statusDescription}</p>
        </InlineForm>
      </div></details>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          Opening hours
        </summary>
        <div className="mt-3">
          <OperatingHours
            key={JSON.stringify(data.hours.weeklyHours)}
            data={data}
            onSaved={onSaved}
          />
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          Holiday & special hours
        </summary>
        <div className="mt-3 grid gap-3">
          {data.hours.specialHours.map((h) => (
            <InlineForm
              key={h.id}
              label="Remove special hours"
              save={() =>
                saveDirectSpecialHours(data.salonId, { deleteId: h.id })
              }
              onSaved={onSaved}
            >
              <p className="text-sm">
                {h.localDate} ·{" "}
                {h.status === "closed"
                  ? "Closed"
                  : `${h.opensAtLocal}–${h.closesAtLocal}`}
                {h.reason ? ` · ${h.reason}` : ""}
              </p>
            </InlineForm>
          ))}
          <InlineForm
            label="Add special hours"
            save={(form) =>
              saveDirectSpecialHours(data.salonId, {
                localDate: text(form, "date"),
                status:
                  text(form, "status") === "custom_hours"
                    ? "custom_hours"
                    : "closed",
                opensAtLocal: text(form, "opens") || null,
                closesAtLocal: text(form, "closes") || null,
                reason: text(form, "reason") || null,
              })
            }
            onSaved={onSaved}
          >
            <Field name="date" label="Date" type="date" required />
            <Select
              name="status"
              label="Schedule"
              value="closed"
              options={[
                ["closed", "Closed"],
                ["custom_hours", "Custom hours"],
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field name="opens" label="Opens (custom hours)" type="time" />
              <Field name="closes" label="Closes (custom hours)" type="time" />
            </div>
            <Field name="reason" label="Reason (optional)" />
          </InlineForm>
        </div>
      </details>
    </div>
  );
}

const bookingChecks = [
  ["booking_enabled", "Enable booking"],
  ["online_booking_visible", "Show online booking"],
  ["guest_booking_enabled", "Allow guest booking"],
  ["same_day_booking_enabled", "Allow same-day booking"],
  ["auto_assign_enabled", "Automatically assign staff"],
  ["any_professional_enabled", "Allow any professional"],
  ["split_staff_appointment_enabled", "Allow multiple staff per appointment"],
  ["reminder_enabled", "Send booking reminders"],
  ["confirmation_email_enabled", "Send email confirmations"],
  ["confirmation_sms_enabled", "Send SMS confirmations"],
] as const;
export function BookingSettingsPanel({
  data,
  onSaved,
}: {
  data: Extract<DirectData, { kind: "booking" }>;
  onSaved: () => Promise<void>;
}) {
  const s = data.settings;
  return (
    <div className="grid gap-4">
      {data.canManage ? (
        <InlineForm
          save={(form) =>
            saveDirectBooking(data.salonId, {
              bookingEnabled: checked(form, "booking_enabled"),
              onlineBookingVisible: checked(form, "online_booking_visible"),
              guestBookingEnabled: checked(form, "guest_booking_enabled"),
              sameDayBookingEnabled: checked(form, "same_day_booking_enabled"),
              autoAssignEnabled: checked(form, "auto_assign_enabled"),
              anyProfessionalEnabled: checked(form, "any_professional_enabled"),
              splitStaffAppointmentEnabled: checked(
                form,
                "split_staff_appointment_enabled",
              ),
              reminderEnabled: checked(form, "reminder_enabled"),
              confirmationEmailEnabled: checked(
                form,
                "confirmation_email_enabled",
              ),
              confirmationSmsEnabled: checked(form, "confirmation_sms_enabled"),
              confirmationMode:
                text(form, "confirmation_mode") === "instant_booking"
                  ? "instant_booking"
                  : "request_confirmation",
              minimumLeadTimeMinutes: number(form, "minimum_lead_time_minutes"),
              maximumAdvanceWindowDays: number(
                form,
                "maximum_advance_window_days",
              ),
              slotIntervalMinutes: number(form, "slot_interval_minutes"),
              defaultCleanupBufferMinutes: number(
                form,
                "default_cleanup_buffer_minutes",
              ),
              cancellationWindowMinutes: number(
                form,
                "cancellation_window_minutes",
              ),
              ticketCreationMode: text(
                form,
                "ticket_creation_mode",
              ) as typeof s.ticket_creation_mode,
              timezoneIana: text(form, "timezone_iana"),
            })
          }
          onSaved={onSaved}
        >
          {bookingChecks.map(([name, label]) => (
            <Check
              key={name}
              name={name}
              label={label}
              checked={Boolean(s[name])}
            />
          ))}
          <Select
            name="confirmation_mode"
            label="Confirmation"
            value={s.confirmation_mode}
            options={[
              ["request_confirmation", "Salon approval required"],
              ["instant_booking", "Instant booking"],
            ]}
          />
          <Field
            name="minimum_lead_time_minutes"
            label="Minimum lead time (minutes)"
            value={s.minimum_lead_time_minutes}
            type="number"
            min={0}
            max={10080}
            required
          />
          <Field
            name="maximum_advance_window_days"
            label="Book ahead (days)"
            value={s.maximum_advance_window_days}
            type="number"
            min={1}
            max={730}
            required
          />
          <Select
            name="slot_interval_minutes"
            label="Time slot interval"
            value={String(s.slot_interval_minutes)}
            options={[5, 10, 15, 20, 30, 60].map((n) => [
              String(n),
              `${n} minutes`,
            ])}
          />
          <Field
            name="default_cleanup_buffer_minutes"
            label="Cleanup buffer (minutes)"
            value={s.default_cleanup_buffer_minutes}
            type="number"
            min={0}
            max={240}
            required
          />
          <Field
            name="cancellation_window_minutes"
            label="Cancellation notice (minutes)"
            value={s.cancellation_window_minutes}
            type="number"
            min={0}
            max={10080}
            required
          />
          <Field
            name="timezone_iana"
            label="Time zone"
            value={s.timezone_iana}
            required
          />
          <Select
            name="ticket_creation_mode"
            label="Create POS ticket"
            value={s.ticket_creation_mode}
            options={[
              ["manual", "Manually"],
              ["on_check_in", "On check-in"],
              ["on_service_start", "On service start"],
            ]}
          />
        </InlineForm>
      ) : (
        <p className="text-sm text-zinc-500">
          Booking rules are read-only for your role.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          Staff availability & time off
        </summary>
        <div className="mt-3">
          <StaffAvailabilityEditor
            availabilityRules={data.setup.availabilityRules}
            timeBlocks={data.setup.timeBlocks}
            staff={data.setup.staff}
            timezone={data.setup.timezone}
            readinessByStaffId={data.setup.readinessByStaffId}
            canManage={data.setup.permissions.canManageAvailability}
            onSaved={onSaved}
            expectedSalonId={data.salonId}
          />
        </div>
      </details>
    </div>
  );
}
