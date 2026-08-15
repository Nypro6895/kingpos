"use client";

import {
  cancelGuestBookingAction,
  claimGuestBookingAction,
  loadGuestManageSlotsAction,
  rescheduleGuestBookingAction,
} from "@/app/book/actions";
import type { GuestManagePageData, PublicBookingSlot } from "@/lib/public-booking";
import { useState, useTransition } from "react";

type GuestManageClientProps = {
  claimIntent: boolean;
  currentUser: {
    displayName: string | null;
    email: string | null;
    id: string;
  } | null;
  data: GuestManagePageData;
  token: string;
};

const styles = {
  bookingSurface: "public-booking-surface",
  eyebrow: "public-booking-eyebrow",
  field: "public-booking-field",
  pageTitle: "public-booking-page-title",
  primaryButton: "public-booking-primary-button",
  publicCard: "public-booking-card",
  publicRoot: "public-booking-root",
  summary: "public-booking-summary",
} as const;

function classNames(...classes: (false | null | string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: timezone,
    weekday: "short",
  }).format(new Date(value));
}

function dateInputValue(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function ErrorState({ message }: { message: string }) {
  return (
    <main
      className={classNames(styles.bookingSurface, styles.publicRoot, "px-5 py-12")}
      data-booking-surface="manage"
      data-testid="manage-booking-root"
    >
      <section className={classNames(styles.publicCard, "mx-auto max-w-2xl p-6")}>
        <p className={styles.eyebrow}>Booking management</p>
        <h1 className={classNames(styles.pageTitle, "mt-3")}>Link unavailable</h1>
        <p className="mt-3 text-sm text-[#786d78]">{message}</p>
      </section>
    </main>
  );
}

function InspirationBand({
  inspiration,
}: {
  inspiration: Extract<GuestManagePageData, { ok: true }>["booking"]["inspiration"];
}) {
  if (!inspiration) {
    return null;
  }

  return (
    <div className="mt-5 grid gap-3 rounded-lg bg-[#fff0e8] p-3 sm:grid-cols-[80px_1fr]">
      <div className="h-20 w-20 overflow-hidden rounded-lg bg-white">
        {inspiration.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="h-full w-full object-cover" src={inspiration.imageUrl} />
        ) : (
          <span className="grid h-full w-full place-items-center text-sm font-extrabold text-[#f26f3d]">
            Look
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className={styles.eyebrow}>Your inspiration</p>
        <h3 className="mt-1 line-clamp-2 text-base font-extrabold text-[#211c24]">
          {inspiration.source_title_snapshot ?? "Booked look"}
        </h3>
        <p className="mt-1 text-sm font-semibold text-[#f26f3d]">
          {[
            inspiration.service_name_snapshot,
            inspiration.credited_staff_name_snapshot
              ? `By ${inspiration.credited_staff_name_snapshot}`
              : null,
          ]
            .filter(Boolean)
            .join(" / ") || "Saved with this booking"}
        </p>
        {inspiration.source_caption_snapshot ? (
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#786d78]">
            {inspiration.source_caption_snapshot}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function GuestManageClient({
  claimIntent,
  currentUser,
  data,
  token,
}: GuestManageClientProps) {
  if (!data.ok) {
    return <ErrorState message={data.message} />;
  }

  return (
    <GuestManageReady
      claimIntent={claimIntent}
      currentUser={currentUser}
      data={data}
      token={token}
    />
  );
}

function GuestManageReady({
  claimIntent,
  currentUser,
  data,
  token,
}: {
  claimIntent: boolean;
  currentUser: GuestManageClientProps["currentUser"];
  data: Extract<GuestManagePageData, { ok: true }>;
  token: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [isClaimPending, startClaimTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimSaved, setClaimSaved] = useState(false);
  const booking = data.booking.booking;
  const timezone = booking.timezone;
  const [date, setDate] = useState(dateInputValue(booking.startAt, timezone));
  const [slots, setSlots] = useState<PublicBookingSlot[]>(data.slots);
  const [selectedStartAt, setSelectedStartAt] = useState(data.slots[0]?.startAt ?? "");
  const [cancelReason, setCancelReason] = useState("");
  const selectedSlot = slots.find((slot) => slot.startAt === selectedStartAt) ?? null;

  function loadSlots(nextDate: string) {
    setDate(nextDate);
    setError(null);
    startTransition(async () => {
      const nextSlots = await loadGuestManageSlotsAction({
        date: nextDate,
        token,
      });
      setSlots(nextSlots);
      setSelectedStartAt(nextSlots[0]?.startAt ?? "");
    });
  }

  function reschedule() {
    if (!selectedSlot) {
      setError("Choose an available time.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await rescheduleGuestBookingAction({
        startAt: selectedSlot.startAt,
        token,
      });
      if (result.ok) {
        setMessage(result.message);
      } else {
        setError(result.message);
      }
    });
  }

  function cancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelGuestBookingAction({
        reason: cancelReason,
        token,
      });
      if (result.ok) {
        setMessage(result.message);
      } else {
        setError(result.message);
      }
    });
  }

  function claimBooking() {
    setError(null);
    startClaimTransition(async () => {
      const result = await claimGuestBookingAction({ token });

      if (result.ok) {
        if (result.bookingId) {
          const params = new URLSearchParams({ message: result.message });
          window.location.assign(`/my-bookings/${result.bookingId}?${params.toString()}`);
          return;
        }

        setClaimSaved(true);
        setMessage(result.message);
      } else {
        setError(result.message);
      }
    });
  }

  const claimReturnPath = `/booking/manage/${token}?claim=1`;
  const loginHref = `/login?next=${encodeURIComponent(claimReturnPath)}`;
  const signupHref = `/signup?next=${encodeURIComponent(claimReturnPath)}`;

  return (
    <main
      className={classNames(styles.bookingSurface, styles.publicRoot, "px-5 py-8")}
      data-booking-surface="manage"
      data-testid="manage-booking-root"
    >
      <section className="manage-booking-shell">
        <div className="space-y-5">
          <header className={classNames(styles.publicCard, "p-6")}>
            <p className={styles.eyebrow}>Booking management</p>
            <h1 className={classNames(styles.pageTitle, "mt-3")}>{data.booking.salon.name}</h1>
            <p className="mt-2 text-sm text-[#786d78]">
              {formatDate(booking.startAt, timezone)}
            </p>
          </header>

          {message ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <section className={classNames(styles.publicCard, "p-5")}>
            <h2 className="text-xl font-extrabold text-[#211c24]">
              Save this booking
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#786d78]">
              Sign in or create an account to keep this appointment with your saved
              bookings. This link only proves access to this booking.
            </p>
            {currentUser ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className={classNames(styles.primaryButton, "px-4")}
                  disabled={isClaimPending || claimSaved}
                  onClick={claimBooking}
                  type="button"
                >
                  {claimSaved
                    ? "Saved to account"
                    : isClaimPending
                      ? "Saving..."
                      : claimIntent
                        ? "Save booking to account"
                        : "Save to account"}
                </button>
                <span className="text-sm font-medium text-[#786d78]">
                  Signed in as {currentUser.displayName ?? currentUser.email ?? "your account"}
                </span>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-3">
                <a className={classNames(styles.primaryButton, "px-4")} href={loginHref}>
                  Sign in
                </a>
                <a className="rounded-md border border-[#ffd6c4] px-4 py-2 text-sm font-extrabold text-[#f26f3d]" href={signupHref}>
                  Create account
                </a>
              </div>
            )}
          </section>

          <section className={classNames(styles.publicCard, "p-5")}>
            <h2 className="text-xl font-extrabold text-[#211c24]">Appointment</h2>
            <ul className="mt-4 divide-y divide-zinc-200">
              {data.booking.lines.map((line) => (
                <li className="flex justify-between gap-4 py-3" key={line.serviceId}>
                  <span>
                    <span className="block font-medium">{line.serviceName}</span>
                    <span className="text-sm text-zinc-500">{line.staffName}</span>
                  </span>
                  <span className="text-sm text-zinc-600">
                    {formatDate(line.startAt, timezone)}
                  </span>
                </li>
              ))}
            </ul>
            <InspirationBand inspiration={data.booking.inspiration} />
          </section>

          {booking.canChange ? (
            <section className={classNames(styles.publicCard, "p-5")}>
              <h2 className="text-xl font-extrabold text-[#211c24]">Reschedule</h2>
              <label className="mt-4 block max-w-xs">
                <span className="text-sm font-medium text-zinc-700">Date</span>
                <input
                  className={classNames(styles.field, "mt-2 w-full")}
                  onChange={(event) => loadSlots(event.target.value)}
                  type="date"
                  value={date}
                />
              </label>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {slots.map((slot) => (
                  <button
                    className={
                      selectedStartAt === slot.startAt
                        ? "rounded-xl border border-[#f26f3d] bg-[#f26f3d] px-3 py-2 text-sm font-extrabold text-white"
                        : "rounded-xl border border-[#f0e6df] px-3 py-2 text-sm font-extrabold hover:border-[#ffd6c4]"
                    }
                    key={slot.startAt}
                    onClick={() => setSelectedStartAt(slot.startAt)}
                    type="button"
                  >
                    {new Intl.DateTimeFormat("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: timezone,
                    }).format(new Date(slot.startAt))}
                  </button>
                ))}
              </div>
              {slots.length === 0 ? (
                <p className="mt-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
                  No matching slots are available on this date.
                </p>
              ) : null}
              <button
                className={classNames(styles.primaryButton, "mt-5 px-4")}
                disabled={isPending || !selectedSlot}
                onClick={reschedule}
                type="button"
              >
                {isPending ? "Saving..." : "Reschedule"}
              </button>
            </section>
          ) : null}

          {booking.canChange ? (
            <section className={classNames(styles.publicCard, "p-5")}>
              <h2 className="text-xl font-extrabold text-[#211c24]">Cancel booking</h2>
              <label className="mt-4 block">
                <span className="text-sm font-medium text-zinc-700">Reason</span>
                <textarea
                  className="mt-2 min-h-20 w-full rounded-xl border border-[#f0e6df] px-3 py-2 text-sm"
                  onChange={(event) => setCancelReason(event.target.value)}
                  value={cancelReason}
                />
              </label>
              <button
                className="mt-4 rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
                disabled={isPending}
                onClick={cancel}
                type="button"
              >
                Cancel booking
              </button>
            </section>
          ) : null}
        </div>

        <aside
          className={classNames(styles.publicCard, styles.summary)}
          data-testid="manage-booking-summary"
        >
          <h2 className="text-lg font-extrabold text-[#211c24]">Details</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Status</dt>
              <dd className="font-medium capitalize">{booking.status.replaceAll("_", " ")}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Customer</dt>
              <dd className="font-medium">{data.booking.customer.name ?? "-"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Phone</dt>
              <dd className="font-medium">{data.booking.customer.phone ?? "-"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500">Email</dt>
              <dd className="font-medium">{data.booking.customer.email ?? "-"}</dd>
            </div>
          </dl>
        </aside>
      </section>
    </main>
  );
}
