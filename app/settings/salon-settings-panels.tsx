"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { BookingDepositSettings } from "./booking-deposit-settings";
import { BookingRulesSettings, BookSmsSettings } from "./booking-plugin-settings";
import { TimeZoneSelect } from "@/components/time-zone-select";
import { SalonPublicationStatus } from "@/components/salon-publication-status";
import { useState } from "react";
import {
  saveDirectSalonProfile,
  saveDirectHours,
  saveDirectSpecialHours,
  saveDirectBooking,
} from "./direct-settings-actions";
import {
  Field,
  SettingsFieldGroup,
  SettingsEditSection,
  SettingsReadRow,
  SettingsIdentity,

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
  const __vt = useWorkspaceTranslation();

  const [windows, setWindows] = useState<
    SalonOperatingHoursSettings["weeklyHours"]
  >(data.hours.weeklyHours);
  const [hoursChanged, setHoursChanged] = useState(false);
  const [loadedHours, setLoadedHours] = useState(data.hours.weeklyHours);
  if (loadedHours !== data.hours.weeklyHours && !hoursChanged) {
    setLoadedHours(data.hours.weeklyHours);
    setWindows(data.hours.weeklyHours);
  }
  function updateWindows(value: typeof windows | ((current: typeof windows) => typeof windows)) {
    setWindows(value);
    setHoursChanged(true);
  }
  return (
    <InlineForm
      save={(form) =>
        saveDirectHours(data.salonId, {
          timeZone: text(form, "timezone"),
          weeklyHours: windows,
        })
      }
      onSaved={async () => { setLoadedHours(data.hours.weeklyHours); setHoursChanged(false); await onSaved(); }}
      onCancel={() => { setWindows(data.hours.weeklyHours); setHoursChanged(false); }}
      changed={hoursChanged}
      label={__vt("Save opening hours")}
    >
      <p className="text-sm text-zinc-600"><WorkspaceText text="Opening hours tell customers when the salon is open. Booking hours and staff availability are managed separately in Booking rules & availability." /></p>
      <label className="grid gap-1 text-sm"><WorkspaceText text="Time zone" /><TimeZoneSelect name="timezone" className={inputClass} defaultValue={data.hours.timeZone} required /></label>
      {days.map((day, dayOfWeek) => (
        <div className="settings-hours-day grid gap-2 border-t border-zinc-100 pt-3" key={day}>
          <div className="settings-hours-day-heading flex items-center justify-between">
            <span className="text-sm font-medium">{day}</span>
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                updateWindows([
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
              <WorkspaceText text="Add hours" />
            </button>
          </div>
          {!windows.some((w) => w.dayOfWeek === dayOfWeek) && (
            <span className="text-sm text-zinc-500"><WorkspaceText text="Closed" /></span>
          )}
          {windows.map((window, index) =>
            window.dayOfWeek === dayOfWeek ? (
              <div
                className="settings-hours-window grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                key={`${day}-${index}`}
              >
                {(["opensAtLocal", "closesAtLocal"] as const).map((key) => (
                  <label className="grid gap-1 text-sm" key={key}>
                    <WorkspaceText text={key === "opensAtLocal" ? "Opens" : "Closes"} />
                    <input className={inputClass} type="time" required
                      value={window[key].slice(0, 5)}
                      onChange={(event) => updateWindows((current) => current.map((item, i) => i === index ? {...item, [key]: event.target.value} : item))} />
                  </label>
                ))}
                <button
                  className={buttonClass}
                  type="button"
                  aria-label={__vt(`Remove ${day} hours`)}
                  onClick={() =>
                    updateWindows(windows.filter((_, i) => i !== index))
                  }
                >
                  <WorkspaceText text="Remove" />
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
 const __vt=useWorkspaceTranslation();
 const [paths,setPaths]=useState<{logo:string|null;cover:string|null}>({logo:null,cover:null}),[removed,setRemoved]=useState({logo:false,cover:false}),[uploading,setUploading]=useState({logo:false,cover:false}),[reset,setReset]=useState(0);
 return <section className="settings-salon-public">
  <div className="settings-public-cover">{data.coverUrl?
   // eslint-disable-next-line @next/next/no-img-element
   <img src={data.coverUrl} alt={__vt("Cover image")}/>:null}</div>
  <SettingsIdentity name={data.setting.business_name||__vt("Salon")} imageUrl={data.logoUrl}/>
  <InlineForm disabled={uploading.logo||uploading.cover} save={form=>saveSettingsProfileIdentity(data.salonId,form)} onSaved={async()=>{await onSaved();setReset(v=>v+1);setPaths({logo:null,cover:null});setRemoved({logo:false,cover:false});}} onCancel={()=>{setReset(v=>v+1);setPaths({logo:null,cover:null});setRemoved({logo:false,cover:false});}}>
   <div className="settings-salon-media-row">{(['cover','logo'] as const).map(kind=><details className="settings-media-picker" key={kind}><summary><WorkspaceText text={kind==='logo'?'Change logo':'Change cover'}/></summary><div className="settings-media-picker-content"><input type="hidden" name={kind+'_path'} value={paths[kind]||''}/><input type="hidden" name={'remove_'+kind} value={String(removed[kind])}/><SalonMediaUploader key={kind+'-'+reset} onUploadStateChange={busy=>setUploading(v=>v[kind]===busy?v:{...v,[kind]:busy})} expectedSalonId={data.salonId} currentPath={kind==='logo'?data.profileIdentity?.public_profile_logo_path||null:data.profileIdentity?.public_profile_cover_path||null} currentUrl={kind==='logo'?data.logoUrl:data.coverUrl} intent="identity" kind={kind} label={__vt(kind==='logo'?'Salon logo':'Cover image')} onRemoveExisting={()=>setRemoved(v=>({...v,[kind]:true}))} onUploaded={path=>{setPaths(v=>({...v,[kind]:path}));if(path)setRemoved(v=>({...v,[kind]:false}));}}/></div></details>)}</div>
   <Field name="tagline" label={__vt("Tagline")} value={data.profileIdentity?.public_profile_tagline}/><label className="settings-field"><WorkspaceText text="Salon story"/><textarea className={inputClass} name="story" rows={4} defaultValue={data.profileIdentity?.public_profile_story||''}/></label>
  </InlineForm>
 </section>;
}
export function SalonDetailsPanel({
  data,
  onSaved,
}: {
  data: ProfileData;
  onSaved: () => Promise<void>;
}) {
  const __vt = useWorkspaceTranslation();

  const s = data.setting;
  if (!data.canManage)
    return (
      <p className="text-sm text-zinc-500">
        <WorkspaceText text="You can view this salon but do not have permission to change its settings." />
      </p>
    );
  if (data.kind === "public-profile")
    return (
      <div className="grid gap-4">
        <PublicIdentity data={data} onSaved={onSaved}/>
        {data.publicProfileAvailable === null ? <p role="status" className="text-sm text-zinc-600"><WorkspaceText text="Public visibility could not be checked. Reload this section before sharing a link." /></p>
          : data.publicProfileAvailable || !s.public_discovery_enabled ? <SalonPublicationStatus publicHref={data.publicProfileAvailable ? `/explore/salons/${encodeURIComponent(data.salonId)}` : null} />
          : <p role="status" className="text-sm text-amber-800"><WorkspaceText text="Public visibility is enabled, but the profile is unavailable. Check the salon status before sharing a link." /></p>}

        {data.canManageSalon?<SettingsEditSection title={__vt("Visibility")} preview={<><SettingsReadRow label="Public discovery" value={__vt(s.public_discovery_enabled?"On":"Off")}/><SettingsReadRow label="Staff applications" value={__vt(s.allow_staff_applications?"On":"Off")}/></>}><InlineForm
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
            label={__vt("Make profile public & visible in Explore")}
            checked={s.public_discovery_enabled}
          />
          <Check
            name="allow_staff_applications"
            label={__vt("Allow staff applications")}
            checked={s.allow_staff_applications}
          />
          <p className="text-sm text-zinc-600"><WorkspaceText text="Publishing makes this profile public and allows it to appear in Explore. Booking is configured separately." /></p>
          <details open={!data.readiness.canEnable}><summary className="cursor-pointer text-sm font-semibold"><WorkspaceText text="Required when enabling visibility from Settings" /></summary>
            <ul className="mt-2 grid gap-2 text-sm">{data.readiness.items.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2"><WorkspaceText text={item.label} /><span className={item.complete ? "text-emerald-800" : "text-amber-800"}><WorkspaceText text={item.complete ? "Done" : "Missing"} /></span></li>)}</ul>
          </details>
        </InlineForm></SettingsEditSection>:null}
        <SettingsEditSection title={__vt("Website appearance & verification")} action="Manage" closeOnSave={false}><SalonProfilePreferencesPanel expectedSalonId={data.salonId}/></SettingsEditSection>
      </div>
    );
  return (
    <div className="grid gap-4">

      <SettingsEditSection title={s.business_name||__vt("Salon information")} heading={<SettingsIdentity name={s.business_name||__vt("Salon")} subtitle={[s.city,s.state].filter(Boolean).join(", ")}/>} preview={<div><SettingsReadRow label="Phone" value={s.phone}/><SettingsReadRow label="Email" value={s.email}/><SettingsReadRow label="Website" value={s.website}/><SettingsReadRow label="Address" value={[s.address_line1,s.address_line2,s.city,s.state,s.postal_code,s.country].filter(Boolean).join(", ")}/>{s.business_description?<SettingsReadRow label="Description" value={s.business_description}/>:null}<SettingsReadRow label="Time zone" value={data.hours.timeZone}/></div>}>
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
        <SettingsFieldGroup title="Salon identity & contact">
        <Field
          name="business_name"
          label={__vt("Salon name")}
          value={s.business_name}
          required
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="phone" label={__vt("Phone")} type="tel" value={s.phone} />
          <Field name="email" label={__vt("Email")} type="email" value={s.email} />
        </div>
        <Field name="website" label={__vt("Website")} type="url" value={s.website} />
        <label className="grid gap-1 text-sm">
          <WorkspaceText text="Description" />
          <textarea
            name="business_description"
            className={inputClass}
            defaultValue={s.business_description ?? ""}
            rows={3}
          />
        </label>
        </SettingsFieldGroup>
        <SettingsFieldGroup title="Salon address">
        <Field name="address_line1" label={__vt("Address")} value={s.address_line1} />
        <Field
          name="address_line2"
          label={__vt("Unit / suite")}
          value={s.address_line2}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="city" label={__vt("City")} value={s.city} />
          <Field name="state" label={__vt("State")} value={s.state} />
          <Field name="postal_code" label={__vt("ZIP code")} value={s.postal_code} />
          <Field name="country" label={__vt("Country code")} value={s.country} />
        </div>
        </SettingsFieldGroup>
      </InlineForm>
      </SettingsEditSection>
      {!data.mapLocation.providerConfigured || !process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim() ? null : <details><summary className="cursor-pointer text-sm font-semibold"><WorkspaceText text="Map location" /></summary><div className="mt-3">

        <InlineForm disabled={!data.mapLocation.refreshEnabled} save={()=>refreshSettingsMap(data.salonId)} onSaved={onSaved} label={__vt("Update map from saved address")}>
          <p className="text-sm">{[s.address_line1,s.city,s.state,s.postal_code].filter(Boolean).join(", ")}</p>
          {data.mapLocation.coordinates?<p className="text-xs text-zinc-500"><WorkspaceText text="Latitude" /> {data.mapLocation.coordinates.latitude} <WorkspaceText text="· Longitude" /> {data.mapLocation.coordinates.longitude}</p>:null}
          <p className="text-sm"><WorkspaceText text={data.mapLocation.statusDescription} /></p>
          <p className="text-sm text-zinc-600"><WorkspaceText text="Save your address above before updating the map." /></p>
        </InlineForm>
      </div></details>}
      <SettingsEditSection title={__vt("Opening hours")} preview={<div className="settings-hours-preview">{days.map((day,dayOfWeek)=>{const windows=data.hours.weeklyHours.filter(w=>w.dayOfWeek===dayOfWeek);return <SettingsReadRow key={day} label={day} value={windows.length?windows.map(w=>w.opensAtLocal.slice(0,5)+" – "+w.closesAtLocal.slice(0,5)).join(" · "):__vt("Closed")}/>;})}</div>}><OperatingHours data={data} onSaved={onSaved}/></SettingsEditSection>

      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          <WorkspaceText text="Holiday & special hours" />
        </summary>
        <div className="mt-3 grid gap-3">
          {data.hours.specialHours.map((h) => (
            <InlineForm
              key={h.id}
              label={__vt("Remove special hours")}
              save={() =>
                saveDirectSpecialHours(data.salonId, { deleteId: h.id })
              }
              onSaved={onSaved}
            >
              <p className="text-sm">
                {h.localDate} ·{" "}
                <WorkspaceText text={h.status === "closed"
                  ? "Closed"
                  : `${h.opensAtLocal}–${h.closesAtLocal}`} />
                {h.reason ? ` · ${h.reason}` : ""}
              </p>
            </InlineForm>
          ))}
          <InlineForm
            label={__vt("Add special hours")}
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
            <Field name="date" label={__vt("Date")} type="date" required />
            <Select
              name="status"
              label={__vt("Schedule")}
              value="closed"
              options={[
                ["closed", "Closed"],
                ["custom_hours", "Custom hours"],
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field name="opens" label={__vt("Opens (custom hours)")} type="time" />
              <Field name="closes" label={__vt("Closes (custom hours)")} type="time" />
            </div>
            <Field name="reason" label={__vt("Reason (optional)")} />
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
  ["reminder_enabled", "Send email booking reminders"],
  ["confirmation_email_enabled", "Send email confirmations"],
] as const;
export function BookingSettingsPanel({
  data,
  onSaved,
}: {
  data: Extract<DirectData, { kind: "booking" }>;
  onSaved: () => Promise<void>;
}) {
  const __vt = useWorkspaceTranslation();

  const s = data.settings;
  return (
    <div className="grid gap-4">


      {data.canManage ? (
        <InlineForm
          className="settings-booking-form"
          label={__vt("Save booking rules")}
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
          <div className="settings-booking-columns"><div className="settings-booking-access"><h3><WorkspaceText text="Booking access" /></h3>
          {bookingChecks.slice(0,4).map(([name,label])=><Check key={name} name={name} label={__vt(label)} checked={Boolean(s[name])}/>)}
          <details><summary><WorkspaceText text="Staff assignment" /></summary>{bookingChecks.slice(4,7).map(([name,label])=><Check key={name} name={name} label={__vt(label)} checked={Boolean(s[name])}/>)}</details>
          <details><summary><WorkspaceText text="Confirmations & reminders" /></summary>{bookingChecks.slice(7).map(([name,label])=><Check key={name} name={name} label={__vt(label)} checked={Boolean(s[name])}/>)}
          <Select name="confirmation_mode" label={__vt("Confirmation")} value={s.confirmation_mode} options={[["request_confirmation","Salon approval required"],["instant_booking","Instant booking"]]}/></details>
          </div><div className="settings-booking-timing"><h3><WorkspaceText text="Timing & scheduling" /></h3><p className="mb-3 text-xs text-zinc-500"><WorkspaceText text="Times use this salon’s booking timezone." /></p><div className="settings-booking-fields">
            <Field name="minimum_lead_time_minutes" label={__vt("Minimum lead time (minutes)")} value={s.minimum_lead_time_minutes} type="number" min={0} max={10080} required/>
            <Field name="maximum_advance_window_days" label={__vt("Book ahead (days)")} value={s.maximum_advance_window_days} type="number" min={1} max={730} required/>
            <Select name="slot_interval_minutes" label={__vt("Time slot interval")} value={String(s.slot_interval_minutes)} options={[5,10,15,20,30,60].map(n=>[String(n),`${n} minutes`])}/>
            <Field name="default_cleanup_buffer_minutes" label={__vt("Cleanup buffer (minutes)")} value={s.default_cleanup_buffer_minutes} type="number" min={0} max={240} required/>
            <Field name="cancellation_window_minutes" label={__vt("Cancellation notice (minutes)")} value={s.cancellation_window_minutes} type="number" min={0} max={10080} required/>
            <label className="grid gap-1 text-sm"><WorkspaceText text="Time zone" /><TimeZoneSelect name="timezone_iana" className={inputClass} defaultValue={s.timezone_iana} required /></label>
            <Select name="ticket_creation_mode" label={__vt("Create POS ticket")} value={s.ticket_creation_mode} options={[["manual","Manually"],["on_check_in","On check-in"],["on_service_start","On service start"]]}/>
          </div></div></div>
        </InlineForm>
      ) : (
        <p className="text-sm text-zinc-500">
          <WorkspaceText text="Booking rules are read-only for your role." />
        </p>
      )}
      {data.canManage && data.canManagePlugins ? <BookingDepositSettings key={data.salonId} salonId={data.salonId} /> : null}
      {data.canManage && data.canManagePlugins ? <BookingRulesSettings key={`rules-${data.salonId}`} salonId={data.salonId} /> : null}
      {data.canManage && data.canManagePlugins ? <BookSmsSettings key={`sms-${data.salonId}`} salonId={data.salonId} /> : null}
      <details>
        <summary className="cursor-pointer text-sm font-semibold">
          <WorkspaceText text="Staff availability & time off" />
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
