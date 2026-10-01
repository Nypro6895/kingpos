"use client";

import {
  cancelCustomerBookingAction,
  loadCustomerRescheduleSlotsAction,
  rescheduleCustomerBookingAction,
} from "@/app/my-bookings/actions";
import styles from "@/components/booking-ui/booking-theme.module.css";
import type { CustomerBookingDetail } from "@/lib/customer-bookings";
import type { PublicBookingSlot } from "@/lib/public-booking";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

type BookingDetailActionsProps = {
  booking: CustomerBookingDetail;
  canBookAgain: boolean;
  canChange: boolean;
  canViewSalon: boolean;
};

type ModalShellProps = {
  children: ReactNode;
  descriptionId?: string;
  onClose: () => void;
  open: boolean;
  titleId: string;
};

type SlotState =
  | {
      message: string;
      ok: false;
    }
  | {
      slots: PublicBookingSlot[];
      ok: true;
    };

function classNames(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function statusText(value: string) {
  return value.replaceAll("_", " ");
}

function formatDate(value: string, timezone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: timezone,
    weekday: "long",
  }).format(date);
}

function formatTime(value: string, timezone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

function formatTimeRange(startAt: string, endAt: string, timezone: string) {
  return `${formatTime(startAt, timezone)} - ${formatTime(endAt, timezone)}`;
}

function formatDateInputValue(value: string, timezone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function directionsHref(booking: CustomerBookingDetail) {
  const salon = booking.salon;
  const query = [
    salon?.address_line1,
    salon?.address_line2,
    salon?.city,
    salon?.state,
    salon?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");

  if (!query) {
    return null;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function contactLinks(booking: CustomerBookingDetail) {
  const links: Array<{
    href: string;
    label: string;
    target?: "_blank";
  }> = [];
  const phone = booking.salon?.phone?.replace(/[^\d+]/g, "");
  const email = booking.salon?.email?.trim();
  const directions = directionsHref(booking);

  if (phone) {
    links.push({ href: `tel:${phone}`, label: "Call salon" });
  }

  if (email) {
    links.push({ href: `mailto:${email}`, label: "Email salon" });
  }

  if (directions) {
    links.push({ href: directions, label: "Directions", target: "_blank" });
  }

  return links;
}

function ModalShell({
  children,
  descriptionId,
  onClose,
  open,
  titleId,
}: ModalShellProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const focusable = Array.from(
      modalRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    );
    focusable[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#211c24]/45 px-3 py-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-[0_26px_70px_rgba(33,28,36,0.22)] outline-none"
        ref={modalRef}
        role="dialog"
      >
        {children}
      </div>
    </div>
  );
}

function EmptySlotState({
  booking,
  message,
}: {
  booking: CustomerBookingDetail;
  message: string;
}) {
  const links = contactLinks(booking);

  return (
    <div className="rounded-xl bg-[#fff0e8] p-4 text-sm text-[#f26f3d]">
      <p className="font-extrabold">{message}</p>
      {links.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {links.map((link) => (
            <a
              className={classNames(styles.secondaryButton, "px-3")}
              href={link.href}
              key={link.label}
              rel={link.target ? "noreferrer" : undefined}
              target={link.target}
            >
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RescheduleModal({
  booking,
  onClose,
  open,
}: {
  booking: CustomerBookingDetail;
  onClose: () => void;
  open: boolean;
}) {
  const router = useRouter();
  const timezone = booking.salon_timezone_snapshot || "America/Chicago";
  const [date, setDate] = useState(() => formatDateInputValue(booking.start_at, timezone));
  const [slotState, setSlotState] = useState<SlotState | null>(null);
  const [selectedStartAt, setSelectedStartAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isSubmitting, startSubmitting] = useTransition();
  const selectedSlot =
    slotState?.ok === true
      ? slotState.slots.find((slot) => slot.startAt === selectedStartAt) ?? null
      : null;

  useEffect(() => {
    if (!open || !date) {
      return;
    }

    let active = true;
    startLoading(async () => {
      const result = await loadCustomerRescheduleSlotsAction({
        bookingId: booking.id,
        date,
      });

      if (!active) {
        return;
      }

      if (result.ok) {
        setSlotState({ ok: true, slots: result.data.slots });
        setSelectedStartAt(result.data.slots[0]?.startAt ?? null);
      } else {
        setSlotState({ ok: false, message: result.message });
      }
    });

    return () => {
      active = false;
    };
  }, [booking.id, date, open]);

  function confirmReschedule() {
    if (!selectedStartAt) {
      setNotice("Choose an available time.");
      return;
    }

    setNotice(null);
    startSubmitting(async () => {
      const result = await rescheduleCustomerBookingAction({
        bookingId: booking.id,
        startAt: selectedStartAt,
      });

      if (!result.ok) {
        setNotice(result.message);
        return;
      }

      const params = new URLSearchParams({ message: result.message });
      onClose();
      router.replace(`/my-bookings/${booking.id}?${params.toString()}`);
      router.refresh();
    });
  }

  return (
    <ModalShell
      descriptionId="reschedule-description"
      onClose={onClose}
      open={open}
      titleId="reschedule-title"
    >
      <div className="grid gap-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold text-[#211c24]" id="reschedule-title">
              Reschedule appointment
            </h2>
            <p className="mt-1 text-sm leading-6 text-[#786d78]" id="reschedule-description">
              Pick from times the salon can currently support for the same services and professionals.
            </p>
          </div>
          <button
            aria-label="Close reschedule"
            className={classNames(styles.iconButton, "shrink-0")}
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </div>

        <div className="rounded-xl border border-[#f0e6df] p-4">
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#e85f2b]">
            Current appointment
          </p>
          <p className="mt-2 font-extrabold text-[#211c24]">
            {formatDate(booking.start_at, timezone)}
          </p>
          <p className="mt-1 text-sm text-[#786d78]">
            {formatTimeRange(booking.start_at, booking.end_at, timezone)}
          </p>
        </div>

        <label className="grid gap-2">
          <span className="text-sm font-extrabold text-[#211c24]">New date</span>
          <input
            className={classNames(styles.field, "h-11")}
            onChange={(event) => {
              setDate(event.target.value);
              setSlotState(null);
              setSelectedStartAt(null);
              setNotice(null);
            }}
            type="date"
            value={date}
          />
        </label>

        <div aria-live="polite" className="min-h-10">
          {isLoading ? (
            <p className="text-sm font-semibold text-[#786d78]">Checking available times...</p>
          ) : slotState?.ok === false ? (
            <EmptySlotState booking={booking} message={slotState.message} />
          ) : slotState?.ok === true && slotState.slots.length === 0 ? (
            <EmptySlotState
              booking={booking}
              message="No matching online times are available on this date."
            />
          ) : null}
        </div>

        {slotState?.ok === true && slotState.slots.length > 0 ? (
          <div className="grid gap-3">
            <p className="text-sm font-extrabold text-[#211c24]">Available times</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {slotState.slots.map((slot) => (
                <button
                  aria-pressed={selectedStartAt === slot.startAt}
                  className={classNames(
                    "min-h-11 rounded-xl border px-3 text-sm font-extrabold transition",
                    selectedStartAt === slot.startAt
                      ? "border-[#f26f3d] bg-[#f26f3d] text-white"
                      : "border-[#ffd6c4] bg-white text-[#211c24] hover:border-[#e85f2b]",
                  )}
                  data-slot-start={slot.startAt}
                  key={slot.startAt}
                  onClick={() => setSelectedStartAt(slot.startAt)}
                  type="button"
                >
                  {slot.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {selectedSlot ? (
          <div className="rounded-xl bg-[#fff0e8] p-4 text-sm">
            <p className="font-extrabold text-[#f26f3d]">New appointment</p>
            <p className="mt-1 text-[#211c24]">
              {formatDate(selectedSlot.startAt, timezone)},{" "}
              {formatTimeRange(selectedSlot.startAt, selectedSlot.endAt, timezone)}
            </p>
          </div>
        ) : null}

        {notice ? (
          <p aria-live="assertive" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">
            {notice}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className={classNames(styles.secondaryButton, "px-4")}
            onClick={onClose}
            type="button"
          >
            Keep current time
          </button>
          <button
            className={classNames(styles.primaryButton, "px-5")}
            disabled={!selectedStartAt || isSubmitting}
            onClick={confirmReschedule}
            type="button"
          >
            {isSubmitting ? "Confirming..." : "Confirm reschedule"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CancelModal({
  booking,
  onClose,
  open,
}: {
  booking: CustomerBookingDetail;
  onClose: () => void;
  open: boolean;
}) {
  const router = useRouter();
  const timezone = booking.salon_timezone_snapshot || "America/Chicago";
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmCancel() {
    setNotice(null);
    startTransition(async () => {
      const result = await cancelCustomerBookingAction({
        bookingId: booking.id,
        reason,
      });

      if (!result.ok) {
        setNotice(result.message);
        return;
      }

      const params = new URLSearchParams({ message: result.message });
      onClose();
      router.replace(`/my-bookings/${booking.id}?${params.toString()}`);
      router.refresh();
    });
  }

  return (
    <ModalShell
      descriptionId="cancel-description"
      onClose={onClose}
      open={open}
      titleId="cancel-title"
    >
      <div className="grid gap-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-extrabold text-[#211c24]" id="cancel-title">
              Cancel this appointment?
            </h2>
            <p className="mt-1 text-sm leading-6 text-[#786d78]" id="cancel-description">
              This will cancel the appointment with {booking.salon?.displayName ?? "the salon"}.
            </p>
          </div>
          <button
            aria-label="Close cancellation"
            className={classNames(styles.iconButton, "shrink-0")}
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </div>

        <div className="rounded-xl border border-[#f0e6df] p-4">
          <p className="font-extrabold text-[#211c24]">
            {formatDate(booking.start_at, timezone)}
          </p>
          <p className="mt-1 text-sm text-[#786d78]">
            {formatTimeRange(booking.start_at, booking.end_at, timezone)}
          </p>
        </div>

        <label className="grid gap-2">
          <span className="text-sm font-extrabold text-[#211c24]">Reason optional</span>
          <textarea
            className="min-h-24 rounded-xl border border-[#f0e6df] px-3 py-2 text-sm text-[#211c24] outline-none focus:border-[#e85f2b] focus:ring-4 focus:ring-[#f26f3d]/10"
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </label>

        {notice ? (
          <p aria-live="assertive" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">
            {notice}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className={classNames(styles.secondaryButton, "px-4")}
            onClick={onClose}
            type="button"
          >
            Keep appointment
          </button>
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-5 text-sm font-extrabold text-red-700 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            onClick={confirmCancel}
            type="button"
          >
            {isPending ? "Cancelling..." : "Confirm cancellation"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export function BookingDetailActions({
  booking,
  canBookAgain,
  canChange,
  canViewSalon,
}: BookingDetailActionsProps) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const contactOptions = useMemo(() => contactLinks(booking), [booking]);
  const upcoming = canChange;

  return (
    <>
      <aside className="lg:sticky lg:top-6">
        <div className="rounded-2xl border border-[#f0e6df] bg-white p-4 shadow-[0_1px_0_rgba(33,28,36,0.03)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-[#211c24]">
                Manage appointment
              </h2>
              <p className="mt-1 text-xs font-semibold capitalize text-[#786d78]">
                {statusText(booking.status)}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            {upcoming ? (
              <button
                className={classNames(styles.primaryButton, "w-full px-4")}
                onClick={() => setRescheduleOpen(true)}
                type="button"
              >
                Reschedule
              </button>
            ) : null}

            {canBookAgain ? (
              <Link
                className={classNames(styles.primaryButton, "w-full px-4")}
                href={`/book/${booking.salon_id}`}
              >
                Book again
              </Link>
            ) : null}

            {contactOptions.length > 0 ? (
              <button
                aria-expanded={contactOpen}
                className={classNames(styles.secondaryButton, "w-full px-4")}
                onClick={() => setContactOpen((current) => !current)}
                type="button"
              >
                Contact salon
              </button>
            ) : null}

            {contactOpen ? (
              <div className="grid gap-2 rounded-xl bg-[#fff0e8] p-2">
                {contactOptions.map((link) => (
                  <a
                    className="rounded-lg px-3 py-2 text-sm font-extrabold text-[#f26f3d] hover:bg-white"
                    href={link.href}
                    key={link.label}
                    rel={link.target ? "noreferrer" : undefined}
                    target={link.target}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}

            {canViewSalon ? (
              <Link
                className={classNames(styles.secondaryButton, "w-full px-4")}
                href={`/explore/salons/${booking.salon_id}`}
              >
                View salon
              </Link>
            ) : null}

            {upcoming ? (
              <button
                className="mt-1 min-h-10 rounded-xl px-4 text-sm font-extrabold text-red-700 transition hover:bg-red-50"
                onClick={() => setCancelOpen(true)}
                type="button"
              >
                Cancel appointment
              </button>
            ) : null}
          </div>

          {upcoming ? (
            <p className="mt-4 text-xs leading-5 text-[#786d78]">
              Changes are confirmed only after salon live availability is checked.
            </p>
          ) : null}
        </div>
      </aside>

      <RescheduleModal
        booking={booking}
        onClose={() => setRescheduleOpen(false)}
        open={rescheduleOpen}
      />
      <CancelModal
        booking={booking}
        onClose={() => setCancelOpen(false)}
        open={cancelOpen}
      />
    </>
  );
}
