"use client";
import { useEffect, useState } from "react";
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
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">Applies to new in-app notifications in every workspace.</p>
      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-3 text-sm text-red-700"
        >
          {error}{" "}
          {!loaded && (
            <button
              type="button"
              className="ml-2 font-semibold underline"
              onClick={() => {
                setError("");
                setRetry((value) => value + 1);
              }}
            >
              Retry
            </button>
          )}
        </p>
      )}
      {!loaded && !error && (
        <p role="status" className="text-sm text-zinc-500">
          Loading preferences…
        </p>
      )}
      <div className="content-surface divide-y divide-zinc-100 border-zinc-200 rounded-none border-y shadow-none">
        {NOTIFICATION_CATEGORIES.filter(
          (c) => !["likes", "marketing"].includes(c.id),
        ).map((c) => {
          const checked =
            preferences[c.id] ??
            (c.id === "check_in" ? checkInDefault : c.enabled);
          return (
            <button
              key={c.id}
              type="button"
              role="switch"
              aria-label={c.label}
              aria-checked={checked}
              disabled={!loaded || busy !== null}
              onClick={() => void save(c.id, !checked)}
              className="grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-4 text-left transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-zinc-950 disabled:opacity-60"
            >
              <span>
                <span className="block text-sm font-semibold text-zinc-950">
                  {c.label}
                </span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500">
                  {c.description}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`relative h-7 w-12 rounded-full p-1 transition ${checked ? "bg-zinc-950" : "bg-zinc-300"}`}
              >
                <span
                  className={`block h-5 w-5 rounded-full bg-white shadow-sm transition ${checked ? "translate-x-5" : "translate-x-0"}`}
                />
              </span>
            </button>
          );
        })}
      </div>
      {staffBooking && (
        <button
          type="button"
          role="switch"
          aria-checked={staffBooking.enabled}
          disabled={busy !== null}
          onClick={() => void saveStaffBooking()}
          className="flex min-h-16 w-full items-center gap-4 rounded-lg border border-zinc-200 p-4 text-left"
        >
          <span className="flex-1">
            <span className="block text-sm font-semibold">
              Assigned bookings in this salon
            </span>
            <span className="mt-1 block text-xs text-zinc-500">
              Your existing staff booking mute. Both this switch and Booking
              updates must be On.
            </span>
          </span>
          <span className="text-sm font-semibold">
            {staffBooking.enabled ? "On" : "Off"}
          </span>
        </button>
      )}
      <p className="text-xs leading-5 text-zinc-500">
        Check-in uses the role default until you choose On or Off here. Followed
        posts are an opt-in digest, at most once per profile per day. Likes and
        promotions remain off; their delivery is not yet available.
      </p>
    </div>
  );
}
