"use client";
import { WorkspaceText } from "@/components/workspace-language";
import { useEffect, useState } from "react";
import { SettingsFieldGroup, SettingsSwitch } from "./direct-settings-ui";
import {
  NOTIFICATION_CATEGORIES,
  type NotificationPreferences,
} from "@/lib/notification-categories";
export function NotificationPreferencesPanel() {


  const [preferences, setPreferences] = useState<NotificationPreferences>({});
  const [staffBooking, setStaffBooking] = useState<{
    salonId: string;
    enabled: boolean;
  } | null>(null);
  const [checkInDefault, setCheckInDefault] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/notifications/preferences", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Error(data.error);
        setPreferences(data.preferences);
        setCheckInDefault(data.checkInDefault);
        setStaffBooking(data.staffBooking ?? null);
        setLoaded(true);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [retry]);
  async function save(
    category: (typeof NOTIFICATION_CATEGORIES)[number]["id"],
    enabled: boolean,
  ) {
    setBusy(category);
    setError("");
    try {
      const r = await fetch("/api/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, enabled }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setPreferences((p) => ({ ...p, [category]: enabled }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings.");
    } finally {
      setBusy(null);
    }
  }
  async function saveStaffBooking() {
    if (!staffBooking) return;
    setBusy("staff-booking");
    setError("");
    try {
      const response = await fetch("/api/staff/booking-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId: staffBooking.salonId,
          preference: "notifications",
          enabled: !staffBooking.enabled,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setStaffBooking({ ...staffBooking, enabled: data.notifications });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save staff notification settings.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="settings-style"><div className="space-y-4">
      <p className="text-xs text-zinc-500"><WorkspaceText text="Applies to new in-app notifications in every workspace. Support replies, claim decisions and requests for more information are always delivered." /></p>
      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          <WorkspaceText text={error} />{" "}
          {!loaded && (
            <button
              type="button"
              className="ml-2 font-semibold underline"
              onClick={() => {
                setError("");
                setRetry((value) => value + 1);
              }}
            >
              <WorkspaceText text="Retry" />
            </button>
          )}
        </p>
      )}
      {!loaded && !error && (
        <p role="status" className="text-sm text-zinc-500">
          <WorkspaceText text="Loading preferences…" />
        </p>
      )}
      <p className="text-xs text-zinc-500"><WorkspaceText text="Changes save automatically" /></p>
      {[
        {title:"Bookings & visits",categories:["booking","reminders","receipts","check_in"]},
        {title:"Team & activity",categories:["team","comments","following"]},
      ].map(group=><SettingsFieldGroup key={group.title} title={group.title}>
        <div className="settings-switch-list">{NOTIFICATION_CATEGORIES.filter(c=>group.categories.includes(c.id)).map(c=>
          <SettingsSwitch key={c.id} label={c.label} description={c.description}
            checked={preferences[c.id]??(c.id==="check_in"?checkInDefault:c.enabled)}
            disabled={!loaded||busy!==null} onChange={()=>void save(c.id,!(preferences[c.id]??(c.id==="check_in"?checkInDefault:c.enabled)))}/>
        )}</div>
        {group.title==="Bookings & visits"&&staffBooking?<SettingsSwitch label="Assigned bookings in this salon" description="Your existing staff booking mute. Both this switch and Booking updates must be On." checked={staffBooking.enabled} disabled={busy!==null} onChange={()=>void saveStaffBooking()}/>:null}
      </SettingsFieldGroup>)}
      <p className="text-xs leading-5 text-zinc-500">
        <WorkspaceText text="Check-in uses the role default until you choose On or Off here. Followed posts are an opt-in digest, at most once per profile per day. Likes and promotions remain off; their delivery is not yet available." />
      </p>
    </div></div>
  );
}
