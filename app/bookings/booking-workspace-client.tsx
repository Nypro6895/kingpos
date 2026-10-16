"use client";
import { ActionFeedback } from "@/components/action-feedback";
import { BookingDepositReceipt } from "@/components/booking-deposit-receipt";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { TimeZoneSelect } from "@/components/time-zone-select";
import { ContextualSupport } from "@/components/contextual-support";

import { SettingsIcon as SharedSettingsIcon } from "@/components/settings-icon";
import "./booking-workspace.css";
import { SchedulePicker } from "@/components/booking-ui/schedule-picker";
import { useCloseOnNavigation, useOverlayPortalHost } from "@/components/overlay-dismissal";
import { HistoryLinkControl } from "@/app/activity/history-link-control";
import { useBookingClock } from "@/components/booking-ui/use-booking-clock";
import { confirmNoShowHistory } from "@/components/booking-ui/no-show-confirmation";
import { bookingStatusLabel } from "@/lib/booking-no-show";
import { getSalonOnlineBookingStatus } from "@/lib/booking-status";

async function reviewBeforeConfirm<T extends { acknowledgeNoShow?: boolean }>(action: (input: T) => Promise<BookingActionResult>, input: T) {
  const result = await action(input);
  if (!result.noShowHistory?.length) return result;
  if (!await confirmNoShowHistory(result.noShowHistory)) return {ok:false,message:"Confirmation cancelled. The appointment is unchanged."};
  return action({...input,acknowledgeNoShow:true});
}
const runBookingStatusAction = (input: Parameters<typeof rawRunBookingStatusAction>[0]) => reviewBeforeConfirm(rawRunBookingStatusAction, input);
const saveOwnerWorkspaceBookingAction = (input: Parameters<typeof rawSaveOwnerWorkspaceBookingAction>[0]) => reviewBeforeConfirm(rawSaveOwnerWorkspaceBookingAction, input);


import {
  createBookingPosTicketAction,
  createQuickSetupStaffAction,
  createOwnerAppointmentAction,
  reassignOwnerBookingAction,
  rescheduleOwnerBookingAction,
  runBookingStatusAction as rawRunBookingStatusAction,
  saveOwnerWorkspaceBookingAction as rawSaveOwnerWorkspaceBookingAction,
  replaceOwnerBookingServicesAction,
  updateBookingSettingsAction,
  updateQuickSetupAssignmentAction,
  updateQuickSetupServiceOnlineAction,
  updateQuickSetupStaffOnlineAction,
  type BookingActionResult,
  type CreateOwnerAppointmentInput,
  type UpdateBookingSettingsInput,
} from "@/app/bookings/actions";
import {
  createStaffTimeBlockAction,
  saveStaffWeeklyAvailabilityAction,
  type BookingSetupActionResult,
} from "@/app/booking-setup/actions";
import { createServiceAction } from "@/app/services/actions";
import { StaffAvailabilityEditor } from "@/app/booking-setup/booking-setup-editors";
import type {
  BookingWorkspaceData,
  BookingWorkspaceFilters,
  BookingWorkspaceItem,
  BookingWorkspaceRequest,
} from "@/lib/bookings";
import type { StaffBookingReadiness } from "@/lib/booking-setup";
import { searchTextMatches } from "@/lib/search-normalization";
import type {
  BookingConfirmationMode,
  BookingSource,
  BookingStatusEvent,
  BookingTicketCreationMode,
} from "@/types/booking";
import { BOOKING_SOURCES } from "@/types/booking";
import type { SaveServiceConfigsResult } from "@/types/service";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type BookingWorkspaceClientProps = Omit<BookingWorkspaceData, "context"> & {
  accountName: string;
  publicBookingHref: string;
  salonName: string;
};

type DraftLine = {
  serviceId: string;
  staffId: string;
};

type DraftPrefill = {
  customerUserId?: string | null;
  internalNotes?: string | null;
  serviceId?: string | null;
  source?: BookingSource;
  sourceReferenceId?: string | null;
  sourceReferenceType?: string | null;
  staffId?: string | null;
  startLocal?: string | null;
};

type QuickSetupPanelId = "hours" | "professionals" | "rules" | "services";

const STATUS_LABELS: Record<string, string> = {
  cancelled: "Cancelled",
  checked_in: "Arrived",
  completed: "Completed",
  confirmed: "Confirmed",
  in_service: "In service",
  no_show: "No-show",
  pending: "Pending",
  scheduled: "Confirmed",
};

const SOURCE_LABELS: Record<BookingSource, string> = {
  explore: "Explore",
  legacy_request: "Legacy request",
  owner_manual: "Owner manual",
  phone: "Phone",
  pos: "POS",
  public_profile: "Salon profile booking",
  staff_manual: "Staff manual",
  walk_in: "Walk-in",
};



const styles = {
  avatar: "booking-avatar",
  avatarImage: "booking-avatar-image",
  avatarSmall: "booking-avatar-small",
  bookingSurface: "booking-surface",
  eyebrow: "booking-eyebrow",
  field: "booking-field",
  filterDetails: "booking-filter-details",
  filterMenu: "booking-filter-menu",
  iconButton: "booking-icon-button",
  ownerActionRow: "booking-owner-action-row",
  ownerContent: "booking-owner-content",
  ownerFrame: "booking-owner-frame",
  ownerHeader: "booking-owner-header",
  ownerRoot: "booking-owner-root",
  panel: "booking-panel",
  primaryButton: "booking-primary-button",
  searchInput: "booking-search-input",
  secondaryButton: "booking-secondary-button",
  select: "booking-select",
  statusArrived: "booking-status-arrived",
  statusBadge: "booking-status-badge",
  statusChip: "booking-status-chip",
  statusChipActive: "booking-status-chip-active",
  statusConfirmed: "booking-status-confirmed",
  statusInService: "booking-status-in-service",
  statusMuted: "booking-status-muted",
  statusPending: "booking-status-pending",
  statusRow: "booking-status-row",
  tab: "booking-tab",
  tabActive: "booking-tab-active",
  tabCount: "booking-tab-count",
  tabsScroller: "booking-tabs-scroller",
  table: "booking-table",
  tableHeader: "booking-table-header",
  tableRow: "booking-table-row",
  tabs: "booking-tabs",
  toolbar: "booking-toolbar",
  toolbarDate: "booking-toolbar-date",
  workspaceCard: "booking-workspace-card",
} as const;

const TICKET_CREATION_MODE_LABELS: Record<BookingTicketCreationMode, string> = {
  manual: "Manual",
  on_check_in: "On check-in",
  on_service_start: "On service start",
};

function classNames(...classes: (false | null | string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatMinutes(value: number) {
  if (value < 60) {
    return `${value} min`;
  }

  const hours = Math.floor(value / 60);
  const remaining = value % 60;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
}

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
  }).format(new Date(value));
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function dateParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${getPart("year")}-${getPart("month")}-${getPart("day")}`,
    time: `${getPart("hour")}:${getPart("minute")}`,
  };
}

function toLocalInputValue(value: string | null | undefined, timeZone: string) {
  if (!value) {
    return "";
  }

  const parts = dateParts(value, timeZone);
  return `${parts.date}T${parts.time}`;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number) => value.toString().padStart(2, "0");

  return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(
    utcDate.getUTCDate(),
  )}`;
}



function todayInTimeZone(timeZone: string) {
  return dateParts(new Date().toISOString(), timeZone).date;
}

function timeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const getPart = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    day: getPart("day"),
    hour: getPart("hour"),
    minute: getPart("minute"),
    month: getPart("month"),
    second: getPart("second"),
    year: getPart("year"),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = timeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}

function zonedDateTimeToUtcIso(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const firstOffset = timeZoneOffsetMs(utcGuess, timeZone);
  const firstResult = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = timeZoneOffsetMs(firstResult, timeZone);

  return new Date(utcGuess.getTime() - secondOffset).toISOString();
}

function idempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `booking-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sourceLabel(source: BookingSource) {
  return SOURCE_LABELS[source] ?? source;
}

function initialsFor(value: string | null | undefined) {
  const parts = (value ?? "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return "K";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function safeImageUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.startsWith("http://") || value.startsWith("https://") ? value : null;
}

function StaffAvatar({
  imageUrl,
  label,
  size = "regular",
}: {
  imageUrl?: string | null;
  label: string | null | undefined;
  size?: "regular" | "small";
}) {
  const __vt = useWorkspaceTranslation();

  const src = safeImageUrl(imageUrl);

  return (
    <span
      className={size === "small" ? styles.avatarSmall : styles.avatar}
      title={__vt(label ?? "Staff")}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={__vt("")} className={styles.avatarImage} src={src} />
      ) : (
        initialsFor(label)
      )}
    </span>
  );
}

function selectedDateBookings(
  bookings: BookingWorkspaceItem[],
  date: string,
  timezone: string,
) {
  return bookings.filter(
    (booking) => dateParts(booking.start_at, timezone).date === date,
  );
}

function activeBooking(booking: BookingWorkspaceItem) {
  return (
    booking.normalizedStatus !== "cancelled" &&
    booking.normalizedStatus !== "no_show"
  );
}

const QUICK_SETUP_DAYS = [
  { id: 0, label: "Sun" },
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
] as const;

function settingsToInput(
  settings: BookingWorkspaceClientProps["settings"],
): UpdateBookingSettingsInput {
  return {
    anyProfessionalEnabled: settings.any_professional_enabled,
    autoAssignEnabled: settings.auto_assign_enabled !== false,
    reminderEnabled: settings.reminder_enabled !== false,
    confirmationEmailEnabled: settings.confirmation_email_enabled !== false,
    confirmationSmsEnabled: settings.confirmation_sms_enabled !== false,
    bookingEnabled: settings.booking_enabled,
    cancellationWindowMinutes: settings.cancellation_window_minutes,
    confirmationMode: settings.confirmation_mode,
    defaultCleanupBufferMinutes: settings.default_cleanup_buffer_minutes,
    guestBookingEnabled: settings.guest_booking_enabled,
    maximumAdvanceWindowDays: settings.maximum_advance_window_days,
    minimumLeadTimeMinutes: settings.minimum_lead_time_minutes,
    onlineBookingVisible: settings.online_booking_visible,
    sameDayBookingEnabled: settings.same_day_booking_enabled,
    slotIntervalMinutes: settings.slot_interval_minutes,
    splitStaffAppointmentEnabled: settings.split_staff_appointment_enabled,
    ticketCreationMode: settings.ticket_creation_mode,
    timezoneIana: settings.timezone_iana,
  };
}

function assignmentKey(serviceId: string, staffId: string) {
  return `${serviceId}:${staffId}`;
}

function assignmentEnabled(
  options: BookingWorkspaceClientProps["options"],
  serviceId: string,
  staffId: string,
) {
  return options.assignments.some(
    (assignment) =>
      assignment.service_id === serviceId &&
      assignment.staff_id === staffId &&
      assignment.is_active &&
      assignment.online_bookable,
  );
}

function assignmentValue(input: {
  overrides: Record<string, boolean>;
  options: BookingWorkspaceClientProps["options"];
  serviceId: string;
  staffId: string;
}) {
  const key = assignmentKey(input.serviceId, input.staffId);

  return input.overrides[key] ?? assignmentEnabled(
    input.options,
    input.serviceId,
    input.staffId,
  );
}

function serviceStaffIds(
  options: BookingWorkspaceClientProps["options"],
  overrides: Record<string, boolean>,
  serviceId: string,
) {
  return options.staff
    .filter((member) =>
      assignmentValue({
        options,
        overrides,
        serviceId,
        staffId: member.id,
      }),
    )
    .map((member) => member.id);
}

function staffServiceIds(
  options: BookingWorkspaceClientProps["options"],
  overrides: Record<string, boolean>,
  staffId: string,
) {
  return options.services
    .filter((service) =>
      assignmentValue({
        options,
        overrides,
        serviceId: service.id,
        staffId,
      }),
    )
    .map((service) => service.id);
}

function staffBookingReady(member: BookingWorkspaceClientProps["options"]["staff"][number]) {
  return member.is_active && member.online_booking_enabled;
}

function formatLocalClock(value: string) {
  const [hours = "0", minutes = "0"] = value.slice(0, 5).split(":");
  const hourNumber = Number(hours);
  const minuteNumber = Number(minutes);

  if (!Number.isFinite(hourNumber) || !Number.isFinite(minuteNumber)) {
    return value.slice(0, 5);
  }

  const suffix = hourNumber >= 12 ? "PM" : "AM";
  const displayHour = hourNumber % 12 || 12;

  return minuteNumber === 0
    ? `${displayHour} ${suffix}`
    : `${displayHour}:${String(minuteNumber).padStart(2, "0")} ${suffix}`;
}

function workingRulesForStaff(
  options: BookingWorkspaceClientProps["options"],
  staffId: string,
) {
  const activeRules = options.availabilityRules.filter(
    (rule) => rule.is_active && rule.rule_type === "working",
  );
  const staffRules = activeRules.filter((rule) => rule.staff_id === staffId);
  const rules = staffRules.length > 0
    ? staffRules
    : activeRules.filter((rule) => !rule.staff_id);

  return rules
    .sort(
      (left, right) =>
        left.day_of_week - right.day_of_week ||
        left.starts_at_local.localeCompare(right.starts_at_local),
    );
}

function breakRulesForStaff(
  options: BookingWorkspaceClientProps["options"],
  staffId: string,
) {
  const activeRules = options.availabilityRules.filter(
    (rule) => rule.is_active && rule.rule_type === "break",
  );
  const staffRules = activeRules.filter((rule) => rule.staff_id === staffId);
  const rules = staffRules.length > 0
    ? staffRules
    : activeRules.filter((rule) => !rule.staff_id);

  return rules
    .sort(
      (left, right) =>
        left.day_of_week - right.day_of_week ||
        left.starts_at_local.localeCompare(right.starts_at_local),
    );
}

function summarizeStaffHours(
  options: BookingWorkspaceClientProps["options"],
  staffId: string,
) {
  const rules = workingRulesForStaff(options, staffId);

  if (rules.length === 0) {
    return "No bookable hours";
  }

  const days = QUICK_SETUP_DAYS.filter((day) =>
    rules.some((rule) => rule.day_of_week === day.id),
  );
  const firstDayRules = rules.filter((rule) => rule.day_of_week === days[0]?.id);
  const firstSummary = firstDayRules
    .map(
      (rule) =>
        `${formatLocalClock(rule.starts_at_local)}-${formatLocalClock(
          rule.ends_at_local,
        )}`,
    )
    .join(", ");
  const sameHours = days.every((day) => {
    const summary = rules
      .filter((rule) => rule.day_of_week === day.id)
      .map(
        (rule) =>
          `${formatLocalClock(rule.starts_at_local)}-${formatLocalClock(
            rule.ends_at_local,
          )}`,
      )
      .join(", ");

    return summary === firstSummary;
  });
  const visibleDays = days.map((day) => day.label).slice(0, 4).join(", ");
  const extra = days.length > 4 ? ` +${days.length - 4}` : "";

  return sameHours
    ? `${visibleDays}${extra}, ${firstSummary}`
    : `${days.length} available day${days.length === 1 ? "" : "s"}`;
}

function summarizeBookingHours(options: BookingWorkspaceClientProps["options"]) {
  const staffWithHours = options.staff.filter(
    (member) => member.is_active && staffHasWorkingHours(options, member.id),
  ).length;

  if (staffWithHours === 0) {
    return "No professional hours";
  }

  return `${staffWithHours} professional${staffWithHours === 1 ? "" : "s"} with hours`;
}

function upcomingTimeOffBlocks(
  options: BookingWorkspaceClientProps["options"],
  staffId: string,
) {
  const nowMs = Date.now();

  return options.timeBlocks
    .filter(
      (block) =>
        block.is_active !== false &&
        block.block_type === "time_off" &&
        block.staff_id === staffId &&
        new Date(block.ends_at).getTime() >= nowMs,
    )
    .sort(
      (left, right) =>
        new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime(),
    );
}

function formatDateOnly(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(value));
}

function formatTimeOffRange(
  block: BookingWorkspaceClientProps["options"]["timeBlocks"][number],
  timeZone: string,
) {
  const start = formatDateOnly(block.starts_at, timeZone);
  const end = formatDateOnly(block.ends_at, timeZone);

  return start === end ? start : `${start} - ${end}`;
}

function bookingRulesSummary(settings: BookingWorkspaceClientProps["settings"]) {
  return `${formatMinutes(settings.minimum_lead_time_minutes)} notice / ${
    settings.maximum_advance_window_days
  } days ahead`;
}

function InlineActionMessage({
  result,
}: {
  result:
    | BookingActionResult
    | BookingSetupActionResult
    | SaveServiceConfigsResult
    | null;
}) {
  if (!result) {
    return null;
  }

  const message =
    "message" in result
      ? result.message
      : result.ok
        ? "Saved."
        : result.error ?? "Could not save.";

  return (
    <p
      className={classNames(
        "rounded-lg border px-3 py-2 text-sm",
        result.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-800",
      )}
      role="status"
    >
      <WorkspaceText text={message} />
    </p>
  );
}

function MiniSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  const __vt = useWorkspaceTranslation();

  return (
    <button
      aria-checked={checked}
      aria-label={__vt(label)}
      className={classNames(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition",
        checked
          ? "border-[#f26f3d] bg-[#f26f3d]"
          : "border-[#ffd6c4] bg-[#fff0e8]",
        disabled && "cursor-not-allowed opacity-50",
      )}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className={classNames(
          "absolute h-5 w-5 rounded-full bg-white shadow-sm transition",
          checked ? "left-6" : "left-1",
        )}
      />
    </button>
  );
}

function QuickSetupCard({
  detail,
  metric,
  onOpen,
  status,
  title,
}: {
  detail: string;
  metric: string;
  onOpen: () => void;
  status?: "attention" | "ready";
  title: string;
}) {
  return (
    <button
      className="booking-setup-row flex w-full items-center justify-between gap-3 border-b border-[#f0e6df] bg-white py-3 text-left transition hover:bg-[#fffaf7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f26f3d]"
      onClick={onOpen}
      type="button"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-extrabold text-[#211c24]"><WorkspaceText text={title} /></span>
          <span className="text-sm font-semibold text-[#786d78]">{metric}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#786d78]">
          {detail}
        </p>
      </div>
      <span
        className={classNames(
          styles.statusBadge,
          status === "attention" ? styles.statusPending : styles.statusArrived,
        )}
      >
        {status === "attention" ? "Needs setup" : <WorkspaceText text="Ready" />}
      </span>
    </button>
  );
}

function QuickSetupDrawerFrame({
  children,
  footer,
  onClose,
  subtitle,
  title,
}: {
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  subtitle: string;
  title: string;
}) {
  const __vt = useWorkspaceTranslation();

  return (
    <ModalFrame label={__vt(title)} onClose={onClose} size="wide">
      <div className="booking-quick-setup-header">
        <div className="min-w-0">
          <h2><WorkspaceText text={title} /></h2>
          <p><WorkspaceText text={subtitle} /></p>
        </div>
        <button
          aria-label={__vt("Close quick setup")}
          className="booking-quick-setup-close"
          onClick={onClose}
          type="button"
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="booking-quick-setup-body">{children}</div>
      {footer ? <div className="booking-quick-setup-footer">{footer}</div> : null}
    </ModalFrame>
  );
}

function QuickCreateServiceCard({
  canManage,
  onCreated,
  onResult,
  options,
}: {
  canManage: boolean;
  onCreated: (serviceId: string | null) => void;
  onResult: (result: SaveServiceConfigsResult) => void;
  options: BookingWorkspaceClientProps["options"];
}) {
  const __vt = useWorkspaceTranslation();

  const [name, setName] = useState("");
  const [price, setPrice] = useState("0");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [onlineBookingEnabled, setOnlineBookingEnabled] = useState(true);
  const [bookingStaffIds, setBookingStaffIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const activeStaff = options.staff.filter((member) => member.is_active);
  const disabled = !canManage || isPending;

  function toggleStaff(staffId: string, checked: boolean) {
    setBookingStaffIds((current) =>
      checked
        ? Array.from(new Set([...current, staffId]))
        : current.filter((id) => id !== staffId),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = name.trim();
    const parsedPrice = Number.parseFloat(price);
    const parsedDuration = Number.parseInt(durationMinutes, 10);

    if (!trimmedName) {
      onResult({ message: "Service name is required.", ok: false });
      return;
    }

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      onResult({ message: "Price must be zero or greater.", ok: false });
      return;
    }

    if (
      !Number.isInteger(parsedDuration) ||
      parsedDuration < 1 ||
      parsedDuration > 1_440
    ) {
      onResult({
        message: "Duration must be between 1 and 1,440 minutes.",
        ok: false,
      });
      return;
    }

    const activeStaffIds = new Set(activeStaff.map((member) => member.id));

    startTransition(async () => {
      const response = await createServiceAction({
        addOnServiceIds: [],
        basePrice: parsedPrice,
        bookingStaffIds: bookingStaffIds.filter((staffId) =>
          activeStaffIds.has(staffId),
        ),
        category: null,
        description: null,
        durationMinutes: parsedDuration,
        isActive: true,
        name: trimmedName,
        onlineBookingEnabled,
      });

      onResult(response);

      if (response.ok) {
        setName("");
        setPrice("0");
        setDurationMinutes("30");
        setBookingStaffIds([]);
        setOnlineBookingEnabled(true);
        onCreated(response.serviceIds[0] ?? null);
      }
    });
  }

  return (
    <form
      className="grid gap-4 rounded-xl border border-[#f0e6df] bg-[#fffaf7] p-4"
      onSubmit={submit}
    >
      <div>
        <p className="text-sm font-extrabold text-[#211c24]">
          <WorkspaceText text="Create quick service" />
        </p>
        <p className="mt-1 text-sm text-[#786d78]">
          <WorkspaceText text="Add the basic service now. Use Advanced settings for categories, add-ons, and longer descriptions." />
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_140px]">
        <label className="grid gap-1">
          <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#786d78]">
            <WorkspaceText text="Service name" />
          </span>
          <input
            className={styles.field}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
            placeholder={__vt("Pedicure Deluxe")}
            value={name}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#786d78]">
            <WorkspaceText text="Price" />
          </span>
          <input
            className={styles.field}
            disabled={disabled}
            inputMode="decimal"
            min="0"
            onChange={(event) => setPrice(event.target.value)}
            type="number"
            value={price}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#786d78]">
            <WorkspaceText text="Minutes" />
          </span>
          <input
            className={styles.field}
            disabled={disabled}
            min="1"
            onChange={(event) => setDurationMinutes(event.target.value)}
            type="number"
            value={durationMinutes}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-[#f0e6df] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-extrabold text-[#211c24]">
            <WorkspaceText text="Show online booking" />
          </p>
          <p className="mt-1 text-xs text-[#786d78]">
            <WorkspaceText text="Keep it on when customers can choose this service." />
          </p>
        </div>
        <MiniSwitch
          checked={onlineBookingEnabled}
          disabled={disabled}
          label={__vt("Online booking for new service")}
          onChange={setOnlineBookingEnabled}
        />
      </div>

      {activeStaff.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-sm font-extrabold text-[#211c24]">
            <WorkspaceText text="Professionals who can take it" />
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {activeStaff.map((member) => (
              <label
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[#f0e6df] bg-white px-3"
                key={member.id}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-extrabold text-[#211c24]">
                    {member.display_name}
                  </span>
                  <span className="block text-xs text-[#786d78]">
                    <WorkspaceText text={staffBookingReady(member) ? "Booking ready" : "Booking off"} />
                  </span>
                </span>
                <input
                  checked={bookingStaffIds.includes(member.id)}
                  disabled={disabled}
                  onChange={(event) =>
                    toggleStaff(member.id, event.target.checked)
                  }
                  type="checkbox"
                />
              </label>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-[#f0e6df] bg-white p-3 text-sm text-[#786d78]">
          <WorkspaceText text="No professionals yet. Create staff in Quick Setup, then match them to this service." />
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={styles.primaryButton}
          disabled={disabled}
          type="submit"
        >
          <WorkspaceText text={isPending ? "Creating..." : "Create service"} />
        </button>
      </div>
    </form>
  );
}

function QuickCreateStaffCard({
  canManageAssignments,
  canManageStaff,
  onCreated,
  onResult,
  options,
}: {
  canManageAssignments: boolean;
  canManageStaff: boolean;
  onCreated: (staffId: string | null) => void;
  onResult: (result: BookingActionResult) => void;
  options: BookingWorkspaceClientProps["options"];
}) {
  const __vt = useWorkspaceTranslation();

  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [onlineBookingEnabled, setOnlineBookingEnabled] = useState(true);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const activeServices = options.services.filter((service) => service.is_active);
  const disabled = !canManageStaff || isPending;

  function toggleService(serviceId: string, checked: boolean) {
    setServiceIds((current) =>
      checked
        ? Array.from(new Set([...current, serviceId]))
        : current.filter((id) => id !== serviceId),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = displayName.trim();

    if (!trimmedName) {
      onResult({
        field: "displayName",
        message: "Professional name is required.",
        ok: false,
      });
      return;
    }

    startTransition(async () => {
      const response = await createQuickSetupStaffAction({
        displayName: trimmedName,
        jobTitle: jobTitle.trim() || null,
        onlineBookingEnabled,
        serviceIds: canManageAssignments ? serviceIds : [],
      });

      onResult(response);

      if (response.ok) {
        setDisplayName("");
        setJobTitle("");
        setOnlineBookingEnabled(true);
        setServiceIds([]);
        onCreated(response.staffId ?? null);
      }
    });
  }

  return (
    <form
      className="grid gap-4 rounded-xl border border-[#f0e6df] bg-[#fffaf7] p-4"
      onSubmit={submit}
    >
      <div>
        <p className="text-sm font-extrabold text-[#211c24]">
          <WorkspaceText text="Create quick professional" />
        </p>
        <p className="mt-1 text-sm text-[#786d78]">
          <WorkspaceText text="Add the basic staff profile now. Use Advanced settings for contact, payroll, and profile details." />
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
        <label className="grid gap-1">
          <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#786d78]">
            <WorkspaceText text="Display name" />
          </span>
          <input
            className={styles.field}
            disabled={disabled}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={__vt("Macy")}
            value={displayName}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#786d78]">
            <WorkspaceText text="Role" />
          </span>
          <input
            className={styles.field}
            disabled={disabled}
            onChange={(event) => setJobTitle(event.target.value)}
            placeholder={__vt("Nail tech")}
            value={jobTitle}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-[#f0e6df] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-extrabold text-[#211c24]">
            <WorkspaceText text="Enable online booking" />
          </p>
          <p className="mt-1 text-xs text-[#786d78]">
            <WorkspaceText text="Customers can choose this professional once hours and services are ready." />
          </p>
        </div>
        <MiniSwitch
          checked={onlineBookingEnabled}
          disabled={disabled}
          label={__vt("Online booking for new professional")}
          onChange={setOnlineBookingEnabled}
        />
      </div>

      {activeServices.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-sm font-extrabold text-[#211c24]">
            <WorkspaceText text="Services they can take" />
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {activeServices.map((service) => {
              const assignmentDisabled =
                disabled || !canManageAssignments || !service.online_booking_enabled;

              return (
                <label
                  className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[#f0e6df] bg-white px-3"
                  key={service.id}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold text-[#211c24]">
                      {service.name}
                    </span>
                    <span className="block text-xs text-[#786d78]">
                      <WorkspaceText text={service.online_booking_enabled
                        ? "Online service"
                        : "Turn service online first"} />
                    </span>
                  </span>
                  <input
                    checked={serviceIds.includes(service.id)}
                    disabled={assignmentDisabled}
                    onChange={(event) =>
                      toggleService(service.id, event.target.checked)
                    }
                    type="checkbox"
                  />
                </label>
              );
            })}
          </div>
          {!canManageAssignments ? (
            <p className="text-xs text-[#786d78]">
              <WorkspaceText text="Service matching is read-only for this account." />
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border border-[#f0e6df] bg-white p-3 text-sm text-[#786d78]">
          <WorkspaceText text="No services yet. Create services in Quick Setup, then match them to this professional." />
        </p>
      )}

      <button className={styles.primaryButton} disabled={disabled} type="submit">
        <WorkspaceText text={isPending ? "Creating..." : "Create professional"} />
      </button>
    </form>
  );
}

function ServicesQuickSetupDrawer({
  canManageAssignments,
  canManageServices,
  initialServiceId,
  onClose,
  options,
}: {
  canManageAssignments: boolean;
  canManageServices: boolean;
  initialServiceId?: string | null;
  onClose: () => void;
  options: BookingWorkspaceClientProps["options"];
}) {
  const __vt = useWorkspaceTranslation();

  
  const [query, setQuery] = useState("");
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(
    initialServiceId && options.services.some((service) => service.id === initialServiceId)
      ? initialServiceId
      : options.services[0]?.id ?? null,
  );
  const [showCreateForm, setShowCreateForm] = useState(
    options.services.length === 0,
  );
  const [serviceOverrides, setServiceOverrides] = useState<Record<string, boolean>>(
    {},
  );
  const [assignmentOverrides, setAssignmentOverrides] = useState<
    Record<string, boolean>
  >({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [result, setResult] = useState<
    BookingActionResult | SaveServiceConfigsResult | null
  >(null);
  const [, startTransition] = useTransition();
  const services = options.services.filter(
    (service) =>
      searchTextMatches([service.name, service.category], query),
  );

  function serviceOnline(service: BookingWorkspaceClientProps["options"]["services"][number]) {
    return serviceOverrides[service.id] ?? service.online_booking_enabled;
  }

  function updateServiceOnline(serviceId: string, next: boolean) {
    setPendingKey(`service:${serviceId}`);
    setResult(null);
    startTransition(async () => {
      const response = await updateQuickSetupServiceOnlineAction({
        onlineBookingEnabled: next,
        serviceId,
      });
      setResult(response);
      setPendingKey(null);

      if (response.ok) {
        setServiceOverrides((current) => ({ ...current, [serviceId]: next }));
        
      }
    });
  }

  function updateAssignment(serviceId: string, staffId: string, selected: boolean) {
    const key = assignmentKey(serviceId, staffId);
    setPendingKey(`assignment:${key}`);
    setResult(null);
    startTransition(async () => {
      const response = await updateQuickSetupAssignmentAction({
        selected,
        serviceId,
        staffId,
      });
      setResult(response);
      setPendingKey(null);

      if (response.ok) {
        setAssignmentOverrides((current) => ({ ...current, [key]: selected }));
        
      }
    });
  }

  return (
    <QuickSetupDrawerFrame
      onClose={onClose}
      subtitle={__vt("Choose which active services appear online and which professionals can receive them.")}
      title={__vt("Services")}
    >
      <div className="grid gap-4">
        <InlineActionMessage result={result} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            className={classNames(styles.secondaryButton, "w-full sm:w-auto")}
            disabled={!canManageServices}
            onClick={() => setShowCreateForm((current) => !current)}
            type="button"
          >
            <WorkspaceText text={showCreateForm ? "Hide quick create" : "Create service"} />
          </button>
          <a className="text-sm font-extrabold text-[#f26f3d]" href="/services">
            <WorkspaceText text="Advanced service settings" />
          </a>
        </div>
        {showCreateForm ? (
          <QuickCreateServiceCard
            canManage={canManageServices}
            onCreated={(serviceId) => {
              setQuery("");
              setExpandedServiceId(serviceId);
              setShowCreateForm(false);
              
            }}
            onResult={setResult}
            options={options}
          />
        ) : null}
        <label className="grid gap-1">
          <span className="sr-only"><WorkspaceText text="Search services" /></span>
          <input
            className={classNames(styles.field, "w-full")}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={__vt("Search services")}
            type="search"
            value={query}
          />
        </label>
        <div className="grid gap-3">
          {services.length === 0 ? (
            <p className="rounded-xl border border-[#f0e6df] bg-[#fffaf7] p-4 text-sm text-[#786d78]">
              <WorkspaceText text="No services match that search. Use quick create above or open advanced service settings." />
            </p>
          ) : null}
          {services.map((service) => {
            const online = serviceOnline(service);
            const assignedStaffIds = serviceStaffIds(
              options,
              assignmentOverrides,
              service.id,
            );
            const expanded = expandedServiceId === service.id;

            return (
              <section
                className="rounded-xl border border-[#f0e6df] bg-white p-4"
                key={service.id}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <button
                    className="min-w-0 text-left"
                    onClick={() =>
                      setExpandedServiceId(expanded ? null : service.id)
                    }
                    type="button"
                  >
                    <span className="block truncate text-base font-extrabold text-[#211c24]">
                      {service.name}
                    </span>
                    <span className="mt-1 block text-sm text-[#786d78]">
                      {formatMoney(Number(service.base_price))} /{" "}
                      {formatMinutes(service.duration_minutes)}
                    </span>
                  </button>
                  <div className="flex items-center gap-3">
                    <span
                      className={classNames(
                        styles.statusBadge,
                        online ? styles.statusArrived : styles.statusMuted,
                      )}
                    >
                      <WorkspaceText text={online ? "Online" : "Off"} />
                    </span>
                    <MiniSwitch
                      checked={online}
                      disabled={
                        !canManageServices ||
                        pendingKey === `service:${service.id}` ||
                        !service.is_active
                      }
                      label={`Online booking for ${service.name}`}
                      onChange={(next) => updateServiceOnline(service.id, next)}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[#786d78]">
                  <span>
                    {assignedStaffIds.length} <WorkspaceText text="professional" />
                    {assignedStaffIds.length === 1 ? "" : "s"}
                  </span>
                  {!service.is_active ? <span><WorkspaceText text="Inactive service" /></span> : null}
                  <a
                    className="font-extrabold text-[#f26f3d]"
                    href={`/services?service=${service.id}`}
                  >
                    <WorkspaceText text="Edit service details" />
                  </a>
                </div>
                {expanded ? (
                  <div className="mt-4 grid gap-2 border-t border-[#f0e6df] pt-4">
                    <p className="text-sm font-extrabold text-[#211c24]">
                      <WorkspaceText text="Available professionals" />
                    </p>
                    {options.staff.length === 0 ? (
                      <p className="rounded-lg border border-[#f0e6df] bg-[#fffaf7] p-3 text-sm text-[#786d78]">
                        <WorkspaceText text="No professionals yet. Create staff from the Professionals quick setup card before matching this service." />
                      </p>
                    ) : null}
                    {options.staff.map((member) => {
                      const checked = assignmentValue({
                        options,
                        overrides: assignmentOverrides,
                        serviceId: service.id,
                        staffId: member.id,
                      });
                      const disabled =
                        !canManageAssignments ||
                        pendingKey ===
                          `assignment:${assignmentKey(service.id, member.id)}` ||
                        !service.is_active ||
                        !member.is_active;

                      return (
                        <label
                          className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[#f0e6df] px-3"
                          key={member.id}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-extrabold text-[#211c24]">
                              {member.display_name}
                            </span>
                            <span className="block text-xs text-[#786d78]">
                              <WorkspaceText text={staffBookingReady(member)
                                ? "Booking ready"
                                : member.is_active
                                  ? "Online booking off"
                                  : "Inactive professional"} />
                            </span>
                          </span>
                          <input
                            checked={checked}
                            disabled={disabled}
                            onChange={(event) =>
                              updateAssignment(
                                service.id,
                                member.id,
                                event.target.checked,
                              )
                            }
                            type="checkbox"
                          />
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
        {!canManageServices || !canManageAssignments ? (
          <p className="text-sm text-[#786d78]">
            <WorkspaceText text="Some controls are read-only because this account does not have the matching Services or Booking permission." />
          </p>
        ) : null}
      </div>
    </QuickSetupDrawerFrame>
  );
}

function QuickTimeOffForm({
  canManage,
  staffId,
  timezone,
}: {
  canManage: boolean;
  staffId: string;
  timezone: string;
}) {
  const __vt = useWorkspaceTranslation();

  
  const defaultDate = addDays(todayInTimeZone(timezone), 1);
  const [startDate, setStartDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(defaultDate);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<BookingSetupActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetTimeOff() {
    setStartDate(defaultDate);
    setEndDate(defaultDate);
    setReason("");
    setResult(null);
  }

  function submit(overrideConflicts = false) {
    if (!startDate || !endDate || startDate > endDate) {
      setResult({ error: "Choose a valid date range.", ok: false });
      return;
    }

    setResult(null);
    startTransition(async () => {
      const response = await createStaffTimeBlockAction({
        blockType: "time_off",
        endLocal: `${endDate}T23:59`,
        overrideConflicts,
        reason,
        staffId,
        startLocal: `${startDate}T00:00`,
        timezoneIana: timezone,
      });
      setResult(response);

      if (response.ok) {
        setReason("");
        
      }
    });
  }

  return (
    <div className="grid gap-3 rounded-xl border border-[#f0e6df] bg-[#fffaf7] p-4">
      <InlineActionMessage result={result} />
      <div className="grid gap-3 lg:grid-cols-[150px_150px_minmax(0,1fr)]">
        <label className="grid gap-1">
          <span className="text-xs font-extrabold uppercase text-[#786d78]">
            <WorkspaceText text="From" />
          </span>
          <input
            className={styles.field}
            disabled={!canManage || isPending}
            onChange={(event) => setStartDate(event.target.value)}
            type="date"
            value={startDate}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-extrabold uppercase text-[#786d78]">
            <WorkspaceText text="To" />
          </span>
          <input
            className={styles.field}
            disabled={!canManage || isPending}
            onChange={(event) => setEndDate(event.target.value)}
            type="date"
            value={endDate}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-extrabold uppercase text-[#786d78]">
            <WorkspaceText text="Reason" />
          </span>
          <input
            className={styles.field}
            disabled={!canManage || isPending}
            onChange={(event) => setReason(event.target.value)}
            placeholder={__vt("Optional")}
            value={reason}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className={classNames(styles.primaryButton, "px-4")}
          disabled={!canManage || isPending}
          onClick={() => submit(false)}
          type="button"
        >
          <WorkspaceText text={isPending ? "Adding" : "Add time off"} />
        </button>
        <button
          className={classNames(styles.secondaryButton, "px-4")}
          disabled={isPending}
          onClick={resetTimeOff}
          type="button"
        >
          <WorkspaceText text="Reset" />
        </button>
        {!result?.ok && result?.conflicts?.length ? (
          <button
            className={classNames(styles.secondaryButton, "px-4")}
            disabled={!canManage || isPending}
            onClick={() => submit(true)}
            type="button"
          >
            <WorkspaceText text="Save with override" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

type SimpleHoursDayDraft = {
  enabled: boolean;
  endsAt: string;
  startsAt: string;
};

function defaultSimpleHoursDay(): SimpleHoursDayDraft {
  return {
    enabled: false,
    endsAt: "17:00",
    startsAt: "09:00",
  };
}

function simpleHoursDraftForStaff(
  options: BookingWorkspaceClientProps["options"],
  staffId: string,
) {
  return Object.fromEntries(
    QUICK_SETUP_DAYS.map((day) => {
      const dayRules = workingRulesForStaff(options, staffId).filter(
        (rule) => rule.day_of_week === day.id,
      );

      if (dayRules.length === 0) {
        return [day.id, defaultSimpleHoursDay()];
      }

      return [
        day.id,
        {
          enabled: true,
          endsAt: dayRules[dayRules.length - 1].ends_at_local.slice(0, 5),
          startsAt: dayRules[0].starts_at_local.slice(0, 5),
        },
      ];
    }),
  ) as Record<number, SimpleHoursDayDraft>;
}

function simpleHoursDraftKey(draft: Record<number, SimpleHoursDayDraft>) {
  return JSON.stringify(
    QUICK_SETUP_DAYS.map((day) => [
      day.id,
      draft[day.id].enabled,
      draft[day.id].startsAt,
      draft[day.id].endsAt,
    ]),
  );
}

function SimpleBookingHoursEditor({
  canManage,
  options,
  staffId,
  timezone,
}: {
  canManage: boolean;
  options: BookingWorkspaceClientProps["options"];
  staffId: string;
  timezone: string;
}) {
  
  const [editing, setEditing] = useState(false);
  const initialDraft = useMemo(
    () => simpleHoursDraftForStaff(options, staffId),
    [options, staffId],
  );
  const initialKey = `${staffId}:${simpleHoursDraftKey(initialDraft)}`;
  const [draftState, setDraftState] = useState<{
    draft: Record<number, SimpleHoursDayDraft>;
    key: string;
  }>(() => ({
    draft: initialDraft,
    key: initialKey,
  }));
  const draft = draftState.key === initialKey ? draftState.draft : initialDraft;
  const [result, setResult] = useState<BookingSetupActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateDay(dayId: number, patch: Partial<SimpleHoursDayDraft>) {
    setDraftState({
      draft: {
        ...draft,
        [dayId]: {
          ...draft[dayId],
          ...patch,
        },
      },
      key: initialKey,
    });
  }

  function resetDraft() {
    setDraftState({ draft: initialDraft, key: initialKey });
    setResult(null);
  }

  function saveHours() {
    const invalidDay = QUICK_SETUP_DAYS.find((day) => {
      const dayDraft = draft[day.id];
      return dayDraft.enabled && dayDraft.startsAt >= dayDraft.endsAt;
    });

    if (invalidDay) {
      setResult({
        error: `${invalidDay.label} start time must be before end time.`,
        ok: false,
      });
      return;
    }

    const existingBreakRules = breakRulesForStaff(options, staffId).map((rule) => ({
      dayOfWeek: rule.day_of_week,
      effectiveEndDate: rule.effective_end_date,
      effectiveStartDate: rule.effective_start_date,
      endsAtLocal: rule.ends_at_local.slice(0, 5),
      ruleType: "break" as const,
      startsAtLocal: rule.starts_at_local.slice(0, 5),
      timezoneIana: timezone,
    }));
    const workingRules = QUICK_SETUP_DAYS.filter((day) => draft[day.id].enabled).map(
      (day) => ({
        dayOfWeek: day.id,
        endsAtLocal: draft[day.id].endsAt,
        ruleType: "working" as const,
        startsAtLocal: draft[day.id].startsAt,
        timezoneIana: timezone,
      }),
    );

    setResult(null);
    startTransition(async () => {
      const response = await saveStaffWeeklyAvailabilityAction({
        rules: [...workingRules, ...existingBreakRules],
        staffId,
      });
      setResult(response);

      if (response.ok) {
        setEditing(false);
        
      }
    });
  }

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold text-[#211c24]"><WorkspaceText text="Booking hours" /></p>
          <p className="mt-1 text-sm text-[#786d78]">
            {summarizeStaffHours(options, staffId)}
          </p>
        </div>
        {editing ? null : (
          <button
            className={classNames(styles.secondaryButton, "px-3")}
            disabled={!canManage}
            onClick={() => setEditing(true)}
            type="button"
          >
            <WorkspaceText text="Edit hours" />
          </button>
        )}
      </div>
      <InlineActionMessage result={result} />
      {editing ? (
        <div className="grid gap-2 rounded-xl border border-[#f0e6df] bg-[#fffaf7] p-3">
          {QUICK_SETUP_DAYS.map((day) => {
            const dayDraft = draft[day.id];

            return (
              <div
                className="grid gap-2 rounded-lg border border-[#f0e6df] bg-white p-3 sm:grid-cols-[76px_86px_1fr]"
                key={day.id}
              >
                <strong className="self-center text-sm text-[#211c24]">
                  <WorkspaceText text={day.label} />
                </strong>
                <label className="flex items-center gap-2 text-sm font-semibold text-[#786d78]">
                  <input
                    checked={dayDraft.enabled}
                    disabled={!canManage || isPending}
                    onChange={(event) =>
                      updateDay(day.id, { enabled: event.target.checked })
                    }
                    type="checkbox"
                  />
                  {dayDraft.enabled ? <WorkspaceText text="Open" /> : "Off"}
                </label>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr]">
                  <input
                    className={styles.field}
                    disabled={!canManage || isPending || !dayDraft.enabled}
                    onChange={(event) =>
                      updateDay(day.id, { startsAt: event.target.value })
                    }
                    type="time"
                    value={dayDraft.startsAt}
                  />
                  <span className="hidden self-center text-center text-[#786d78] sm:block">
                    -
                  </span>
                  <input
                    className={styles.field}
                    disabled={!canManage || isPending || !dayDraft.enabled}
                    onChange={(event) =>
                      updateDay(day.id, { endsAt: event.target.value })
                    }
                    type="time"
                    value={dayDraft.endsAt}
                  />
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              className={classNames(styles.primaryButton, "px-4")}
              disabled={!canManage || isPending}
              onClick={saveHours}
              type="button"
            >
              {isPending ? "Saving" : <WorkspaceText text="Save hours" />}
            </button>
            <button
              className={classNames(styles.secondaryButton, "px-4")}
              disabled={isPending}
              onClick={resetDraft}
              type="button"
            >
              <WorkspaceText text="Reset" />
            </button>
            <button
              className={classNames(styles.secondaryButton, "px-4")}
              disabled={isPending}
              onClick={() => {
                resetDraft();
                setEditing(false);
              }}
              type="button"
            >
              <WorkspaceText text="Cancel" />
            </button>
          </div>
          <p className="text-xs leading-5 text-[#786d78]">
            <WorkspaceText text="This quick editor saves one working interval per day and keeps existing breaks. Use Advanced availability for multiple intervals or exceptions." />
          </p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {QUICK_SETUP_DAYS.map((day) => {
            const dayWorking = workingRulesForStaff(options, staffId).filter(
              (rule) => rule.day_of_week === day.id,
            );
            const dayBreaks = breakRulesForStaff(options, staffId).filter(
              (rule) => rule.day_of_week === day.id,
            );

            return (
              <div
                className="rounded-lg border border-[#f0e6df] px-3 py-2 text-sm"
                key={day.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <strong className="text-[#211c24]"><WorkspaceText text={day.label} /></strong>
                  <span className="text-right text-[#786d78]">
                    {dayWorking.length > 0
                      ? dayWorking
                          .map(
                            (rule) =>
                              `${formatLocalClock(
                                rule.starts_at_local,
                              )} - ${formatLocalClock(rule.ends_at_local)}`,
                          )
                          .join(", ")
                      : "Off"}
                  </span>
                </div>
                {dayBreaks.length > 0 ? (
                  <p className="mt-1 text-xs text-[#786d78]">
                    <WorkspaceText text="Break" />{" "}
                    {dayBreaks
                      .map(
                        (rule) =>
                          `${formatLocalClock(
                            rule.starts_at_local,
                          )} - ${formatLocalClock(rule.ends_at_local)}`,
                      )
                      .join(", ")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ProfessionalDetailPanel({
  assignmentOverrides,
  canManageAssignments,
  canManageAvailability,
  canManageStaff,
  onAssignmentChange,
  onStaffOnlineChange,
  options,
  pendingKey,
  staff,
  staffOnline,
  timezone,
}: {
  assignmentOverrides: Record<string, boolean>;
  canManageAssignments: boolean;
  canManageAvailability: boolean;
  canManageStaff: boolean;
  onAssignmentChange: (serviceId: string, staffId: string, selected: boolean) => void;
  onStaffOnlineChange: (staffId: string, selected: boolean) => void;
  options: BookingWorkspaceClientProps["options"];
  pendingKey: string | null;
  staff: BookingWorkspaceClientProps["options"]["staff"][number];
  staffOnline: boolean;
  timezone: string;
}) {
  const __vt = useWorkspaceTranslation();

  const timeOff = upcomingTimeOffBlocks(options, staff.id);
  const services = options.services.filter((service) => service.is_active);

  return (
    <section className="grid gap-5 rounded-xl border border-[#f0e6df] bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate text-xl font-extrabold text-[#211c24]">
            {staff.display_name}
          </h3>
          <p className="mt-1 text-sm text-[#786d78]">
            <WorkspaceText text={staff.job_title ?? "Professional"} />
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={classNames(
              styles.statusBadge,
              staffOnline ? styles.statusArrived : styles.statusMuted,
            )}
          >
            <WorkspaceText text={staffOnline ? "Online" : "Off"} />
          </span>
          <MiniSwitch
            checked={staffOnline}
            disabled={!canManageStaff || pendingKey === `staff:${staff.id}`}
            label={__vt(`Online booking for ${staff.display_name}`)}
            onChange={(next) => onStaffOnlineChange(staff.id, next)}
          />
        </div>
      </div>

      <SimpleBookingHoursEditor
        canManage={canManageAvailability}
        options={options}
        staffId={staff.id}
        timezone={timezone}
      />

      <section className="grid gap-3">
        <p className="text-sm font-extrabold text-[#211c24]"><WorkspaceText text="Bookable services" /></p>
        {services.length === 0 ? (
          <p className="rounded-lg border border-[#f0e6df] bg-[#fffaf7] p-3 text-sm text-[#786d78]">
            <WorkspaceText text="No active services yet. Create a service from the Services quick setup card before matching it to this professional." />
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {services.map((service) => {
              const checked = assignmentValue({
                options,
                overrides: assignmentOverrides,
                serviceId: service.id,
                staffId: staff.id,
              });
              const disabled =
                !canManageAssignments ||
                pendingKey ===
                  `assignment:${assignmentKey(service.id, staff.id)}`;

              return (
                <label
                  className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[#f0e6df] px-3"
                  key={service.id}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold text-[#211c24]">
                      {service.name}
                    </span>
                    <span className="block text-xs text-[#786d78]">
                      <WorkspaceText text={service.online_booking_enabled
                        ? "Online service"
                        : "Service off"} />
                    </span>
                  </span>
                  <input
                    checked={checked}
                    disabled={disabled || !service.online_booking_enabled}
                    onChange={(event) =>
                      onAssignmentChange(
                        service.id,
                        staff.id,
                        event.target.checked,
                      )
                    }
                    type="checkbox"
                  />
                </label>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-extrabold text-[#211c24]"><WorkspaceText text="Time off" /></p>
          <p className="text-sm text-[#786d78]">
            <WorkspaceText text={timeOff.length === 0
              ? "No upcoming time off"
              : `${timeOff.length} upcoming range${timeOff.length === 1 ? "" : "s"}`} />
          </p>
        </div>
        {timeOff.length > 0 ? (
          <div className="grid gap-2">
            {timeOff.slice(0, 3).map((block) => (
              <div
                className="rounded-lg border border-[#f0e6df] px-3 py-2 text-sm"
                key={block.id}
              >
                <strong className="text-[#211c24]">
                  <WorkspaceText text={formatTimeOffRange(block, timezone)} />
                </strong>
                {block.reason ? (
                  <p className="mt-1 text-[#786d78]">{block.reason}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <QuickTimeOffForm
          canManage={canManageAvailability}
          staffId={staff.id}
          timezone={timezone}
        />
      </section>

      <a className="text-sm font-extrabold text-[#f26f3d]" href={`/staff?staff=${staff.id}`}>
        <WorkspaceText text="Edit staff details" />
      </a>
    </section>
  );
}

function ProfessionalsQuickSetupDrawer({
  canManageAssignments,
  canManageAvailability,
  canManageStaff,
  initialStaffId,
  onClose,
  options,
  timezone,
}: {
  canManageAssignments: boolean;
  canManageAvailability: boolean;
  canManageStaff: boolean;
  initialStaffId?: string | null;
  onClose: () => void;
  options: BookingWorkspaceClientProps["options"];
  timezone: string;
}) {
  const __vt = useWorkspaceTranslation();

  
  const [query, setQuery] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(
    initialStaffId && options.staff.some((member) => member.id === initialStaffId)
      ? initialStaffId
      : options.staff[0]?.id ?? null,
  );
  const [showCreateForm, setShowCreateForm] = useState(
    options.staff.length === 0,
  );
  const [staffOverrides, setStaffOverrides] = useState<Record<string, boolean>>(
    {},
  );
  const [assignmentOverrides, setAssignmentOverrides] = useState<
    Record<string, boolean>
  >({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [, startTransition] = useTransition();
  const staff = options.staff.filter(
    (member) =>
      searchTextMatches([member.display_name, member.job_title], query),
  );
  const selectedStaff =
    options.staff.find((member) => member.id === selectedStaffId) ??
    staff[0] ??
    null;

  function staffOnline(member: BookingWorkspaceClientProps["options"]["staff"][number]) {
    return staffOverrides[member.id] ?? member.online_booking_enabled;
  }

  function updateStaffOnline(staffId: string, next: boolean) {
    setPendingKey(`staff:${staffId}`);
    setResult(null);
    startTransition(async () => {
      const response = await updateQuickSetupStaffOnlineAction({
        onlineBookingEnabled: next,
        staffId,
      });
      setResult(response);
      setPendingKey(null);

      if (response.ok) {
        setStaffOverrides((current) => ({ ...current, [staffId]: next }));
        
      }
    });
  }

  function updateAssignment(serviceId: string, staffId: string, selected: boolean) {
    const key = assignmentKey(serviceId, staffId);
    setPendingKey(`assignment:${key}`);
    setResult(null);
    startTransition(async () => {
      const response = await updateQuickSetupAssignmentAction({
        selected,
        serviceId,
        staffId,
      });
      setResult(response);
      setPendingKey(null);

      if (response.ok) {
        setAssignmentOverrides((current) => ({ ...current, [key]: selected }));
        
      }
    });
  }

  return (
    <QuickSetupDrawerFrame
      onClose={onClose}
      subtitle={__vt("Set who appears online, review hours, and match professionals to services.")}
      title={__vt("Professionals")}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <InlineActionMessage result={result} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              className={classNames(styles.secondaryButton, "w-full sm:w-auto")}
              disabled={!canManageStaff}
              onClick={() => setShowCreateForm((current) => !current)}
              type="button"
            >
              <WorkspaceText text={showCreateForm ? "Hide quick create" : "Create professional"} />
            </button>
            <a
              className="text-sm font-extrabold text-[#f26f3d]"
              href="/staff?add=1"
            >
              <WorkspaceText text="Advanced staff settings" />
            </a>
          </div>
          {showCreateForm ? (
            <QuickCreateStaffCard
              canManageAssignments={canManageAssignments}
              canManageStaff={canManageStaff}
              onCreated={(staffId) => {
                setQuery("");
                setSelectedStaffId(staffId);
                setShowCreateForm(false);
                
              }}
              onResult={setResult}
              options={options}
            />
          ) : null}
          <label className="grid gap-1">
            <span className="sr-only"><WorkspaceText text="Search professionals" /></span>
            <input
              className={classNames(styles.field, "w-full")}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={__vt("Search professionals")}
              type="search"
              value={query}
            />
          </label>
          {staff.map((member) => {
            const online = staffOnline(member);
            const selected = selectedStaff?.id === member.id;
            const servicesCount = staffServiceIds(
              options,
              assignmentOverrides,
              member.id,
            ).length;

            return (
              <button
                className={classNames(
                  "grid gap-2 rounded-xl border bg-white p-4 text-left transition",
                  selected ? "border-[#f26f3d]" : "border-[#f0e6df]",
                )}
                key={member.id}
                onClick={() => setSelectedStaffId(member.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-[#211c24]">
                      {member.display_name}
                    </p>
                    <p className="mt-1 text-xs text-[#786d78]">
                      {summarizeStaffHours(options, member.id)}
                    </p>
                  </div>
                  <span
                    className={classNames(
                      styles.statusBadge,
                      online ? styles.statusArrived : styles.statusMuted,
                    )}
                  >
                    <WorkspaceText text={online ? "On" : "Off"} />
                  </span>
                </div>
                <p className="text-sm text-[#786d78]">
                  {servicesCount} <WorkspaceText text="service" />{servicesCount === 1 ? "" : "s"}
                </p>
              </button>
            );
          })}
        </div>
        {selectedStaff ? (
          <ProfessionalDetailPanel
            assignmentOverrides={assignmentOverrides}
            canManageAssignments={canManageAssignments}
            canManageAvailability={canManageAvailability}
            canManageStaff={canManageStaff}
            onAssignmentChange={updateAssignment}
            onStaffOnlineChange={updateStaffOnline}
            options={options}
            pendingKey={pendingKey}
            staff={selectedStaff}
            staffOnline={staffOnline(selectedStaff)}
            timezone={timezone}
          />
        ) : (
          <p className="rounded-xl border border-[#f0e6df] bg-white p-4 text-sm text-[#786d78]">
            <WorkspaceText text="No professionals found. Use quick create or open advanced staff settings." />
          </p>
        )}
      </div>
    </QuickSetupDrawerFrame>
  );
}

function BookingHoursQuickSetupDrawer({
  canManageAvailability,
  initialStaffId,
  onClose,
  options,
  timezone,
}: {
  canManageAvailability: boolean;
  initialStaffId?: string | null;
  onClose: () => void;
  options: BookingWorkspaceClientProps["options"];
  timezone: string;
}) {
  const __vt = useWorkspaceTranslation();

  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(
    initialStaffId && options.staff.some((member) => member.id === initialStaffId)
      ? initialStaffId
      : options.staff[0]?.id ?? null,
  );
  const selectedStaff =
    options.staff.find((member) => member.id === selectedStaffId) ??
    options.staff[0] ??
    null;

  return (
    <QuickSetupDrawerFrame
      onClose={onClose}
      subtitle={__vt("Review simple weekly booking hours and add time off without leaving Booking.")}
      title={__vt("Booking hours")}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="grid content-start gap-2">
          {options.staff.map((member) => (
            <button
              className={classNames(
                "rounded-xl border bg-white p-4 text-left transition",
                selectedStaff?.id === member.id
                  ? "border-[#f26f3d]"
                  : "border-[#f0e6df]",
              )}
              key={member.id}
              onClick={() => setSelectedStaffId(member.id)}
              type="button"
            >
              <p className="truncate text-sm font-extrabold text-[#211c24]">
                {member.display_name}
              </p>
              <p className="mt-1 text-sm text-[#786d78]">
                {summarizeStaffHours(options, member.id)}
              </p>
            </button>
          ))}
        </div>
        {selectedStaff ? (
          <section className="grid gap-5 rounded-xl border border-[#f0e6df] bg-white p-4">
            <div>
              <h3 className="text-lg font-extrabold text-[#211c24]">
                {selectedStaff.display_name}
              </h3>
              <p className="mt-1 text-sm text-[#786d78]">
                {summarizeStaffHours(options, selectedStaff.id)}
              </p>
            </div>
            <SimpleBookingHoursEditor
              canManage={canManageAvailability}
              options={options}
              staffId={selectedStaff.id}
              timezone={timezone}
            />
            <QuickTimeOffForm
              canManage={canManageAvailability}
              staffId={selectedStaff.id}
              timezone={timezone}
            />
            <a className="text-sm font-extrabold text-[#f26f3d]" href="/bookings?tab=availability">
              <WorkspaceText text="Advanced availability" />
            </a>
          </section>
        ) : null}
      </div>
    </QuickSetupDrawerFrame>
  );
}

function BookingRulesQuickSetupDrawer({
  canManage,
  onClose,
  settings,
}: {
  canManage: boolean;
  onClose: () => void;
  settings: BookingWorkspaceClientProps["settings"];
}) {
  const __vt = useWorkspaceTranslation();
  const formId = useId();
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<UpdateBookingSettingsInput>(() =>
    settingsToInput(settings),
  );

  function setBoolean(key: keyof UpdateBookingSettingsInput, value: boolean) {
    setState((current) => ({ ...current, [key]: value }));
  }

  function setNumber(key: keyof UpdateBookingSettingsInput, value: string) {
    setState((current) => ({ ...current, [key]: Number(value) }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      try {
        setResult(await updateBookingSettingsAction(state));
      } catch {
        setResult({ ok: false, message: "Could not save. Please try again." });
      }
    });
  }

  return (
    <QuickSetupDrawerFrame
      onClose={onClose}
      subtitle={__vt("Set booking times and preferences.")}
      title={__vt("Booking rules")}
      footer={<>
        <InlineActionMessage result={result} />
        <div className="booking-rules-actions">
          <a href="/bookings?tab=settings"><WorkspaceText text="Advanced settings" /></a>
          {canManage ? (
            <button className={styles.primaryButton} disabled={isPending} form={formId} type="submit">
              <WorkspaceText text={isPending ? "Saving" : "Save rules"} />
            </button>
          ) : <p><WorkspaceText text="You have read-only booking access." /></p>}
        </div>
      </>}
    >
      <form className="booking-rules-form" id={formId} onSubmit={submit}>
        <section className="booking-rules-section">
          <h3><WorkspaceText text="Timing" /></h3>
          <div className="booking-rules-fields">
          <NumberField
            disabled={!canManage}
            label={__vt("Minimum notice")}
            onChange={(value) => setNumber("minimumLeadTimeMinutes", value)}
            suffix="min"
            value={state.minimumLeadTimeMinutes}
          />
          <NumberField
            disabled={!canManage}
            label={__vt("Book ahead")}
            onChange={(value) => setNumber("maximumAdvanceWindowDays", value)}
            suffix="days"
            value={state.maximumAdvanceWindowDays}
          />
          <label className="grid gap-1">
            <span className="text-sm font-extrabold text-[#211c24]">
              <WorkspaceText text="Slot interval" />
            </span>
            <select
              className={styles.select}
              disabled={!canManage}
              onChange={(event) =>
                setNumber("slotIntervalMinutes", event.target.value)
              }
              value={state.slotIntervalMinutes}
            >
              {[5, 10, 15, 20, 30, 60].map((interval) => (
                <option key={interval} value={interval}>
                  {interval} <WorkspaceText text="min" />
                </option>
              ))}
            </select>
          </label>
          <NumberField
            disabled={!canManage}
            label={__vt("Cancellation notice")}
            onChange={(value) => setNumber("cancellationWindowMinutes", value)}
            suffix="min"
            value={state.cancellationWindowMinutes}
          />
          </div>
        </section>
        <section className="booking-rules-section">
          <h3><WorkspaceText text="Booking access" /></h3>
          <Toggle checked={state.autoAssignEnabled} disabled={!canManage} label={__vt("Auto-assign staff (Portable)")} onChange={(value) => setBoolean("autoAssignEnabled", value)} />
          <Toggle
            checked={state.anyProfessionalEnabled}
            disabled={!canManage}
            label={__vt("Any Professional")}
            onChange={(value) => setBoolean("anyProfessionalEnabled", value)}
          />
          <Toggle
            checked={state.guestBookingEnabled}
            disabled={!canManage}
            label={__vt("Guest booking")}
            onChange={(value) => setBoolean("guestBookingEnabled", value)}
          />
          <label className="grid gap-1">
            <span className="text-sm font-extrabold text-[#211c24]">
              <WorkspaceText text="Confirmation" />
            </span>
            <select
              className={styles.select}
              disabled={!canManage}
              onChange={(event) =>
                setState((current) => ({
                  ...current,
                  confirmationMode: event.target.value as BookingConfirmationMode,
                }))
              }
              value={state.confirmationMode}
            >
              <option value="request_confirmation"><WorkspaceText text="Request confirmation" /></option>
              <option value="instant_booking"><WorkspaceText text="Instant booking" /></option>
            </select>
          </label>
        </section>
        <section className="booking-rules-section">
          <h3><WorkspaceText text="Email notifications" /></h3>
          <Toggle checked={state.reminderEnabled} disabled={!canManage} label={__vt("24-hour reminder")} onChange={(value) => setBoolean("reminderEnabled", value)} />
          <Toggle checked={state.confirmationEmailEnabled} disabled={!canManage} label={__vt("Booking updates")} onChange={(value) => setBoolean("confirmationEmailEnabled", value)} />
          <p className="booking-rules-note"><WorkspaceText text="Booking updates require a connected email provider." /></p>
        </section>
      </form>
    </QuickSetupDrawerFrame>
  );
}

function OnlineBookingControlCard({
  canManage,
  isReady,
  publicBookingHref,
  settings,
}: {
  canManage: boolean;
  isReady: boolean;
  publicBookingHref: string;
  settings: BookingWorkspaceClientProps["settings"];
}) {
  const __vt = useWorkspaceTranslation();

  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [copyMessage, setCopyMessage] = useState("");
  const isPublished = getSalonOnlineBookingStatus(settings).onlineBookingOpen;
  const isLive = isPublished && isReady;

  async function copyPublicUrl() {
    try {
      await navigator.clipboard.writeText(new URL(publicBookingHref, window.location.origin).href);
      setCopyMessage("Link copied.");
    } catch {
      setCopyMessage("Could not copy. Open the booking page and copy its address.");
    }
  }

  function togglePublished() {
    const next = !isPublished;
    const input = {
      ...settingsToInput(settings),
      bookingEnabled: next,
      onlineBookingVisible: next,
      guestBookingEnabled: next || settings.guest_booking_enabled,
    };

    setResult(null);
    startTransition(async () => {
      const response = await updateBookingSettingsAction(input);
      setResult(response);
    });
  }

  return (
    <article className="booking-publish-section">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold"><WorkspaceText text="Online booking" /></h2>
          <p className="mt-1 text-xs text-[#786d78]"><WorkspaceText text={isLive ? "Live · accepting online appointments" : isPublished ? "On · finish setup to go live" : "Off · online booking is paused"} /></p>
        </div>
        <button
          className="booking-publish-toggle"
          role="switch"
          aria-label={__vt("Online booking")}
          aria-checked={isPublished}
          aria-busy={isPending}
          disabled={!canManage || isPending}
          onClick={togglePublished}
          type="button"
        >
          <span className="booking-publish-toggle-track" aria-hidden="true">
            <span className="booking-publish-toggle-thumb" />
          </span>
        </button>
      </div>
      {isPending ? (
        <p className="booking-share-hint" role="status"><WorkspaceText text="Saving…" /></p>
      ) : null}
      <InlineActionMessage result={result} />
      <p className="booking-share-url">
        {publicBookingHref}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className={classNames(styles.secondaryButton, "px-4")}
          onClick={copyPublicUrl}
          type="button"
        >
          <WorkspaceText text="Copy link" />
        </button>
        <a
          className={classNames(styles.secondaryButton, "px-4")}
          href={publicBookingHref}
          rel="noreferrer"
          target="_blank"
        >
          <WorkspaceText text="Open public page" />
        </a>
      </div>
      <p className="booking-share-hint"><WorkspaceText text="Add this booking link to your Google Maps business profile, website, or anywhere you want customers to book." /></p>
      {copyMessage ? <p role="status" className="booking-share-hint"><WorkspaceText text={copyMessage} /></p> : null}
    </article>
  );
}

function rangeScopedBookings(
  bookings: BookingWorkspaceItem[],
  filters: BookingWorkspaceFilters,
  timezone: string,
) {
  if (filters.dateRange === "day" && filters.view !== "week") {
    return selectedDateBookings(bookings, filters.date, timezone);
  }

  return bookings;
}

function statusTone(status: string) {
  switch (status) {
    case "checked_in":
      return styles.statusArrived;
    case "in_service":
      return styles.statusInService;
    case "pending":
      return styles.statusPending;
    case "confirmed":
      return styles.statusConfirmed;
    default:
      return styles.statusMuted;
  }
}

function StatusBadge({ status, kind }: { status: string; kind?: import("@/lib/booking-no-show").NoShowKind }) {
  return (
    <span
      className={classNames(
        styles.statusBadge,
        statusTone(status),
      )}
    >
      <WorkspaceText text={status === "no_show" ? bookingStatusLabel(status, kind) : STATUS_LABELS[status] ?? status} />
    </span>
  );
}

function Message({ result }: { result: BookingActionResult | null }) {
  if (!result) {
    return null;
  }

  return (
    <p
      className={classNames(
        "rounded-md border px-3 py-2 text-sm",
        result.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-800",
      )}
      role="status"
    >
      <WorkspaceText text={result.message} />
    </p>
  );
}

function ModalFrame({
  children,
  label,
  onClose,
  size = "wide",
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  size?: "detail" | "wide";
}) {
  const __vt = useWorkspaceTranslation();

  useCloseOnNavigation(onClose);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const portalHost = useOverlayPortalHost();

  useEffect(() => {
    if (!portalHost) return;
    const frame = frameRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = getFocusable(frame);
    focusable[0]?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [portalHost]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || (event.target as Element).closest("dialog[open]")) return;
    if (event.key === "Escape") {
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = getFocusable(frameRef.current);

    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!portalHost) return null;

  return createPortal(
    <div
      aria-label={__vt(label)}
      aria-modal="true"
      className="booking-modal-layer"
      data-booking-surface="owner"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={onKeyDown}
      role="dialog"
    >
      <div
        className={classNames(
          "booking-modal-panel",
          size === "detail" ? "max-w-2xl" : "max-w-5xl",
        )}
        ref={frameRef}
      >
        {children}
      </div>
    </div>,
    portalHost,
  );
}

function getFocusable(root: HTMLElement | null) {
  if (!root) {
    return [];
  }

  return Array.from(
    root.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    ),
  ).filter((element) => element.getClientRects().length > 0);
}

function buildUrl(
  pathname: string,
  searchParams: URLSearchParams,
  next: Record<string, string | null>,
) {
  const params = new URLSearchParams(searchParams.toString());

  for (const [key, value] of Object.entries(next)) {
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}



function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path
        d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M8 2v4M16 2v4M3 10h18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <rect
        height="18"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
        width="18"
        x="3"
        y="4"
      />
    </svg>
  );
}



function DownChevronIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path
        d="m6 9 6 6 6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function SettingsIcon() {
  return <SharedSettingsIcon className="size-4 shrink-0" />;
}

function formatToolbarDate(date: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: timezone,
    weekday: "long",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatToolbarRange(filters: BookingWorkspaceFilters, timezone: string) {
  if (filters.dateRange === "all") {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      timeZone: timezone,
      year: "numeric",
    }).format(new Date(`${filters.date.slice(0, 7)}-01T12:00:00Z`));
  }

  if (filters.dateRange === "next7") {
    return `${formatShortDateFromDate(filters.date, timezone)} - ${formatShortDateFromDate(
      addDays(filters.date, 6),
      timezone,
    )}`;
  }

  if (filters.view === "week") {
    const weekStart = addDays(filters.date, -new Date(`${filters.date}T12:00:00Z`).getUTCDay());

    return `${formatShortDateFromDate(weekStart, timezone)} - ${formatShortDateFromDate(
      addDays(weekStart, 6),
      timezone,
    )}`;
  }

  return formatToolbarDate(filters.date, timezone);
}

function formatShortDateFromDate(date: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
  }).format(new Date(`${date}T12:00:00Z`));
}





function WorkspaceTabs({
  appointmentCount,
  filters,
  setupIncomplete,
}: {
  appointmentCount: number;
  filters: BookingWorkspaceFilters;
  setupIncomplete: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabs = [
    { count: appointmentCount, label: "Appointments", value: "calendar" },
    { label: "Booking page", setupNeeded: setupIncomplete, value: "booking-page" },
    { label: "Availability", value: "availability" },
    { label: "Settings", value: "settings" },
  ] as const;

  return (
    <div className={classNames(styles.tabsScroller, "-mx-1 overflow-x-auto px-1")}>
      <div className={styles.tabs} data-testid="booking-owner-tabs">
        {tabs.map((tab) => (
          <a
            aria-current={filters.tab === tab.value ? "page" : undefined}
            className={classNames(
              styles.tab,
              filters.tab === tab.value && styles.tabActive,
            )}
            href={buildUrl(pathname, searchParams, {
              section: null,
              tab: tab.value,
            })}
            key={tab.value}
          >
            <WorkspaceText text={tab.label} />
            {"count" in tab ? (
              <span className={styles.tabCount}>{tab.count}</span>
            ) : null}
            {"setupNeeded" in tab && tab.setupNeeded ? (
              <span className="booking-tab-setup-badge"><WorkspaceText text="Setup needed" /></span>
            ) : null}
          </a>
        ))}
      </div>
    </div>
  );
}

function AppointmentCard({
  booking,
  onOpen,
  timezone,
}: {
  booking: BookingWorkspaceItem;
  onOpen: (booking: BookingWorkspaceItem) => void;
  timezone: string;
}) {
  return (
    <button
      className="grid w-full gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
      onClick={() => onOpen(booking)}
      type="button"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-950">
            <WorkspaceText text={formatTime(booking.start_at, timezone)} /> -{" "}
            <WorkspaceText text={formatTime(booking.end_at, timezone)} />
          </p>
          <p className="mt-1 truncate text-base font-semibold text-zinc-950">
            {booking.customer?.name ?? "Unknown customer"}
                    {Boolean(booking.noShowCount) && <span className="ml-2 inline-block rounded-full bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-800">{booking.noShowCount} <WorkspaceText text="previous no-show" />{booking.noShowCount === 1 ? "" : "s"}</span>}
          </p>
        </div>
        <StatusBadge status={booking.normalizedStatus} kind={booking.no_show_kind} />
      </div>
      <div className="grid gap-1 text-sm text-zinc-600">
        <p className="line-clamp-2">
          {booking.serviceNames.length > 0
            ? booking.serviceNames.join(", ")
            : <WorkspaceText text="No services" />}
        </p>
        <p className="truncate">
          {booking.assignedStaffNames.length > 0
            ? booking.assignedStaffNames.join(", ")
            : <WorkspaceText text="Unassigned" />}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs font-semibold text-zinc-600">
        <span className="rounded-md border border-zinc-200 px-2 py-1">
          <WorkspaceText text={sourceLabel(booking.source)} />
        </span>
        <span className="rounded-md border border-zinc-200 px-2 py-1">
          {booking.confirmation_status}
        </span>
        {booking.hasOverbookingOverride ? (
          <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800">
            <WorkspaceText text="Override" />
          </span>
        ) : null}
        {booking.lines.length > 1 ? (
          <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-800">
            <WorkspaceText text="Multi-service" />
          </span>
        ) : null}
      </div>
    </button>
  );
}

function minutesFromIso(value: string, timeZone: string) {
  const parts = dateParts(value, timeZone).time.split(":").map(Number);

  return parts[0] * 60 + parts[1];
}

function localTimeLabel(totalMinutes: number) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const date = new Date(Date.UTC(2026, 0, 1, hour, minute));

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: minute ? "2-digit" : undefined,
    timeZone: "UTC",
  }).format(date);
}

function calendarBounds(input: {
  bookings: BookingWorkspaceItem[];
  date: string;
  options: BookingWorkspaceClientProps["options"];
  timezone: string;
}) {
  const starts: number[] = [];
  const ends: number[] = [];
  const day = new Date(`${input.date}T12:00:00Z`).getUTCDay();

  for (const rule of input.options.availabilityRules) {
    if (rule.day_of_week !== day || rule.rule_type !== "working" || !rule.is_active) {
      continue;
    }

    const [startHour, startMinute] = rule.starts_at_local.slice(0, 5).split(":").map(Number);
    const [endHour, endMinute] = rule.ends_at_local.slice(0, 5).split(":").map(Number);
    starts.push(startHour * 60 + startMinute);
    ends.push(endHour * 60 + endMinute);
  }

  for (const booking of input.bookings) {
    if (dateParts(booking.start_at, input.timezone).date !== input.date) {
      continue;
    }

    starts.push(minutesFromIso(booking.start_at, input.timezone));
    ends.push(minutesFromIso(booking.end_at, input.timezone));
  }

  const start = Math.max(0, Math.min(...starts, 9 * 60) - 60);
  const end = Math.min(24 * 60, Math.max(...ends, 18 * 60) + 60);

  return {
    end: Math.max(end, start + 4 * 60),
    start,
  };
}

function dayColumns(
  options: BookingWorkspaceClientProps["options"],
  filters: BookingWorkspaceFilters,
) {
  const staff = filters.staffId
    ? options.staff.filter((member) => member.id === filters.staffId)
    : options.staff;

  if (staff.length === 0) {
    return [{ id: "unassigned", label: "Schedule" }];
  }

  return staff.slice(0, 8).map((member) => ({
    id: member.id,
    label: member.display_name,
  }));
}

function bookingColumnIds(
  booking: BookingWorkspaceItem,
  columns: Array<{ id: string; label: string }>,
) {
  const ids = new Set(
    booking.lines
      .map((line) => line.assigned_staff_id)
      .filter((value): value is string => Boolean(value)),
  );

  if (ids.size === 0) {
    return [columns[0]?.id ?? "unassigned"];
  }

  return [...ids].filter((id) => columns.some((column) => column.id === id));
}

function DayCalendarCanvas({
  bookings,
  filters,
  onOpen,
  options,
  timezone,
}: {
  bookings: BookingWorkspaceItem[];
  filters: BookingWorkspaceFilters;
  onOpen: (booking: BookingWorkspaceItem) => void;
  options: BookingWorkspaceClientProps["options"];
  timezone: string;
}) {
  const columns = dayColumns(options, filters);
  const bounds = calendarBounds({
    bookings,
    date: filters.date,
    options,
    timezone,
  });
  const rowHeight = 64;
  const totalMinutes = bounds.end - bounds.start;
  const canvasHeight = Math.max(360, Math.ceil(totalMinutes / 60) * rowHeight);
  const hours = Array.from(
    { length: Math.ceil(totalMinutes / 60) + 1 },
    (_, index) => bounds.start + index * 60,
  );
  const dayBookings = bookings.filter(
    (booking) => dateParts(booking.start_at, timezone).date === filters.date,
  );
  const blocks = options.timeBlocks.filter(
    (block) => dateParts(block.starts_at, timezone).date === filters.date,
  );
  const today = todayInTimeZone(timezone);
  const nowMinutes = minutesFromIso(new Date().toISOString(), timezone);
  const showNow = filters.date === today && nowMinutes >= bounds.start && nowMinutes <= bounds.end;
  const position = (startIso: string, endIso: string) => {
    const start = minutesFromIso(startIso, timezone);
    const end = minutesFromIso(endIso, timezone);
    const top = ((start - bounds.start) / totalMinutes) * canvasHeight;
    const height = Math.max(36, ((end - start) / totalMinutes) * canvasHeight);

    return { height, top };
  };

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-[72px_minmax(0,1fr)] border-b border-zinc-200 bg-zinc-50">
        <div className="px-3 py-3 text-xs font-semibold uppercase text-zinc-500">
          <WorkspaceText text="Time" />
        </div>
        <div
          className="grid min-w-[680px]"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(160px, 1fr))` }}
        >
          {columns.map((column) => (
            <div
              className="border-l border-zinc-200 px-3 py-3 text-sm font-semibold text-zinc-950"
              key={column.id}
            >
              <WorkspaceText text={column.label} />
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[752px] grid-cols-[72px_minmax(0,1fr)]">
          <div className="relative bg-zinc-50" style={{ height: canvasHeight }}>
            {hours.map((hour) => (
              <div
                className="absolute left-0 right-0 -translate-y-2 px-3 text-xs text-zinc-500"
                key={hour}
                style={{ top: ((hour - bounds.start) / totalMinutes) * canvasHeight }}
              >
                <WorkspaceText text={localTimeLabel(hour)} />
              </div>
            ))}
          </div>
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, minmax(160px, 1fr))`,
              height: canvasHeight,
            }}
          >
            {columns.map((column) => (
              <div
                className="relative border-l border-zinc-200"
                key={column.id}
              >
                {hours.map((hour) => (
                  <div
                    className="absolute left-0 right-0 border-t border-zinc-100"
                    key={hour}
                    style={{ top: ((hour - bounds.start) / totalMinutes) * canvasHeight }}
                  />
                ))}
                {blocks
                  .filter((block) => !block.staff_id || block.staff_id === column.id)
                  .map((block) => {
                    const blockPosition = position(block.starts_at, block.ends_at);

                    return (
                      <div
                        className="absolute left-2 right-2 rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600"
                        key={block.id}
                        style={{
                          height: blockPosition.height,
                          top: blockPosition.top,
                        }}
                      >
                        {block.reason || block.block_type.replace(/_/g, " ")}
                      </div>
                    );
                  })}
                {dayBookings
                  .filter((booking) => bookingColumnIds(booking, columns).includes(column.id))
                  .map((booking) => {
                    const itemPosition = position(booking.start_at, booking.end_at);

                    return (
                      <button
                        className="absolute left-2 right-2 overflow-hidden rounded-md border border-[#f26f3d] bg-[#f26f3d] px-3 py-2 text-left text-white shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f26f3d]"
                        key={`${column.id}-${booking.id}`}
                        onClick={() => onOpen(booking)}
                        style={{
                          height: itemPosition.height,
                          top: itemPosition.top,
                        }}
                        type="button"
                      >
                        <span className="block truncate text-xs font-semibold">
                          <WorkspaceText text={formatTime(booking.start_at, timezone)} />{" "}
                          {booking.customer?.name ?? "Unknown customer"}
                    {Boolean(booking.noShowCount) && <span className="ml-2 inline-block rounded-full bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-800">{booking.noShowCount} <WorkspaceText text="previous no-show" />{booking.noShowCount === 1 ? "" : "s"}</span>}
                        </span>
                        <span className="mt-1 block truncate text-xs text-zinc-200">
                          <WorkspaceText text={booking.serviceNames.join(", ") || "Appointment"} />
                        </span>
                        <span className="mt-1 block truncate text-[11px] text-zinc-300">
                          <WorkspaceText text={bookingStatusLabel(booking.normalizedStatus, booking.no_show_kind)} />
                        </span>
                      </button>
                    );
                  })}
              </div>
            ))}
            {showNow ? (
              <div
                className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-red-500"
                style={{
                  top: ((nowMinutes - bounds.start) / totalMinutes) * canvasHeight,
                }}
              />
            ) : null}
            {dayBookings.length === 0 ? (
              <div className="booking-empty-state pointer-events-none absolute inset-x-4 top-8">
                <p className="font-semibold text-zinc-950">
                  <WorkspaceText text="No appointments scheduled for this day." />
                </p>
                <p className="mt-1"><WorkspaceText text="Use New appointment to add a manual booking." /></p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}





function staffForBookingDisplay(
  booking: BookingWorkspaceItem,
  options: BookingWorkspaceClientProps["options"],
) {
  const assignedId =
    booking.lines.find((line) => line.assigned_staff_id)?.assigned_staff_id ??
    booking.staff_id ??
    null;

  if (!assignedId) {
    return null;
  }

  return options.staff.find((staff) => staff.id === assignedId) ?? null;
}

function bookingTicketConversionBlocked(booking: BookingWorkspaceItem) {
  return (
    booking.normalizedStatus === "pending" ||
    booking.normalizedStatus === "cancelled" ||
    booking.normalizedStatus === "no_show" ||
    ["requested", "cancelled", "declined"].includes(booking.confirmation_status)
  );
}

function editableServiceIds(booking: BookingWorkspaceItem) {
  const serviceIds = booking.lines
    .filter((line) => line.line_type !== "custom")
    .map((line) => line.service_id)
    .filter((serviceId): serviceId is string => Boolean(serviceId));

  return serviceIds.length > 0 ? serviceIds : [];
}

type AppointmentRowEditMode = "professional" | "services" | "status" | "time";

function serviceReplacementBlocked(booking: BookingWorkspaceItem) {
  return (
    Boolean(booking.posTicket) ||
    booking.normalizedStatus === "in_service" ||
    booking.normalizedStatus === "completed" ||
    booking.normalizedStatus === "cancelled" ||
    booking.normalizedStatus === "no_show"
  );
}

function serviceReplacementBlockMessage(booking: BookingWorkspaceItem) {
  if (booking.posTicket) {
    return "Open the POS ticket to adjust services after ticket creation.";
  }

  if (serviceReplacementBlocked(booking)) {
    return "This appointment can no longer have services adjusted.";
  }

  return null;
}

type QuickStatusCommand = Extract<
  Parameters<typeof runBookingStatusAction>[0]["command"],
  "cancel" | "confirm" | "mark_no_show" | "mark_no_show_excused"
>;

type QuickStatusAction = {
  command: QuickStatusCommand;
  label: string;
};

function quickStatusActions(status: string) {
  return actionSetForStatus(status)
    .filter((action) => ["confirm", "cancel", "mark_no_show", "mark_no_show_excused"].includes(action.command))
    .map<QuickStatusAction>((action) => ({
      command: action.command as QuickStatusCommand,
      label: action.label,
    }));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AppointmentRowEditDialog({
  booking: serverBooking,
  mode,
  onClose,
  options,
  timezone,
}: {
  booking: BookingWorkspaceItem;
  mode: AppointmentRowEditMode;
  onClose: () => void;
  options: BookingWorkspaceClientProps["options"];
  timezone: string;
}) {
  const __vt = useWorkspaceTranslation();

  const [booking]=useState(serverBooking);
  
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [startLocal, setStartLocal] = useState(
    toLocalInputValue(booking.start_at, timezone),
  );
  const [endLocal, setEndLocal] = useState(
    toLocalInputValue(booking.end_at, timezone),
  );
  const [overrideReason, setOverrideReason] = useState("");
  const statusOptions = quickStatusActions(booking.normalizedStatus);
  const [statusCommand, setStatusCommand] = useState<QuickStatusCommand>(
    statusOptions[0]?.command ?? "confirm",
  );
  const [statusReason, setStatusReason] = useState("");
  const [serviceIds, setServiceIds] = useState(editableServiceIds(booking));
  const [lineAssignments, setLineAssignments] = useState(
    booking.lines.map((line) => ({
      bookingLineId: line.id,
      staffId: line.assigned_staff_id ?? "",
    })),
  );
  const serviceBlockMessage = serviceReplacementBlockMessage(booking);
  const title =
    mode === "time"
      ? "Adjust time"
      : mode === "services"
        ? "Adjust services"
        : mode === "professional"
          ? "Adjust professional"
          : "Adjust status";

  function toggleService(serviceId: string, checked: boolean) {
    setServiceIds((current) => {
      if (checked) {
        return current.includes(serviceId) ? current : [...current, serviceId];
      }

      return current.filter((id) => id !== serviceId);
    });
  }

  function refreshOnSuccess(response: BookingActionResult) {
    setResult(response);

    if (response.ok) {
      
      onClose();
    }
  }

  function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const response = await runBookingStatusAction({
        bookingId: booking.id,
        expectedUpdatedAt: booking.updated_at,
        command: statusCommand,
        reason: statusReason,
      });
      refreshOnSuccess(response);
    });
  }

  function submitTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const response = await rescheduleOwnerBookingAction({
        bookingId: booking.id,
        expectedUpdatedAt: booking.updated_at,
        endLocal,
        overbookingOverrideReason: overrideReason,
        startLocal,
      });
      refreshOnSuccess(response);
    });
  }

  function submitServices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const response = await replaceOwnerBookingServicesAction({
        bookingId: booking.id,
        expectedUpdatedAt: booking.updated_at,
        overbookingOverrideReason: overrideReason,
        serviceIds,
      });
      refreshOnSuccess(response);
    });
  }

  function submitProfessional(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const response = await reassignOwnerBookingAction({
        bookingId: booking.id,
        expectedUpdatedAt: booking.updated_at,
        lineAssignments: lineAssignments.map((assignment) => ({
          bookingLineId: assignment.bookingLineId,
          staffId: assignment.staffId || null,
        })),
        overbookingOverrideReason: overrideReason,
      });
      refreshOnSuccess(response);
    });
  }

  return (
    <ModalFrame label={__vt(title)} onClose={onClose} size="detail">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold text-zinc-950"><WorkspaceText text={title} /></h2>
          <p className="mt-1 text-sm text-zinc-500">
            {booking.customer?.name ?? "Unknown customer"}
                    {Boolean(booking.noShowCount) && <span className="ml-2 inline-block rounded-full bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-800">{booking.noShowCount} <WorkspaceText text="previous no-show" />{booking.noShowCount === 1 ? "" : "s"}</span>} /{" "}
            <WorkspaceText text={formatDateTime(booking.start_at, timezone)} />
          </p>
        </div>
        <button
          className="grid size-10 place-items-center rounded-md border border-zinc-300 text-lg font-semibold"
          onClick={onClose}
          type="button"
        >
          x
        </button>
      </div>
      <div className="grid flex-1 gap-4 overflow-y-auto px-5 py-5">
        <Message result={result} />
        <BookingDepositReceipt booking={booking} />
        {mode === "status" ? (
          <form className="grid gap-4" onSubmit={submitStatus}>
            {statusOptions.length === 0 ? (
              <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
                <WorkspaceText text="This status has no quick confirm or cancel action." />
              </p>
            ) : (
              <>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Status" /></span>
                  <select
                    className={styles.select}
                    onChange={(event) =>
                      setStatusCommand(event.target.value as QuickStatusCommand)
                    }
                    value={statusCommand}
                  >
                    {statusOptions.map((action) => (
                      <option key={action.command} value={action.command}>
                        <WorkspaceText text={action.label} />
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-zinc-700">
                    <WorkspaceText text="Reason or note" />
                  </span>
                  <input
                    className={styles.field}
                    onChange={(event) => setStatusReason(event.target.value)}
                    value={statusReason}
                  />
                </label>
                <button
                  className={classNames(styles.primaryButton, "w-fit px-4")}
                  disabled={isPending}
                  type="submit"
                >
                  <WorkspaceText text={isPending ? "Saving" : "Save status"} />
                </button>
              </>
            )}
          </form>
        ) : null}

        {mode === "time" ? (
          <form className="grid gap-4" onSubmit={submitTime}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Start" /></span>
                <input
                  className={styles.field}
                  onChange={(event) => setStartLocal(event.target.value)}
                  type="datetime-local"
                  value={startLocal}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="End" /></span>
                <input
                  className={styles.field}
                  onChange={(event) => setEndLocal(event.target.value)}
                  type="datetime-local"
                  value={endLocal}
                />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                <WorkspaceText text="Override reason" />
              </span>
              <input
                className={styles.field}
                onChange={(event) => setOverrideReason(event.target.value)}
                value={overrideReason}
              />
            </label>
            <button
              className={classNames(styles.primaryButton, "w-fit px-4")}
              disabled={isPending}
              type="submit"
            >
              <WorkspaceText text={isPending ? "Saving" : "Save time"} />
            </button>
          </form>
        ) : null}

        {mode === "services" ? (
          <form className="grid gap-4" onSubmit={submitServices}>
            {serviceBlockMessage ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                <WorkspaceText text={serviceBlockMessage} />
              </p>
            ) : null}
            <div className="grid gap-2">
              {options.services.map((service) => (
                <label className="booking-choice-row" key={service.id}>
                  <input
                    checked={serviceIds.includes(service.id)}
                    disabled={Boolean(serviceBlockMessage)}
                    onChange={(event) =>
                      toggleService(service.id, event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold text-[#211c24]">
                      {service.name}
                    </span>
                    <span className="block text-xs text-[#786d78]">
                      {service.duration_minutes} <WorkspaceText text="min /" />{" "}
                      {formatMoney(Number(service.base_price))}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                <WorkspaceText text="Override reason" />
              </span>
              <input
                className={styles.field}
                disabled={Boolean(serviceBlockMessage)}
                onChange={(event) => setOverrideReason(event.target.value)}
                value={overrideReason}
              />
            </label>
            <button
              className={classNames(styles.primaryButton, "w-fit px-4")}
              disabled={
                isPending || Boolean(serviceBlockMessage) || serviceIds.length === 0
              }
              type="submit"
            >
              <WorkspaceText text={isPending ? "Saving" : "Save services"} />
            </button>
          </form>
        ) : null}

        {mode === "professional" ? (
          <form className="grid gap-4" onSubmit={submitProfessional}>
            {booking.lines.map((line, index) => (
              <label className="grid gap-1" key={line.id}>
                <span className="text-sm font-semibold text-zinc-700">
                  {line.service_name_snapshot}
                </span>
                <select
                  className={styles.select}
                  onChange={(event) => {
                    setLineAssignments((current) =>
                      current.map((assignment) =>
                        assignment.bookingLineId === line.id
                          ? { ...assignment, staffId: event.target.value }
                          : assignment,
                      ),
                    );
                  }}
                  value={lineAssignments[index]?.staffId ?? ""}
                >
                  <option value=""><WorkspaceText text="Unassigned" /></option>
                  {staffForService(options).map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.display_name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                <WorkspaceText text="Override reason" />
              </span>
              <input
                className={styles.field}
                onChange={(event) => setOverrideReason(event.target.value)}
                value={overrideReason}
              />
            </label>
            <button
              className={classNames(styles.primaryButton, "w-fit px-4")}
              disabled={isPending}
              type="submit"
            >
              <WorkspaceText text={isPending ? "Saving" : "Save professional"} />
            </button>
          </form>
        ) : null}
      </div>
    </ModalFrame>
  );
}

type AppointmentRowDraft = {
  endLocal: string;
  serviceIds: string[];
  staffIds: string[];
  startLocal: string;
  statusCommand: QuickStatusCommand | "";
  statusReason: string;
};

function padTwo(value: number) {
  return value.toString().padStart(2, "0");
}

function buildAppointmentRowTimeSlots() {
  const slots: string[] = [];

  for (let minutes = 7 * 60; minutes <= 21 * 60; minutes += 15) {
    slots.push(`${padTwo(Math.floor(minutes / 60))}:${padTwo(minutes % 60)}`);
  }

  return slots;
}

const APPOINTMENT_ROW_TIME_SLOTS = buildAppointmentRowTimeSlots();
const INLINE_POPOVER_GAP = 8;
const INLINE_POPOVER_VIEWPORT_MARGIN = 12;

function AppointmentInlinePopoverPortal<TElement extends HTMLElement>({
  anchorRef,
  children,
  onClose,
}: {
  anchorRef: { current: TElement | null };
  children: ReactNode;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const [position, setPosition] = useState({
    left: INLINE_POPOVER_VIEWPORT_MARGIN,
    top: INLINE_POPOVER_VIEWPORT_MARGIN,
    visible: false,
  });

  useEffect(() => {
    if (!portalTarget) {
      return;
    }

    function updatePosition() {
      const anchor = anchorRef.current;
      const overlay = overlayRef.current;

      if (!anchor || !overlay) {
        setPosition((current) => ({ ...current, visible: false }));
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const overlayRect = overlay.getBoundingClientRect();
      const overlayWidth = overlayRect.width;
      const overlayHeight = overlayRect.height;
      const maxLeft =
        window.innerWidth - overlayWidth - INLINE_POPOVER_VIEWPORT_MARGIN;
      const maxTop =
        window.innerHeight - overlayHeight - INLINE_POPOVER_VIEWPORT_MARGIN;
      const spaceBelow =
        window.innerHeight -
        anchorRect.bottom -
        INLINE_POPOVER_GAP -
        INLINE_POPOVER_VIEWPORT_MARGIN;
      const spaceAbove =
        anchorRect.top - INLINE_POPOVER_GAP - INLINE_POPOVER_VIEWPORT_MARGIN;
      const openAbove = overlayHeight > spaceBelow && spaceAbove > spaceBelow;
      const preferredTop = openAbove
        ? anchorRect.top - overlayHeight - INLINE_POPOVER_GAP
        : anchorRect.bottom + INLINE_POPOVER_GAP;

      setPosition({
        left: Math.max(
          INLINE_POPOVER_VIEWPORT_MARGIN,
          Math.min(anchorRect.left, maxLeft),
        ),
        top: Math.max(
          INLINE_POPOVER_VIEWPORT_MARGIN,
          Math.min(preferredTop, maxTop),
        ),
        visible: true,
      });
    }

    const animationFrame = window.requestAnimationFrame(updatePosition);

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, children, portalTarget]);

  useEffect(() => {
    if (!portalTarget) {
      return;
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (
        overlayRef.current?.contains(target) ||
        anchorRef.current?.contains(target)
      ) {
        return;
      }

      onClose();
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose, portalTarget]);

  if (!portalTarget) {
    return null;
  }

  return createPortal(
    <div
      className="booking-inline-popover-layer"
      data-booking-surface="owner"
      ref={overlayRef}
      style={{
        left: position.left,
        opacity: position.visible ? 1 : 0,
        pointerEvents: position.visible ? "auto" : "none",
        top: position.top,
      }}
    >
      {children}
    </div>,
    portalTarget,
  );
}

function appointmentEditableLines(booking: BookingWorkspaceItem) {
  return booking.lines.filter(
    (line) => line.line_type !== "custom" && Boolean(line.service_id),
  );
}

function appointmentRowDraftFromBooking(
  booking: BookingWorkspaceItem,
  timezone: string,
): AppointmentRowDraft {
  const editableLines = appointmentEditableLines(booking);

  return {
    endLocal: toLocalInputValue(booking.end_at, timezone),
    serviceIds: editableLines
      .map((line) => line.service_id)
      .filter((serviceId): serviceId is string => Boolean(serviceId)),
    staffIds: editableLines.map((line) => line.assigned_staff_id ?? ""),
    startLocal: toLocalInputValue(booking.start_at, timezone),
    statusCommand: "",
    statusReason: "",
  };
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatLocalInputTime(value: string) {
  const time = value.slice(11, 16);
  const [hourValue, minuteValue] = time.split(":").map(Number);

  if (!Number.isFinite(hourValue) || !Number.isFinite(minuteValue)) {
    return time || "-";
  }

  const period = hourValue >= 12 ? "PM" : "AM";
  const hour = hourValue % 12 || 12;

  return `${hour}:${padTwo(minuteValue)} ${period}`;
}

function addMinutesToLocalInput(value: string, minutesToAdd: number) {
  const [datePart, timePart = "00:00"] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute + minutesToAdd),
  );

  return `${date.getUTCFullYear()}-${padTwo(date.getUTCMonth() + 1)}-${padTwo(
    date.getUTCDate(),
  )}T${padTwo(date.getUTCHours())}:${padTwo(date.getUTCMinutes())}`;
}

function appointmentCleanupBufferMinutes(booking: BookingWorkspaceItem) {
  return Number(
    booking.lines.find((line) => Number(line.cleanup_buffer_minutes) > 0)
      ?.cleanup_buffer_minutes ?? 0,
  );
}

function appointmentRowDurationMinutes(
  booking: BookingWorkspaceItem,
  options: BookingWorkspaceClientProps["options"],
  serviceIds: string[],
) {
  const cleanupBufferMinutes = appointmentCleanupBufferMinutes(booking);

  return serviceIds.reduce((sum, serviceId) => {
    const service = options.services.find((candidate) => candidate.id === serviceId);

    return sum + (service?.duration_minutes ?? 0) + cleanupBufferMinutes;
  }, 0);
}

function withAppointmentDraftEnd(
  booking: BookingWorkspaceItem,
  draft: AppointmentRowDraft,
  options: BookingWorkspaceClientProps["options"],
) {
  const durationMinutes = appointmentRowDurationMinutes(
    booking,
    options,
    draft.serviceIds,
  );

  if (durationMinutes <= 0 || !draft.startLocal) {
    return draft;
  }

  return {
    ...draft,
    endLocal: addMinutesToLocalInput(draft.startLocal, durationMinutes),
  };
}

function appointmentRowServiceSummary(
  options: BookingWorkspaceClientProps["options"],
  serviceIds: string[],
) {
  const services = serviceIds
    .map((serviceId) => options.services.find((service) => service.id === serviceId))
    .filter((service): service is BookingWorkspaceClientProps["options"]["services"][number] =>
      Boolean(service),
    );
  const primary = services[0]?.name ?? "No services";
  const extraCount = Math.max(0, services.length - 1);

  return {
    detail: extraCount > 0 ? `+${extraCount} more` : "No add-ons",
    primary,
  };
}

function staffForServiceId(
  options: BookingWorkspaceClientProps["options"],
  serviceId: string,
) {
  const eligibleStaffIds = new Set(
    options.assignments
      .filter(
        (assignment) =>
          assignment.is_active &&
          assignment.service_id === serviceId &&
          Boolean(assignment.staff_id),
      )
      .map((assignment) => assignment.staff_id),
  );
  const activeStaff = options.staff.filter((staff) => staff.is_active);

  return eligibleStaffIds.size > 0
    ? activeStaff.filter((staff) => eligibleStaffIds.has(staff.id))
    : activeStaff;
}

function normalizeAppointmentDraftStaffIds(
  options: BookingWorkspaceClientProps["options"],
  serviceIds: string[],
  staffIds: string[],
) {
  return serviceIds.map((serviceId, index) => {
    const staffId = staffIds[index] ?? "";

    if (!staffId) {
      return "";
    }

    return staffForServiceId(options, serviceId).some((staff) => staff.id === staffId)
      ? staffId
      : "";
  });
}

function appointmentDraftStaffSummary(
  options: BookingWorkspaceClientProps["options"],
  staffIds: string[],
) {
  const names = [
    ...new Set(
      staffIds
        .map((staffId) => options.staff.find((staff) => staff.id === staffId)?.display_name)
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  return names.join(", ") || "Unassigned";
}

function statusAfterDraftCommand(
  booking: BookingWorkspaceItem,
  command: AppointmentRowDraft["statusCommand"],
) {
  if (command === "cancel") {
    return "cancelled";
  }

  if (command === "mark_no_show" || command === "mark_no_show_excused") return "no_show";
  if (command === "confirm") {
    return "confirmed";
  }

  return booking.normalizedStatus;
}

function AppointmentRowInlinePopover({
  booking,
  draft,
  mode,
  onChange,
  onClose,
  options,
}: {
  booking: BookingWorkspaceItem;
  draft: AppointmentRowDraft;
  mode: AppointmentRowEditMode;
  onChange: (draft: AppointmentRowDraft) => void;
  onClose: () => void;
  options: BookingWorkspaceClientProps["options"];
}) {
  const __vt = useWorkspaceTranslation();

  const serviceBlockMessage = serviceReplacementBlockMessage(booking);
  const selectedDate = draft.startLocal.slice(0, 10);
  const selectedTime = draft.startLocal.slice(11, 16);
  const statusOptions = quickStatusActions(booking.normalizedStatus);
  const noShowClock = useBookingClock();
  const canConfirm = statusOptions.some((action) => action.command === "confirm");
  const canCancel = statusOptions.some((action) => action.command === "cancel");

  function updateStart(nextDate: string, nextTime: string) {
    const startLocal = `${nextDate}T${nextTime}`;
    onChange(
      withAppointmentDraftEnd(
        booking,
        {
          ...draft,
          startLocal,
        },
        options,
      ),
    );
  }

  function updateServices(serviceId: string, checked: boolean) {
    if (serviceBlockMessage) {
      return;
    }

    const serviceIds = checked
      ? [...draft.serviceIds, serviceId]
      : draft.serviceIds.filter((id) => id !== serviceId);
    const staffIds = normalizeAppointmentDraftStaffIds(
      options,
      serviceIds,
      draft.staffIds,
    );

    onChange(
      withAppointmentDraftEnd(
        booking,
        {
          ...draft,
          serviceIds,
          staffIds,
        },
        options,
      ),
    );
  }

  function updateStaff(index: number, staffId: string) {
    onChange({
      ...draft,
      staffIds: draft.serviceIds.map((_, staffIndex) =>
        staffIndex === index ? staffId : draft.staffIds[staffIndex] ?? "",
      ),
    });
  }

  if (mode === "time") {
    return (
      <div className="booking-inline-popover" role="dialog" aria-label={__vt("Adjust time")}>
        <div className="booking-inline-popover__header">
          <span><WorkspaceText text="Date & time" /></span>
          <button onClick={onClose} type="button">
            x
          </button>
        </div>
        <input
          className="booking-inline-date"
          onChange={(event) => updateStart(event.target.value, selectedTime || "09:00")}
          type="date"
          value={selectedDate}
        />
        <div className="booking-time-chip-grid">
          {APPOINTMENT_ROW_TIME_SLOTS.map((slot) => (
            <button
              className={classNames(
                "booking-chip-button",
                selectedTime === slot && "booking-chip-button-active",
              )}
              key={slot}
              onClick={() => {
                updateStart(selectedDate, slot);
                onClose();
              }}
              type="button"
            >
              <WorkspaceText text={formatLocalInputTime(`${selectedDate}T${slot}`)} />
            </button>
          ))}
        </div>
        <p className="booking-inline-note">
          <WorkspaceText text="Ends" /> <WorkspaceText text={formatLocalInputTime(draft.endLocal)} />
        </p>
      </div>
    );
  }

  if (mode === "services") {
    return (
      <div
        className="booking-inline-popover booking-inline-popover--wide"
        role="dialog"
        aria-label={__vt("Adjust services")}
      >
        <div className="booking-inline-popover__header">
          <span><WorkspaceText text="Services & add-ons" /></span>
          <button onClick={onClose} type="button">
            <WorkspaceText text="Done" />
          </button>
        </div>
        {serviceBlockMessage ? (
          <p className="booking-inline-warning"><WorkspaceText text={serviceBlockMessage} /></p>
        ) : null}
        <div className="booking-inline-list">
          {options.services.map((service) => (
            <label className="booking-inline-choice" key={service.id}>
              <input
                checked={draft.serviceIds.includes(service.id)}
                disabled={Boolean(serviceBlockMessage)}
                onChange={(event) => updateServices(service.id, event.target.checked)}
                type="checkbox"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-extrabold text-[#211c24]">
                  {service.name}
                </span>
                <span className="block truncate text-xs text-[#786d78]">
                  {service.category ? `${service.category} / ` : ""}
                  {service.duration_minutes} <WorkspaceText text="min /" /> {formatMoney(Number(service.base_price))}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="booking-inline-note">
          <WorkspaceText text="Total" /> {formatMinutes(appointmentRowDurationMinutes(booking, options, draft.serviceIds))}
        </p>
      </div>
    );
  }

  if (mode === "professional") {
    return (
      <div
        className="booking-inline-popover booking-inline-popover--wide"
        role="dialog"
        aria-label={__vt("Adjust professional")}
      >
        <div className="booking-inline-popover__header">
          <span><WorkspaceText text="Professional" /></span>
          <button onClick={onClose} type="button">
            <WorkspaceText text="Done" />
          </button>
        </div>
        <div className="booking-inline-list">
          {draft.serviceIds.map((serviceId, index) => {
            const service = options.services.find((candidate) => candidate.id === serviceId);

            return (
              <label className="booking-inline-select-row" key={`${serviceId}-${index}`}>
                <span>{service?.name ?? `Service ${index + 1}`}</span>
                <select
                  onChange={(event) => updateStaff(index, event.target.value)}
                  value={draft.staffIds[index] ?? ""}
                >
                  <option value=""><WorkspaceText text="Any / unassigned" /></option>
                  {staffForServiceId(options, serviceId).map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.display_name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="booking-inline-popover booking-inline-popover--status" role="dialog" aria-label={__vt("Adjust status")}>
      <div className="booking-inline-popover__header">
        <span><WorkspaceText text="Status" /></span>
        <button onClick={onClose} type="button">
          x
        </button>
      </div>
      <input
        className="booking-inline-date"
        onChange={(event) =>
          onChange({
            ...draft,
            statusReason: event.target.value,
          })
        }
        placeholder={__vt("Note optional")}
        value={draft.statusReason}
      />
      <div className="booking-inline-status-actions">
        {statusOptions.filter(action => action.command === "mark_no_show" || action.command === "mark_no_show_excused").map(action => <button key={action.command} className="booking-inline-cancel-button" disabled={booking.normalizedStatus !== "no_show" && Date.parse(booking.start_at) > noShowClock} onClick={() => {onChange({...draft,statusCommand:action.command});onClose();}} type="button"><WorkspaceText text={action.label} /></button>)}
        <button
          className="booking-inline-confirm-button"
          disabled={!canConfirm}
          onClick={() => {
            onChange({ ...draft, statusCommand: "confirm" });
            onClose();
          }}
          type="button"
        >
          <WorkspaceText text="Confirm" />
        </button>
        <button
          className="booking-inline-cancel-button"
          disabled={!canCancel}
          onClick={() => {
            onChange({ ...draft, statusCommand: "cancel" });
            onClose();
          }}
          type="button"
        >
          <WorkspaceText text="Cancel" />
        </button>
      </div>
    </div>
  );
}

function AppointmentTableRow({
  booking: serverBooking,
  canManage,
  onOpen,
  options,
  showDate,
  timezone,
}: {
  booking: BookingWorkspaceItem;
  canManage: boolean;
  onOpen: (booking: BookingWorkspaceItem) => void;
  options: BookingWorkspaceClientProps["options"];
  showDate: boolean;
  timezone: string;
}) {
  const __vt = useWorkspaceTranslation();

  const [booking,setBooking]=useState(serverBooking);
  
  const timeAnchorRef = useRef<HTMLButtonElement | null>(null);
  const servicesAnchorRef = useRef<HTMLButtonElement | null>(null);
  const professionalAnchorRef = useRef<HTMLButtonElement | null>(null);
  const statusAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [popover, setPopover] = useState<AppointmentRowEditMode | null>(null);
  const [draft, setDraft] = useState(() =>
    appointmentRowDraftFromBooking(booking, timezone),
  );
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const originalDraft = appointmentRowDraftFromBooking(booking, timezone);
  const summary = appointmentRowServiceSummary(options, draft.serviceIds);
  const draftStaffName = appointmentDraftStaffSummary(options, draft.staffIds);
  const draftStaff =
    options.staff.find((staff) => staff.id === draft.staffIds.find(Boolean)) ??
    staffForBookingDisplay(booking, options);
  const timeChanged =
    draft.startLocal !== originalDraft.startLocal ||
    draft.endLocal !== originalDraft.endLocal;
  const servicesChanged = !sameStringArray(
    draft.serviceIds,
    originalDraft.serviceIds,
  );
  const staffChanged = !sameStringArray(draft.staffIds, originalDraft.staffIds);
  const statusChanged = Boolean(draft.statusCommand);
  const hasDraftChanges =
    timeChanged || servicesChanged || staffChanged || statusChanged;
  const draftValidationMessage =
    draft.serviceIds.length === 0
      ? "Select at least one service before saving."
      : servicesChanged
        ? serviceReplacementBlockMessage(booking)
        : null;
  const statusEditable = canManage && quickStatusActions(booking.normalizedStatus).length > 0;
  const ticketConversionBlocked = bookingTicketConversionBlocked(booking);
  const customerProfileHref = booking.customer?.id
    ? `/customers/${booking.customer.id}`
    : null;
  const beautyProfileHref = booking.beautyProfile?.href ?? null;
  const draftStatus = statusAfterDraftCommand(booking, draft.statusCommand);
  const changeLabels = [
    timeChanged ? "time" : null,
    servicesChanged ? "services" : null,
    staffChanged ? "professional" : null,
    statusChanged ? "status" : null,
  ].filter((label): label is string => Boolean(label));

  if(booking!==serverBooking&&!hasDraftChanges&&!popover&&!isPending){
    setBooking(serverBooking);setDraft(appointmentRowDraftFromBooking(serverBooking,timezone));
  }
  function updateDraft(nextDraft: AppointmentRowDraft) {
    setDraft(nextDraft);
    setResult(null);
  }

  function resetDraft() {
    setDraft(originalDraft);
    setPopover(null);
    setResult(null);
  }

  function createTicket() {
    setResult(null);
    startTransition(async () => {
      const response = await createBookingPosTicketAction({
        bookingId: booking.id,
      });
      setResult(response);

      if (response.ok) {
        
      }
    });
  }

  function saveDraft() {
    if (draftValidationMessage) {
      setResult({
        message: draftValidationMessage,
        ok: false,
      });
      return;
    }

    if (!hasDraftChanges) {
      setResult({
        bookingId: booking.id,
        message: "No appointment changes to save.",
        ok: true,
      });
      return;
    }

    setResult(null);
    startTransition(async () => {
      const response=await saveOwnerWorkspaceBookingAction({
        bookingId:booking.id,expectedUpdatedAt:booking.updated_at,
        ...(timeChanged?{startLocal:draft.startLocal,endLocal:draft.endLocal}:{}),
        ...(servicesChanged?{serviceIds:draft.serviceIds,staffIds:draft.staffIds.map(id=>id||null)}:staffChanged?{lineAssignments:appointmentEditableLines(booking).map((line,index)=>({bookingLineId:line.id,staffId:draft.staffIds[index]||null}))}:{}),
        ...(draft.statusCommand?{command:draft.statusCommand,reason:draft.statusReason}:{}),
      });
      if(!response.ok){setResult(response);return;}

      setResult({
        bookingId: booking.id,
        message: "Appointment changes saved.",
        ok: true,
        ticketId: response?.ticketId,
      });
      setDraft(originalDraft);
      setPopover(null);
      
    });
  }

  return (
    <>
      <div className={styles.tableRow}>
        <div>
          <div className="booking-inline-anchor">
            <button
              aria-label={__vt("Adjust appointment time")}
              className={classNames(
                "booking-cell-button",
                timeChanged && "booking-cell-button-dirty",
              )}
              disabled={!canManage}
              onClick={() => setPopover(popover === "time" ? null : "time")}
              ref={timeAnchorRef}
              type="button"
            >
              <span className="grid text-sm font-extrabold text-[#211c24]">
                {showDate ? (
                  <span className="mb-1 text-xs font-semibold text-[#f26f3d]">
                    <WorkspaceText text={formatShortDateFromDate(draft.startLocal.slice(0, 10), timezone)} />
                  </span>
                ) : null}
                <span><WorkspaceText text={formatLocalInputTime(draft.startLocal)} /></span>
                <span className="mt-1 text-xs font-medium text-[#786d78]">
                  <WorkspaceText text={formatLocalInputTime(draft.endLocal)} />
                </span>
              </span>
            </button>
            {popover === "time" ? (
              <AppointmentInlinePopoverPortal
                anchorRef={timeAnchorRef}
                onClose={() => setPopover(null)}
              >
                <AppointmentRowInlinePopover
                  booking={booking}
                  draft={draft}
                  mode="time"
                  onChange={updateDraft}
                  onClose={() => setPopover(null)}
                  options={options}
                />
              </AppointmentInlinePopoverPortal>
            ) : null}
          </div>
        </div>
        <div>
          <div className="booking-inline-anchor">
            <button
              aria-label={__vt("Adjust appointment professional")}
              className={classNames(
                "booking-cell-button",
                staffChanged && "booking-cell-button-dirty",
              )}
              disabled={!canManage}
              onClick={() =>
                setPopover(popover === "professional" ? null : "professional")
              }
              ref={professionalAnchorRef}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-2">
                <StaffAvatar
                  imageUrl={draftStaff?.public_profile_photo_path}
                  label={__vt(draftStaff?.display_name ?? draftStaffName)}
                  size="small"
                />
                <span className="truncate text-sm font-extrabold text-[#211c24]">
                  {draftStaffName}
                </span>
              </span>
            </button>
            {popover === "professional" ? (
              <AppointmentInlinePopoverPortal
                anchorRef={professionalAnchorRef}
                onClose={() => setPopover(null)}
              >
                <AppointmentRowInlinePopover
                  booking={booking}
                  draft={draft}
                  mode="professional"
                  onChange={updateDraft}
                  onClose={() => setPopover(null)}
                  options={options}
                />
              </AppointmentInlinePopoverPortal>
            ) : null}
          </div>
        </div>
        <div>
          <div className="booking-inline-anchor">
            <button
              aria-label={__vt("Adjust appointment services")}
              className={classNames(
                "booking-cell-button",
                servicesChanged && "booking-cell-button-dirty",
              )}
              disabled={!canManage}
              onClick={() => setPopover(popover === "services" ? null : "services")}
              ref={servicesAnchorRef}
              title={__vt(serviceReplacementBlockMessage(booking) ?? undefined)}
              type="button"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-extrabold text-[#211c24]">
                  {summary.primary}
                </span>
                <span className="block truncate text-xs text-[#786d78]">
                  {summary.detail}
                </span>
              </span>
            </button>
            {popover === "services" ? (
              <AppointmentInlinePopoverPortal
                anchorRef={servicesAnchorRef}
                onClose={() => setPopover(null)}
              >
                <AppointmentRowInlinePopover
                  booking={booking}
                  draft={draft}
                  mode="services"
                  onChange={updateDraft}
                  onClose={() => setPopover(null)}
                  options={options}
                />
              </AppointmentInlinePopoverPortal>
            ) : null}
          </div>
        </div>
        <div>
          <span className="grid min-w-0 gap-1.5">
            {beautyProfileHref ? (
              <a
                className="group flex min-w-0 items-center gap-3 rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-[#f26f3d]/35"
                href={beautyProfileHref}
              >
                <StaffAvatar label={booking.customer?.name ?? "Guest"} size="small" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-extrabold text-[#211c24] group-hover:text-[#f26f3d] group-hover:underline group-hover:underline-offset-3">
                    {booking.customer?.name ?? "Unknown customer"}
                    {Boolean(booking.noShowCount) && <span className="ml-2 inline-block rounded-full bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-800">{booking.noShowCount} <WorkspaceText text="previous no-show" />{booking.noShowCount === 1 ? "" : "s"}</span>}
                  </span>
                </span>
              </a>
            ) : (
              <span className="flex min-w-0 items-center gap-3">
                <StaffAvatar label={booking.customer?.name ?? "Guest"} size="small" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-extrabold text-[#211c24]">
                    {booking.customer?.name ?? "Unknown customer"}
                    {Boolean(booking.noShowCount) && <span className="ml-2 inline-block rounded-full bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-800">{booking.noShowCount} <WorkspaceText text="previous no-show" />{booking.noShowCount === 1 ? "" : "s"}</span>}
                  </span>
                </span>
              </span>
            )}
            <span className="min-w-0">
              {customerProfileHref ? (
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <a className="booking-profile-link" href={customerProfileHref}>
                    <WorkspaceText text="Customer details" />
                  </a>
                  <span className="block truncate text-xs font-semibold text-[#786d78]">
                    <WorkspaceText text={sourceLabel(booking.source)} />
                  </span>
                </span>
              ) : (
                <span className="block truncate text-xs text-[#786d78]">
                  <WorkspaceText text={sourceLabel(booking.source)} />
                </span>
              )}
            </span>
          </span>
        </div>
        <div>
          <span className="text-sm font-extrabold text-[#211c24]">
            {formatMoney(booking.subtotal)}
          </span>
        </div>
        <div>
          <div className="booking-inline-anchor">
            <button
              aria-label={__vt("Adjust appointment status")}
              className={classNames(
                "booking-status-button",
                statusChanged && "booking-cell-button-dirty",
              )}
              disabled={!statusEditable}
              onClick={() => setPopover(popover === "status" ? null : "status")}
              ref={statusAnchorRef}
              type="button"
            >
              <StatusBadge status={draftStatus} kind={draft.statusCommand === "mark_no_show_excused" ? "excused" : draft.statusCommand === "mark_no_show" ? "unexcused" : booking.no_show_kind} />
            </button>
            {popover === "status" ? (
              <AppointmentInlinePopoverPortal
                anchorRef={statusAnchorRef}
                onClose={() => setPopover(null)}
              >
                <AppointmentRowInlinePopover
                  booking={booking}
                  draft={draft}
                  mode="status"
                  onChange={updateDraft}
                  onClose={() => setPopover(null)}
                  options={options}
                />
              </AppointmentInlinePopoverPortal>
            ) : null}
          </div>
        </div>
        <div>
          {booking.posTicket ? (
            <a
              className="booking-row-action-button"
              href={`/pos-tickets/${booking.posTicket.id}`}
            >
              <WorkspaceText text="Open ticket" />
            </a>
          ) : (
            <button
              className="booking-row-action-button"
              disabled={!canManage || isPending || ticketConversionBlocked}
              onClick={createTicket}
              title={__vt(ticketConversionBlocked ? "Confirm this appointment before creating a ticket." : undefined)}
              type="button"
            >
              <WorkspaceText text={isPending ? "Creating" : "Create ticket"} />
            </button>
          )}
        </div>
        <div>
          <button
            aria-label={__vt("Open appointment settings")}
            className="booking-settings-button"
            onClick={() => onOpen(booking)}
            type="button"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
      {result ? (
        <div className="booking-table-row-message">
          <Message result={result} />
        </div>
      ) : null}
      {hasDraftChanges ? (
        <div className="booking-table-row-message">
          <div className="booking-row-save-bar">
            <span>
              <WorkspaceText text={changeLabels.join(", ")} /> <WorkspaceText text="ready to save." />
            </span>
            <div>
              <button
                className="booking-row-action-button booking-row-save-button"
                disabled={isPending || Boolean(draftValidationMessage)}
                onClick={saveDraft}
                type="button"
              >
                <WorkspaceText text={isPending ? "Saving" : "Confirm changes"} />
              </button>
              <button
                className="booking-row-action-button"
                disabled={isPending}
                onClick={resetDraft}
                type="button"
              >
                <WorkspaceText text="Reset" />
              </button>
            </div>
          </div>
          {draftValidationMessage ? (
            <p className="booking-inline-warning mt-2"><WorkspaceText text={draftValidationMessage} /></p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function CalendarView({
  bookings,
  canManage,
  filters,
  onOpen,
  options,
  range,
  timezone,
}: {
  bookings: BookingWorkspaceItem[];
  canManage: boolean;
  filters: BookingWorkspaceFilters;
  onOpen: (booking: BookingWorkspaceItem) => void;
  options: BookingWorkspaceClientProps["options"];
  range: BookingWorkspaceClientProps["range"];
  timezone: string;
}) {
  const visibleBookings = filters.status ? bookings : bookings.filter(activeBooking);

  if (filters.view === "week") {
    return (
      <div className="grid gap-3 lg:grid-cols-7">
        {range.days.map((day) => {
          const dayBookings = visibleBookings.filter(
            (booking) => dateParts(booking.start_at, timezone).date === day.date,
          );

          return (
            <section
              className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50"
              key={day.date}
            >
              <div className="border-b border-zinc-200 px-3 py-2">
                <h3 className="text-sm font-semibold text-zinc-950"><WorkspaceText text={day.label} /></h3>
                <p className="text-xs text-zinc-500">{dayBookings.length} <WorkspaceText text="booked" /></p>
              </div>
              <div className="grid gap-2 p-2">
                {dayBookings.length === 0 ? (
                  <p className="booking-empty-state px-3 py-6">
                    <WorkspaceText text="No appointments" />
                  </p>
                ) : (
                  dayBookings.map((booking) => (
                    <AppointmentCard
                      booking={booking}
                      key={booking.id}
                      onOpen={onOpen}
                      timezone={timezone}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  if (filters.view === "list") {
    if (visibleBookings.length === 0) {
      return (
        <div className="booking-empty-state m-5">
          <p className="font-extrabold text-[#211c24]">
            <WorkspaceText text="No appointments match this" /> <WorkspaceText text={filters.dateRange === "day" ? "day" : "range"} />.
          </p>
          <p className="mt-1"><WorkspaceText text="Try another date or clear filters." /></p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <div><WorkspaceText text="Time" /></div>
            <div><WorkspaceText text="Professional" /></div>
            <div><WorkspaceText text="Services" /></div>
            <div><WorkspaceText text="Customer" /></div>
            <div><WorkspaceText text="Total" /></div>
            <div><WorkspaceText text="Status" /></div>
            <div><WorkspaceText text="Create ticket" /></div>
            <div><WorkspaceText text="Edit" /></div>
          </div>
          {visibleBookings.map((booking) => (
            <AppointmentTableRow
              booking={booking}
              canManage={canManage}
              key={booking.id}
              onOpen={onOpen}
              options={options}
              showDate={filters.dateRange !== "day"}
              timezone={timezone}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <DayCalendarCanvas
      bookings={visibleBookings}
      filters={filters}
      onOpen={onOpen}
      options={options}
      timezone={timezone}
    />
  );
}

function eventLabel(event: BookingStatusEvent) {
  return event.event_type.replace(/_/g, " ");
}

function CustomerInspirationSection({
  booking,
}: {
  booking: BookingWorkspaceItem;
}) {
  const __vt = useWorkspaceTranslation();

  const inspiration = booking.inspiration;

  if (!inspiration) {
    return null;
  }

  return (
    <section>
      <h3 className="text-sm font-semibold uppercase text-zinc-500">
        <WorkspaceText text="Customer inspiration" />
      </h3>
      <div className="mt-2 grid gap-3 rounded-lg border border-zinc-200 bg-white p-3 sm:grid-cols-[96px_1fr]">
        <a
          className="block h-24 w-24 overflow-hidden rounded-lg bg-zinc-100"
          href={inspiration.imageUrl ?? undefined}
          rel="noreferrer"
          target={inspiration.imageUrl ? "_blank" : undefined}
        >
          {inspiration.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={__vt("")} className="h-full w-full object-cover" src={inspiration.imageUrl} />
          ) : (
            <span className="grid h-full w-full place-items-center text-sm font-semibold text-zinc-500">
              <WorkspaceText text="Look" />
            </span>
          )}
        </a>
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-zinc-950">
            <WorkspaceText text={inspiration.source_title_snapshot ?? "Booked look"} />
          </p>
          <p className="mt-1 font-semibold text-[#f26f3d]">
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
            <p className="mt-2 line-clamp-3 text-zinc-600">
              {inspiration.source_caption_snapshot}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DetailDrawer({
  booking: serverBooking,
  canManage,
  onClose,
  options,
  settings,
  timezone,
}: {
  booking: BookingWorkspaceItem;
  canManage: boolean;
  onClose: () => void;
  options: BookingWorkspaceClientProps["options"];
  settings: BookingWorkspaceClientProps["settings"];
  timezone: string;
}) {
  const __vt = useWorkspaceTranslation();

  const [booking]=useState(serverBooking);
  const [pendingAction, setPendingAction] = useState("");
  
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [rescheduleStart, setRescheduleStart] = useState(
    toLocalInputValue(booking.start_at, timezone),
  );
  const [rescheduleEnd, setRescheduleEnd] = useState(
    toLocalInputValue(booking.end_at, timezone),
  );
  const [reason, setReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [lineAssignments, setLineAssignments] = useState(
    booking.lines.map((line) => ({
      bookingLineId: line.id,
      staffId: line.assigned_staff_id ?? "",
    })),
  );
  const noShowClock = useBookingClock();
  const validActions = actionSetForStatus(booking.normalizedStatus);
  const hasTicket = Boolean(booking.posTicket);
  const ticketConversionBlocked = bookingTicketConversionBlocked(booking);
  const missingStaff = booking.lines.some((line) => !line.assigned_staff_id);
  const paymentPending =
    booking.normalizedStatus === "completed" &&
    booking.posTicket &&
    booking.posTicket.paymentStatus !== "paid";

  function runStatus(command: Parameters<typeof runBookingStatusAction>[0]["command"]) {
    if (isPending) return;
    setPendingAction("status:" + command);
    setResult(null);
    startTransition(async () => {
      const response = await runBookingStatusAction({
        bookingId: booking.id,
        expectedUpdatedAt: booking.updated_at,
        command,
        reason,
      });
      setResult(response);

      if (response.ok) {
        
        onClose();
      }
    });
  }

  function runReschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setPendingAction("reschedule");
    setResult(null);
    startTransition(async () => {
      const response = await rescheduleOwnerBookingAction({
        bookingId: booking.id,
        expectedUpdatedAt: booking.updated_at,
        endLocal: rescheduleEnd,
        overbookingOverrideReason: overrideReason,
        startLocal: rescheduleStart,
      });
      setResult(response);

      if (response.ok) {
        
        onClose();
      }
    });
  }

  function runReassign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) return;
    setPendingAction("reassign");
    setResult(null);
    startTransition(async () => {
      const response = await reassignOwnerBookingAction({
        bookingId: booking.id,
        expectedUpdatedAt: booking.updated_at,
        lineAssignments: lineAssignments.map((assignment) => ({
          bookingLineId: assignment.bookingLineId,
          staffId: assignment.staffId || null,
        })),
        overbookingOverrideReason: overrideReason,
      });
      setResult(response);

      if (response.ok) {
        
        onClose();
      }
    });
  }

  function createTicket() {
    if (isPending) return;
    setPendingAction("ticket");
    setResult(null);
    startTransition(async () => {
      const response = await createBookingPosTicketAction({
        bookingId: booking.id,
      });
      setResult(response);

      if (response.ok) {
        
        onClose();
      }
    });
  }

  return (
    <ModalFrame label={__vt(canManage ? "Manage appointment" : "Appointment details")} onClose={onClose} size="detail">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold text-zinc-950">
            {booking.customer?.name ?? "Unknown customer"}
                    {Boolean(booking.noShowCount) && <span className="ml-2 inline-block rounded-full bg-orange-50 px-2 py-1 text-[11px] font-semibold text-orange-800">{booking.noShowCount} <WorkspaceText text="previous no-show" />{booking.noShowCount === 1 ? "" : "s"}</span>}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            <WorkspaceText text={formatDateTime(booking.start_at, timezone)} />
          </p>
        </div>
        <button
          className="grid size-10 place-items-center rounded-md border border-zinc-300 text-lg font-semibold"
          onClick={onClose}
          type="button"
        >
          x
        </button>
      </div>
      <div className="grid flex-1 gap-6 overflow-y-auto px-5 py-5">
        <Message result={result} />
        <section className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={booking.normalizedStatus} kind={booking.no_show_kind} />
            <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-600">
              <WorkspaceText text={sourceLabel(booking.source)} />
            </span>
            <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-600">
              {booking.confirmation_status}
            </span>
          </div>
          <div className="grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
            <p>
              <span className="font-semibold text-zinc-950"><WorkspaceText text="Customer:" /> </span>
              {booking.customer?.name ?? "Unknown"}
            </p>
            <p>
              <span className="font-semibold text-zinc-950"><WorkspaceText text="Contact:" /> </span>
              {canManage
                ? [booking.customer?.phone, booking.customer?.email]
                    .filter(Boolean)
                    .join(" / ") || "Not provided"
                : "Restricted"}
            </p>
            <p>
              <span className="font-semibold text-zinc-950"><WorkspaceText text="Total:" /> </span>
              {formatMoney(booking.subtotal)}
            </p>
          </div>
        </section>

        <details className="owner-manage-disclosure">
          <summary><WorkspaceText text="Services" /></summary>
          <div className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {booking.lines.map((line) => (
              <div className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]" key={line.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-950">
                    {line.service_name_snapshot}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">
                    {line.duration_minutes} <WorkspaceText text="min /" /> {formatMoney(Number(line.line_total))}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-zinc-600">
                    {line.line_status.replace(/_/g, " ")}
                    <WorkspaceText text={line.performedByStaffName
                      ? ` by ${line.performedByStaffName}`
                      : ""} />
                  </p>
                  {line.service_note ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      <WorkspaceText text="Note:" /> {line.service_note}
                    </p>
                  ) : null}
                  {line.overbooking_override_reason ? (
                    <p className="mt-1 text-xs font-semibold text-amber-700">
                      <WorkspaceText text="Override:" /> {line.overbooking_override_reason}
                    </p>
                  ) : null}
                </div>
                <div className="text-sm text-zinc-700 sm:text-right">
                  <p><WorkspaceText text={line.assignedStaffName ?? "Unassigned"} /></p>
                  <p className="mt-1 text-xs text-zinc-500">
                    <WorkspaceText text={line.scheduled_start_at
                      ? `${formatTime(line.scheduled_start_at, timezone)} - ${formatTime(
                          line.scheduled_end_at ?? booking.end_at,
                          timezone,
                        )}`
                      : "No line schedule"} />
                  </p>
                </div>
              </div>
            ))}
          </div>
        </details>

        <CustomerInspirationSection booking={booking} />

        <section className="grid gap-2 text-sm text-zinc-700">
          <h3 className="text-sm font-semibold uppercase text-zinc-500"><WorkspaceText text="Notes" /></h3>
          <p>
            <span className="font-semibold text-zinc-950"><WorkspaceText text="Public:" /> </span>
            <WorkspaceText text={booking.public_notes || booking.notes || "None"} />
          </p>
          <p>
            <span className="font-semibold text-zinc-950"><WorkspaceText text="Internal:" /> </span>
            <WorkspaceText text={canManage ? booking.internal_notes || "None" : "Restricted"} />
          </p>
          {booking.cancellation_reason ? (
            <p>
              <span className="font-semibold text-zinc-950"><WorkspaceText text="Cancellation:" /> </span>
              {booking.cancellation_reason}
            </p>
          ) : null}
          {canManage ? <HistoryLinkControl owner bookingId={booking.id} timezone={timezone} /> : null}
          {booking.no_show_reason ? (
            <p>
              <span className="font-semibold text-zinc-950"><WorkspaceText text="No-show:" /> </span>
              {booking.no_show_reason}
            </p>
          ) : null}
          {booking.pos_ticket_id ? (
            <p>
              <span className="font-semibold text-zinc-950"><WorkspaceText text="POS ticket:" /> </span>
              {booking.pos_ticket_id}
            </p>
          ) : null}
          {booking.source_reference_id ? (
            <p>
              <span className="font-semibold text-zinc-950"><WorkspaceText text="Source reference:" /> </span>
              <WorkspaceText text={booking.source_reference_type ?? "reference"} /> / {booking.source_reference_id}
            </p>
          ) : null}
        </section>

        <section className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase text-zinc-500">
                <WorkspaceText text="Ticket" />
              </h3>
              <p className="mt-1 text-sm text-zinc-600">
                <WorkspaceText text="Mode:" /> <WorkspaceText text={TICKET_CREATION_MODE_LABELS[settings.ticket_creation_mode]} />.
              </p>
            </div>
            {booking.posTicket ? (
              <a
                className="inline-flex min-h-10 items-center rounded-md bg-[#f26f3d] px-3 text-sm font-semibold text-white"
                href={`/pos-tickets/${booking.posTicket.id}`}
              >
                <WorkspaceText text="Open POS ticket" />
              </a>
            ) : canManage ? (
              <button
                className="min-h-10 rounded-md bg-[#f26f3d] px-3 text-sm font-semibold text-white disabled:opacity-60"
                disabled={isPending || ticketConversionBlocked}
                aria-busy={isPending && pendingAction === "ticket"}
                onClick={createTicket}
                type="button"
              >
                <ActionFeedback pending={isPending && pendingAction === "ticket"} pendingLabel="Creating…"><WorkspaceText text="Create POS ticket" /></ActionFeedback>
              </button>
            ) : null}
          </div>

          {booking.posTicket ? (
            <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm sm:grid-cols-2">
              <p>
                <span className="block text-zinc-500"><WorkspaceText text="Ticket" /></span>
                <span className="font-semibold text-zinc-950">
                  {booking.posTicket.ticketNumber}
                </span>
              </p>
              <p>
                <span className="block text-zinc-500"><WorkspaceText text="Status" /></span>
                <span className="font-semibold capitalize text-zinc-950">
                  <WorkspaceText text={booking.posTicket.status} />
                </span>
              </p>
              <p>
                <span className="block text-zinc-500"><WorkspaceText text="Subtotal" /></span>
                <span className="font-semibold text-zinc-950">
                  {formatMoney(booking.posTicket.totals.subtotal)}
                </span>
              </p>
              <p>
                <span className="block text-zinc-500"><WorkspaceText text="Tax" /></span>
                <span className="font-semibold text-zinc-950">
                  {formatMoney(booking.posTicket.totals.tax_amount)}
                </span>
              </p>
              <p>
                <span className="block text-zinc-500"><WorkspaceText text="Total" /></span>
                <span className="font-semibold text-zinc-950">
                  {formatMoney(booking.posTicket.totals.total)}
                </span>
              </p>
              <p>
                <span className="block text-zinc-500"><WorkspaceText text="Payment" /></span>
                <span className="font-semibold capitalize text-zinc-950">
                  <WorkspaceText text={booking.posTicket.paymentStatus} />
                </span>
              </p>
            </div>
          ) : (
            <div className="grid gap-2 text-sm text-zinc-700">
              <p>
                <WorkspaceText text="The ticket will use booked services, booked prices, and assigned staff snapshots. POS owns discounts, tax, tips, and payments after creation." />
              </p>
              {ticketConversionBlocked ? (
                <p className="font-semibold text-amber-700">
                  <WorkspaceText text="Confirm this appointment before creating a POS ticket." />
                </p>
              ) : null}
              {missingStaff ? (
                <p className="font-semibold text-amber-700">
                  <WorkspaceText text="One or more services are unassigned; ticket staff attribution may need review." />
                </p>
              ) : null}
            </div>
          )}

          {paymentPending ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              <WorkspaceText text="Payment pending: the appointment is complete, but this POS ticket is not fully paid." />
            </p>
          ) : null}

          {hasTicket && booking.normalizedStatus === "cancelled" ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              <WorkspaceText text="This appointment was cancelled after ticket creation. Review the POS ticket separately." />
            </p>
          ) : null}
        </section>

        <details className="owner-manage-disclosure">
          <summary><WorkspaceText text="Timeline" /></summary>
          <div className="mt-2 grid gap-2">
            {booking.events.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
                <WorkspaceText text="No status events recorded." />
              </p>
            ) : (
              booking.events.map((event) => (
                <div className="rounded-lg border border-zinc-200 px-4 py-3" key={event.id}>
                  <p className="text-sm font-semibold capitalize text-zinc-950">
                    <WorkspaceText text={eventLabel(event)} />
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    <WorkspaceText text={formatDateTime(event.created_at, timezone)} />
                  </p>
                </div>
              ))
            )}
          </div>
        </details>

        {canManage ? (
          <section className="grid gap-4">
            <h3 className="text-sm font-semibold uppercase text-zinc-500"><WorkspaceText text="Actions" /></h3>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                <WorkspaceText text="Note (optional)" />
              </span>
              <input
                className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {validActions.map((action) => (
                <button
                  className="min-h-10 rounded-md bg-[#f26f3d] px-3 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={isPending || ((action.command === "mark_no_show" || action.command === "mark_no_show_excused") && booking.normalizedStatus !== "no_show" && Date.parse(booking.start_at) > noShowClock)}
                  key={action.command}
                  aria-busy={isPending && pendingAction === "status:" + action.command}
                  onClick={() => runStatus(action.command)}
                  type="button"
                >
                  <ActionFeedback pending={isPending && pendingAction === "status:" + action.command} pendingLabel="Updating…"><WorkspaceText text={action.label} /></ActionFeedback>
                </button>
              ))}
            </div>

<details className="owner-manage-disclosure"><summary><WorkspaceText text="Reschedule" /></summary>            <form className="grid gap-3 rounded-lg border border-zinc-200 p-4" onSubmit={runReschedule}>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Start" /></span>
                  <input
                    className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                    onChange={(event) => setRescheduleStart(event.target.value)}
                    type="datetime-local"
                    value={rescheduleStart}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="End" /></span>
                  <input
                    className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                    onChange={(event) => setRescheduleEnd(event.target.value)}
                    type="datetime-local"
                    value={rescheduleEnd}
                  />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700">
                  <WorkspaceText text="Override reason" />
                </span>
                <input
                  className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                  onChange={(event) => setOverrideReason(event.target.value)}
                  value={overrideReason}
                />
              </label>
              <button
                className="w-fit min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                disabled={isPending}
                aria-busy={isPending && pendingAction === "reschedule"}
                type="submit"
              >
                <ActionFeedback pending={isPending && pendingAction === "reschedule"} pendingLabel="Saving…"><WorkspaceText text="Save time" /></ActionFeedback>
              </button>
            </form></details>

<details className="owner-manage-disclosure"><summary><WorkspaceText text="Assign staff" /></summary>            <form className="grid gap-3 rounded-lg border border-zinc-200 p-4" onSubmit={runReassign}>

              {booking.lines.map((line, index) => (
                <label className="grid gap-1" key={line.id}>
                  <span className="text-sm font-semibold text-zinc-700">
                    {line.service_name_snapshot}
                  </span>
                  <select
                    className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                    onChange={(event) => {
                      setLineAssignments((current) =>
                        current.map((assignment) =>
                          assignment.bookingLineId === line.id
                            ? { ...assignment, staffId: event.target.value }
                            : assignment,
                        ),
                      );
                    }}
                    value={lineAssignments[index]?.staffId ?? ""}
                  >
                    <option value=""><WorkspaceText text="Unassigned" /></option>
                    {staffForService(options).map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                className="w-fit min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                disabled={isPending}
                aria-busy={isPending && pendingAction === "reassign"}
                type="submit"
              >
                <ActionFeedback pending={isPending && pendingAction === "reassign"} pendingLabel="Saving…"><WorkspaceText text="Save assignment" /></ActionFeedback>
              </button>
            </form></details>
          </section>
        ) : null}
      </div>
    </ModalFrame>
  );
}

function actionSetForStatus(status: string) {
  switch (status) {
    case "pending":
      return [
        { command: "confirm", label: "Confirm" },
        { command: "cancel", label: "Cancel" },
      ] as const;
    case "confirmed":
      return [
        { command: "check_in", label: "Check in" },
        { command: "cancel", label: "Cancel" },
        { command: "mark_no_show", label: "No-show" },
        { command: "mark_no_show_excused", label: "No-show with reason" },
      ] as const;
    case "no_show":
      return [
        { command: "mark_no_show", label: "No-show" },
        { command: "mark_no_show_excused", label: "No-show with reason" },
      ] as const;
    case "checked_in":
      return [
        { command: "start_service", label: "Start service" },
        { command: "cancel", label: "Cancel" },
      ] as const;
    case "in_service":
      return [{ command: "complete", label: "Complete" }] as const;
    default:
      return [];
  }
}

function staffForService(
  options: BookingWorkspaceClientProps["options"],
) {
  return options.staff.filter((staff) => staff.is_active);
}

function selectedServices(options: BookingWorkspaceClientProps["options"], lines: DraftLine[]) {
  return lines
    .map((line) => options.services.find((service) => service.id === line.serviceId))
    .filter((service): service is BookingWorkspaceClientProps["options"]["services"][number] =>
      Boolean(service),
    );
}

function totalDraftMinutes(
  options: BookingWorkspaceClientProps["options"],
  lines: DraftLine[],
  cleanupBufferMinutes: number,
) {
  return selectedServices(options, lines).reduce(
    (sum, service) => sum + service.duration_minutes + cleanupBufferMinutes,
    0,
  );
}

function totalDraftPrice(options: BookingWorkspaceClientProps["options"], lines: DraftLine[]) {
  return selectedServices(options, lines).reduce(
    (sum, service) => sum + Number(service.base_price ?? 0),
    0,
  );
}

function lineConflicts(
  bookings: BookingWorkspaceItem[],
  blocks: BookingWorkspaceClientProps["options"]["timeBlocks"],
  staffId: string,
  startIso: string,
  endIso: string,
) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const overlaps = (leftStart: string, leftEnd: string) =>
    new Date(leftStart).getTime() < endMs && new Date(leftEnd).getTime() > startMs;
  const bookingConflict = bookings.some(
    (booking) =>
      booking.normalizedStatus !== "cancelled" &&
      booking.normalizedStatus !== "no_show" &&
      booking.lines.some(
        (line) =>
          line.assigned_staff_id === staffId &&
          line.scheduled_start_at &&
          line.scheduled_end_at &&
          overlaps(line.scheduled_start_at, line.scheduled_end_at),
      ),
  );
  const blockConflict = blocks.some(
    (block) =>
      block.is_active !== false &&
      (!block.staff_id || block.staff_id === staffId) &&
      overlaps(block.starts_at, block.ends_at),
  );

  return bookingConflict || blockConflict;
}

function generateRealSlots(input: {
  bookings: BookingWorkspaceItem[];
  date: string;
  lines: DraftLine[];
  options: BookingWorkspaceClientProps["options"];
  slotIntervalMinutes: number;
  timezone: string;
}) {
  const selectedLines = input.lines.filter((line) => line.serviceId);

  if (selectedLines.length === 0 || selectedLines.some((line) => !line.staffId)) {
    return [];
  }

  const firstStaffId = selectedLines[0].staffId;

  if (!firstStaffId) {
    return [];
  }

  const day = new Date(`${input.date}T12:00:00Z`).getUTCDay();
  const rules = input.options.availabilityRules.filter(
    (rule) =>
      rule.is_active &&
      rule.day_of_week === day &&
      rule.rule_type === "working" &&
      (!rule.staff_id || rule.staff_id === firstStaffId),
  );
  const totalMinutes = totalDraftMinutes(input.options, selectedLines, 0);
  const slots: string[] = [];

  for (const rule of rules) {
    const startsAt = zonedDateTimeToUtcIso(input.date, rule.starts_at_local.slice(0, 5), input.timezone);
    const endsAt = zonedDateTimeToUtcIso(input.date, rule.ends_at_local.slice(0, 5), input.timezone);
    let cursorMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();

    while (cursorMs + totalMinutes * 60000 <= endMs) {
      const startIso = new Date(cursorMs).toISOString();
      let lineCursorMs = cursorMs;
      const hasConflict = selectedLines.some((line) => {
        const service = input.options.services.find(
          (candidate) => candidate.id === line.serviceId,
        );
        const lineEndIso = new Date(
          lineCursorMs + (service?.duration_minutes ?? 0) * 60000,
        ).toISOString();
        const lineStartIso = new Date(lineCursorMs).toISOString();

        lineCursorMs = new Date(lineEndIso).getTime();

        return line.staffId
          ? lineConflicts(
              input.bookings,
              input.options.timeBlocks,
              line.staffId,
              lineStartIso,
              lineEndIso,
            )
          : true;
      });

      if (!hasConflict) {
        slots.push(toLocalInputValue(startIso, input.timezone));
      }

      cursorMs += input.slotIntervalMinutes * 60000;
    }
  }

  return [...new Set(slots)].slice(0, 24);
}

function AppointmentDrawer({
  bookings,
  onClose,
  options,
  prefill,
  settings,
  timezone,
}: {
  bookings: BookingWorkspaceItem[];
  onClose: () => void;
  options: BookingWorkspaceClientProps["options"];
  prefill: DraftPrefill | null;
  settings: BookingWorkspaceClientProps["settings"];
  timezone: string;
}) {
  const __vt = useWorkspaceTranslation();

  
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerUserId] = useState(prefill?.customerUserId ?? "");
  const [lines, setLines] = useState<DraftLine[]>([
    {
      serviceId: prefill?.serviceId ?? options.services[0]?.id ?? "",
      staffId: prefill?.staffId ?? "",
    },
  ]);
  const [startLocal, setStartLocal] = useState(
    prefill?.startLocal ??
      `${todayInTimeZone(timezone)}T${settings.slot_interval_minutes <= 15 ? "09:00" : "10:00"}`,
  );
  const [publicNotes, setPublicNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState(prefill?.internalNotes ?? "");
  const [confirmationMode, setConfirmationMode] =
    useState<BookingConfirmationMode>(settings.confirmation_mode);
  const [source, setSource] = useState<BookingSource>(prefill?.source ?? "owner_manual");
  const [overrideReason, setOverrideReason] = useState("");
  const [key] = useState(idempotencyKey);
  const selectedDate = startLocal.slice(0, 10);
  const slots = useMemo(
    () =>
      generateRealSlots({
        bookings,
        date: selectedDate,
        lines,
        options,
        slotIntervalMinutes: settings.slot_interval_minutes,
        timezone,
      }),
    [bookings, lines, options, selectedDate, settings.slot_interval_minutes, timezone],
  );
  const duplicateWarning = useMemo(() => {
    const phone = customerPhone.replace(/[^0-9]/g, "");
    const email = customerEmail.trim().toLowerCase();

    if (!phone && !email) {
      return null;
    }

    const duplicate = options.customers.find((customer) => {
      const customerPhoneDigits = customer.phone?.replace(/[^0-9]/g, "") ?? "";
      const customerEmailValue = customer.email?.trim().toLowerCase() ?? "";

      return (phone && customerPhoneDigits === phone) || (email && customerEmailValue === email);
    });

    return duplicate ? `Possible duplicate: ${duplicate.name}` : null;
  }, [customerEmail, customerPhone, options.customers]);
  const draftMinutes = totalDraftMinutes(
    options,
    lines,
    settings.default_cleanup_buffer_minutes,
  );
  const draftSubtotal = totalDraftPrice(options, lines);
  const steps = ["Customer", "Services", "Professional", "Date & time", "Details", "Review"];

  function addLine() {
    setLines((current) => [
      ...current,
      { serviceId: options.services[0]?.id ?? "", staffId: "" },
    ]);
  }

  function updateLine(index: number, next: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...next } : line,
      ),
    );
  }

  function submit() {
    setResult(null);
    startTransition(async () => {
      const payload: CreateOwnerAppointmentInput = {
        confirmationMode,
        customerEmail,
        customerId,
        customerName,
        customerPhone,
        customerUserId,
        idempotencyKey: key,
        internalNotes,
        lines,
        overbookingOverrideReason: overrideReason,
        publicNotes,
        source,
        sourceReferenceId: prefill?.sourceReferenceId,
        sourceReferenceType: prefill?.sourceReferenceType,
        startLocal,
      };
      const response = await createOwnerAppointmentAction(payload);
      setResult(response);

      if (response.ok) {
        
        onClose();
      }
    });
  }

  return (
    <ModalFrame label={__vt("New appointment")} onClose={onClose}>
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-950"><WorkspaceText text="New appointment" /></h2>

        </div>
        <button
          className="grid size-10 place-items-center rounded-md border border-zinc-300 text-lg font-semibold"
          onClick={onClose}
          type="button"
        >
          x
        </button>
      </div>
      <div className="border-b border-zinc-200 px-5 py-3">
        <div className="flex gap-2 overflow-x-auto">
          {steps.map((label, index) => (
            <button
              className={classNames(
                "min-h-9 rounded-md border px-3 text-sm font-semibold",
                step === index
                  ? "border-[#f26f3d] bg-[#f26f3d] text-white"
                  : "border-zinc-300 text-zinc-700",
              )}
              key={label}
              onClick={() => setStep(index)}
              type="button"
            >
              {index + 1}. <WorkspaceText text={label} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <Message result={result} />
        {step === 0 ? (
          <section className="mt-4 grid gap-4">
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                <WorkspaceText text="Existing customer" />
              </span>
              <select
                className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                onChange={(event) => setCustomerId(event.target.value)}
                value={customerId}
              >
                <option value=""><WorkspaceText text="Quick-create or request customer" /></option>
                {options.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} {customer.phone ? `/ ${customer.phone}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Name" /></span>
                <input
                  className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                  onChange={(event) => setCustomerName(event.target.value)}
                  value={customerName}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Phone" /></span>
                <input
                  className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  value={customerPhone}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Email" /></span>
                <input
                  className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  type="email"
                  value={customerEmail}
                />
              </label>
            </div>
            {customerUserId ? (
              <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                <WorkspaceText text="Linked customer account:" /> {customerUserId}
              </p>
            ) : null}
            {duplicateWarning ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {duplicateWarning}
              </p>
            ) : null}
          </section>
        ) : null}

        {step === 1 ? (
          <section className="mt-4 grid gap-4">
            {lines.map((line, index) => (
              <div className="grid gap-3 rounded-lg border border-zinc-200 p-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={index}>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-zinc-700">
                    <WorkspaceText text="Service" /> {index + 1}
                  </span>
                  <select
                    className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                    onChange={(event) =>
                      updateLine(index, { serviceId: event.target.value, staffId: "" })
                    }
                    value={line.serviceId}
                  >
                    {options.services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name} / {service.duration_minutes} <WorkspaceText text="min /" />{" "}
                        {formatMoney(Number(service.base_price))}
                      </option>
                    ))}
                  </select>
                </label>
                {lines.length > 1 ? (
                  <button
                    className="self-end rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold"
                    onClick={() =>
                      setLines((current) =>
                        current.filter((_, lineIndex) => lineIndex !== index),
                      )
                    }
                    type="button"
                  >
                    <WorkspaceText text="Remove" />
                  </button>
                ) : null}
              </div>
            ))}
            <button
              className="w-fit min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold"
              onClick={addLine}
              type="button"
            >
              <WorkspaceText text="Add service" />
            </button>
            <p className="text-sm text-zinc-600">
              <WorkspaceText text="Total" /> {draftMinutes} <WorkspaceText text="min /" /> {formatMoney(draftSubtotal)}
            </p>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="mt-4 grid gap-4">
            {lines.map((line, index) => {
              const service = options.services.find(
                (candidate) => candidate.id === line.serviceId,
              );
              const eligibleStaff = staffForService(options);

              return (
                <label className="grid gap-1" key={`${line.serviceId}-${index}`}>
                  <span className="text-sm font-semibold text-zinc-700">
                    {service?.name ?? `Line ${index + 1}`}
                  </span>
                  <select
                    className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                    onChange={(event) => updateLine(index, { staffId: event.target.value })}
                    value={line.staffId}
                  >
                    <option value="">
                      {settings.any_professional_enabled
                        ? "Any professional / unassigned"
                        : <WorkspaceText text="Unassigned" />}
                    </option>
                    {eligibleStaff.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </section>
        ) : null}

        {step === 3 ? (
          <section className="mt-4 grid gap-4">
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Start" /></span>
              <input
                className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                onChange={(event) => setStartLocal(event.target.value)}
                type="datetime-local"
                value={startLocal}
              />
            </label>
            <div className="grid gap-2">
              <h3 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Real available slots" /></h3>
              {slots.length === 0 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <WorkspaceText text="No slot can be generated from configured staff availability for this selection. Manual time remains available for owner review and will still be validated by the booking domain." />{" "}
                  <a
                    className="font-semibold underline"
                    href={`/bookings?tab=availability${
                      lines[0]?.staffId ? `&staffId=${lines[0].staffId}` : ""
                    }`}
                  >
                    <WorkspaceText text="Set staff hours" />
                  </a>
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {slots.map((slot) => (
                    <button
                      className={classNames(
                        "min-h-10 rounded-md border px-3 text-sm font-semibold",
                        startLocal === slot
                          ? "border-[#f26f3d] bg-[#f26f3d] text-white"
                          : "border-zinc-300 bg-white text-zinc-700",
                      )}
                      key={slot}
                      onClick={() => setStartLocal(slot)}
                      type="button"
                    >
                      {slot.slice(11)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="mt-4 grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Source" /></span>
                <select
                  className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                  onChange={(event) => setSource(event.target.value as BookingSource)}
                  value={source}
                >
                  {BOOKING_SOURCES.map((sourceOption) => (
                    <option key={sourceOption} value={sourceOption}>
                      <WorkspaceText text={sourceLabel(sourceOption)} />
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700">
                  <WorkspaceText text="Confirmation" />
                </span>
                <select
                  className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                  onChange={(event) =>
                    setConfirmationMode(event.target.value as BookingConfirmationMode)
                  }
                  value={confirmationMode}
                >
                  <option value="request_confirmation"><WorkspaceText text="Request confirmation" /></option>
                  <option value="instant_booking"><WorkspaceText text="Instant booking" /></option>
                </select>
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                <WorkspaceText text="Public notes" />
              </span>
              <textarea
                className="min-h-24 rounded-md border border-zinc-300 px-3 py-2 text-sm"
                onChange={(event) => setPublicNotes(event.target.value)}
                value={publicNotes}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                <WorkspaceText text="Internal notes" />
              </span>
              <textarea
                className="min-h-24 rounded-md border border-zinc-300 px-3 py-2 text-sm"
                onChange={(event) => setInternalNotes(event.target.value)}
                value={internalNotes}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                <WorkspaceText text="Overbooking override reason" />
              </span>
              <input
                className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                onChange={(event) => setOverrideReason(event.target.value)}
                value={overrideReason}
              />
            </label>
          </section>
        ) : null}

        {step === 5 ? (
          <section className="mt-4 grid gap-4">
            <div className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-700">
              <p>
                <span className="font-semibold text-zinc-950"><WorkspaceText text="Customer:" /> </span>
                {customerId
                  ? options.customers.find((customer) => customer.id === customerId)?.name
                  : customerName || customerUserId || "Not selected"}
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-950"><WorkspaceText text="Services:" /> </span>
                {selectedServices(options, lines)
                  .map((service) => service.name)
                  .join(", ") || "None"}
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-950"><WorkspaceText text="Staff:" /> </span>
                {lines
                  .map((line) =>
                    line.staffId
                      ? options.staff.find((staff) => staff.id === line.staffId)
                          ?.display_name
                      : "Any professional / unassigned",
                  )
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-950"><WorkspaceText text="Start:" /> </span>
                {startLocal.replace("T", " ")}
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-950"><WorkspaceText text="Subtotal:" /> </span>
                {formatMoney(draftSubtotal)}
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-950"><WorkspaceText text="Cancellation window:" /> </span>
                {settings.cancellation_window_minutes} <WorkspaceText text="minutes" />
              </p>
            </div>
          </section>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-5 py-4">
        <button
          className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold"
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          type="button"
        >
          <WorkspaceText text="Back" />
        </button>
        <div className="flex gap-2">
          {step < steps.length - 1 ? (
            <button
              className="min-h-10 rounded-md bg-[#f26f3d] px-4 text-sm font-semibold text-white"
              onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}
              type="button"
            >
              <WorkspaceText text="Next" />
            </button>
          ) : (
            <button
              className="min-h-10 rounded-md bg-[#f26f3d] px-4 text-sm font-semibold text-white disabled:opacity-60"
              disabled={isPending}
              onClick={submit}
              type="button"
            >
              <WorkspaceText text={isPending ? "Creating" : "Create appointment"} />
            </button>
          )}
        </div>
      </div>
    </ModalFrame>
  );
}

function RequestsPanel({
  canManage,
  onConvert,
  requests,
  timezone,
}: {
  canManage: boolean;
  onConvert: (request: BookingWorkspaceRequest) => void;
  requests: BookingWorkspaceRequest[];
  timezone: string;
}) {
  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
        <h3 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="No profile requests" /></h3>
        <p className="mt-2 text-sm text-zinc-600">
          <WorkspaceText text="Public profile booking requests will appear here for owner review." />
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <ul className="divide-y divide-zinc-100">
        {requests.map((request) => (
          <li className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto]" key={request.id}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-zinc-950">
                  {request.customerName}
                </p>
                <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-600">
                  <WorkspaceText text={request.status} />
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-600">
                <WorkspaceText text={request.serviceName ?? "Service not selected"} /> /{" "}
                <WorkspaceText text={request.staffName ?? "Any staff"} /> /{" "}
                <WorkspaceText text={request.requestedStartAt
                  ? formatDateTime(request.requestedStartAt, timezone)
                  : "No requested time"} />
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-zinc-500">
                <WorkspaceText text={request.privateNote || "No note"} />
              </p>
            </div>
            {canManage && request.status === "requested" ? (
              <button
                className="min-h-10 rounded-md bg-[#f26f3d] px-3 text-sm font-semibold text-white"
                onClick={() => onConvert(request)}
                type="button"
              >
                <WorkspaceText text="Review" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function staffHasWorkingHours(
  options: BookingWorkspaceClientProps["options"],
  staffId: string,
) {
  return options.availabilityRules.some(
    (rule) =>
      rule.is_active &&
      rule.rule_type === "working" &&
      (!rule.staff_id || rule.staff_id === staffId),
  );
}

function firstStaffMissingAvailability(options: BookingWorkspaceClientProps["options"]) {
  return (
    options.staff.find(
      (member) => member.is_active && !staffHasWorkingHours(options, member.id),
    )?.id ?? options.staff.find((member) => member.is_active)?.id ?? null
  );
}

function buildReadinessByStaff(input: {
  bookingEnabled: boolean;
  options: BookingWorkspaceClientProps["options"];
}): Record<string, StaffBookingReadiness> {
  return Object.fromEntries(
    input.options.staff.map((member) => {
      const onlineAssignments = input.options.assignments.filter((assignment) => {
        const service = input.options.services.find(
          (candidate) => candidate.id === assignment.service_id,
        );

        return (
          assignment.staff_id === member.id &&
          assignment.is_active &&
          assignment.online_bookable &&
          service?.is_active === true &&
          service.online_booking_enabled === true
        );
      });
      const workingRules = input.options.availabilityRules.filter(
        (rule) =>
          rule.is_active &&
          rule.rule_type === "working" &&
          (!rule.staff_id || rule.staff_id === member.id),
      );
      const reasons: StaffBookingReadiness["reasons"] = [];

      if (!input.bookingEnabled) {
        reasons.push({
          code: "booking_disabled",
          cta: "booking_settings",
          label: "Online booking disabled",
        });
      }

      if (!member.is_active) {
        reasons.push({
          code: "staff_inactive",
          cta: "staff_profile",
          label: "Staff inactive",
        });
      }

      if (!member.online_booking_enabled) {
        reasons.push({
          code: "online_booking_disabled",
          cta: "staff_profile",
          label: "Online booking disabled",
        });
      }

      if (onlineAssignments.length === 0) {
        reasons.push({
          code: "no_assigned_services",
          cta: "assign_services",
          label: "No assigned services",
        });
      }

      if (workingRules.length === 0) {
        reasons.push({
          code: "no_working_hours",
          cta: "staff_hours",
          label: "No working hours",
        });
      }

      return [
        member.id,
        {
          assignedServiceCount: input.options.assignments.filter(
            (assignment) =>
              assignment.staff_id === member.id && assignment.is_active,
          ).length,
          onlineAssignedServiceCount: onlineAssignments.length,
          ready: reasons.length === 0,
          reasons,
          staffId: member.id,
          upcomingBlockCount: input.options.timeBlocks.filter(
            (block) =>
              block.is_active !== false &&
              (!block.staff_id || block.staff_id === member.id),
          ).length,
          workingRuleCount: workingRules.length,
        },
      ];
    }),
  );
}

function bookingReadinessSteps(input: {
  bookingEnabled: boolean;
  guestBookingEnabled: boolean;
  onlineBookingVisible: boolean;
  options: BookingWorkspaceClientProps["options"];
  publicBookingHref: string;
  timezoneIana: string;
  warnings: BookingWorkspaceClientProps["warnings"];
}) {
  const onlineBookingOpen = getSalonOnlineBookingStatus({
    booking_enabled: input.bookingEnabled,
    guest_booking_enabled: input.guestBookingEnabled,
    online_booking_visible: input.onlineBookingVisible,
  }).onlineBookingOpen;
  const warningCodes = new Set(input.warnings.map((warning) => warning.code));
  const missingAvailabilityStaffId = firstStaffMissingAvailability(input.options);
  const bookableServiceCount = input.options.services.filter(
    (service) => service.is_active && service.online_booking_enabled,
  ).length;
  const staffReadiness = Object.values(
    buildReadinessByStaff({
      bookingEnabled: true,
      options: input.options,
    }),
  );
  const readyProfessionalCount = staffReadiness.filter(
    (readiness) => readiness.ready,
  ).length;
  const professionalsWithHours = input.options.staff.filter(
    (member) => member.is_active && staffHasWorkingHours(input.options, member.id),
  ).length;
  const missingHoursStaff = missingAvailabilityStaffId
    ? input.options.staff.find((member) => member.id === missingAvailabilityStaffId)
    : null;

  return [
    {
      complete:
        !warningCodes.has("missing_active_services") &&
        !warningCodes.has("missing_online_services"),
      cta: "Manage services",
      detail:
        bookableServiceCount > 0
          ? `${bookableServiceCount} bookable service${
              bookableServiceCount === 1 ? "" : "s"
            }`
          : "No services available online",
      fixPanel: "services" as const,
      href: "/services",
      id: "services",
      label: "Services",
    },
    {
      complete: !warningCodes.has("missing_staff_assignments"),
      cta: "Manage Booking staff",
      detail:
        readyProfessionalCount > 0
          ? `${readyProfessionalCount} professional${
              readyProfessionalCount === 1 ? "" : "s"
            } available`
          : "No online service-professional match",
      fixPanel: "professionals" as const,
      href: "/services",
      id: "assignments",
      label: "Professionals",
    },
    {
      complete: !warningCodes.has("missing_availability"),
      cta: "Set staff hours",
      detail:
        missingHoursStaff
          ? `${missingHoursStaff.display_name} has no bookable hours`
          : `${professionalsWithHours} professional${
              professionalsWithHours === 1 ? "" : "s"
            } with hours`,
      fixPanel: "hours" as const,
      focusStaffId: missingAvailabilityStaffId,
      href: `/bookings?tab=availability${
        missingAvailabilityStaffId ? `&staffId=${missingAvailabilityStaffId}` : ""
      }`,
      id: "availability",
      label: "Booking hours",
    },
    {
      complete:
        onlineBookingOpen &&
        Boolean(input.timezoneIana.trim()),
      cta: "Review settings",
      detail: onlineBookingOpen
        ? "Publishing controls are on"
        : "Online booking is not live",
      fixPanel: "rules" as const,
      href: "/bookings?tab=settings",
      id: "settings",
      label: "Booking rules",
    },
  ];
}

function BookingReadinessPanel({
  bookingEnabled,
  guestBookingEnabled,
  onlineBookingVisible,
  options,
  publicBookingHref,
  timezoneIana,
  warnings,
}: {
  bookingEnabled: boolean;
  guestBookingEnabled: boolean;
  onlineBookingVisible: boolean;
  options: BookingWorkspaceClientProps["options"];
  publicBookingHref: string;
  timezoneIana: string;
  warnings: BookingWorkspaceClientProps["warnings"];
}) {
  const steps = bookingReadinessSteps({
    bookingEnabled,
    guestBookingEnabled,
    onlineBookingVisible,
    options,
    publicBookingHref,
    timezoneIana,
    warnings,
  });
  const completeCount = steps.filter((step) => step.complete).length;

  if (completeCount === steps.length) {
    return null;
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-amber-950">
            <WorkspaceText text="Finish online booking setup" />
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            {completeCount} <WorkspaceText text="of" /> {steps.length} <WorkspaceText text="steps complete. Manual appointments still work, but customers cannot book online until setup is complete." />
          </p>
        </div>
        <a
          className="inline-flex min-h-10 w-fit items-center rounded-md border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-950"
          href={publicBookingHref}
        >
          <WorkspaceText text="Review booking page" />
        </a>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <div
            className="rounded-md border border-amber-200 bg-white px-3 py-3"
            key={step.id}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-zinc-950"><WorkspaceText text={step.label} /></p>
              <span
                className={classNames(
                  "rounded-md px-2 py-1 text-xs font-semibold",
                  step.complete
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-100 text-amber-800",
                )}
              >
                {step.complete ? <WorkspaceText text="Ready" /> : "Needs setup"}
              </span>
            </div>
            {!step.complete ? (
              <a
                className="mt-3 inline-flex min-h-9 items-center rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950"
                href={step.href}
              >
                {step.cta}
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SettingsPanel({
  canManage,
  options,
  publicBookingHref,
  settings,
  warnings,
}: {
  canManage: boolean;
  options: BookingWorkspaceClientProps["options"];
  publicBookingHref: string;
  settings: BookingWorkspaceClientProps["settings"];
  warnings: BookingWorkspaceClientProps["warnings"];
}) {
  const __vt = useWorkspaceTranslation();

  
  const searchParams = useSearchParams();
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<UpdateBookingSettingsInput>({
    anyProfessionalEnabled: settings.any_professional_enabled,
    autoAssignEnabled: settings.auto_assign_enabled !== false,
    reminderEnabled: settings.reminder_enabled !== false,
    confirmationEmailEnabled: settings.confirmation_email_enabled !== false,
    confirmationSmsEnabled: settings.confirmation_sms_enabled !== false,
    bookingEnabled: settings.booking_enabled,
    cancellationWindowMinutes: settings.cancellation_window_minutes,
    confirmationMode: settings.confirmation_mode,
    defaultCleanupBufferMinutes: settings.default_cleanup_buffer_minutes,
    guestBookingEnabled: settings.guest_booking_enabled,
    maximumAdvanceWindowDays: settings.maximum_advance_window_days,
    minimumLeadTimeMinutes: settings.minimum_lead_time_minutes,
    onlineBookingVisible: settings.online_booking_visible,
    sameDayBookingEnabled: settings.same_day_booking_enabled,
    slotIntervalMinutes: settings.slot_interval_minutes,
    splitStaffAppointmentEnabled: settings.split_staff_appointment_enabled,
    ticketCreationMode: settings.ticket_creation_mode,
    timezoneIana: settings.timezone_iana,
  });

  function setBoolean(key: keyof UpdateBookingSettingsInput, value: boolean) {
    setState((current) => ({ ...current, [key]: value }));
  }

  function setNumber(key: keyof UpdateBookingSettingsInput, value: string) {
    setState((current) => ({ ...current, [key]: Number(value) }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const response = await updateBookingSettingsAction(state);
      setResult(response);

      if (response.ok) {
        
      }
    });
  }

  const readiness = bookingReadinessSteps({
    bookingEnabled: state.bookingEnabled,
    guestBookingEnabled: state.guestBookingEnabled,
    onlineBookingVisible: state.onlineBookingVisible,
    options,
    publicBookingHref,
    timezoneIana: state.timezoneIana,
    warnings,
  });
  const readinessByStaffId = useMemo(
    () => buildReadinessByStaff({ bookingEnabled: state.bookingEnabled, options }),
    [options, state.bookingEnabled],
  );
  const selectedAvailabilityStaffId = searchParams.get("staffId");

  function copyPublicUrl() {
    const url =
      typeof window === "undefined"
        ? publicBookingHref
        : `${window.location.origin}${publicBookingHref}`;
    void navigator.clipboard?.writeText(url);
  }

  return (
    <div className="grid gap-5">
      <form className="grid gap-5 rounded-lg border border-zinc-200 bg-white p-5" onSubmit={submit}>
      <Message result={result} />
      <section className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 lg:grid-cols-[1fr_auto]">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Public booking link" /></h3>
          <p className="mt-2 break-all rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
            {publicBookingHref}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {readiness.map((item) => (
              <li
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                key={item.id}
              >
                <span><WorkspaceText text={item.label} /></span>
                <span
                  className={classNames(
                    "rounded-md px-2 py-1 text-xs font-semibold",
                    item.complete
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-100 text-amber-800",
                  )}
                >
                  {item.complete ? <WorkspaceText text="Ready" /> : "Needs setup"}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          <button
            className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800"
            onClick={copyPublicUrl}
            type="button"
          >
            <WorkspaceText text="Copy" />
          </button>
          <a
            className="grid min-h-10 place-items-center rounded-md bg-[#f26f3d] px-3 text-sm font-semibold text-white"
            href={publicBookingHref}
            rel="noreferrer"
            target="_blank"
          >
            <WorkspaceText text="Preview" />
          </a>
        </div>
      </section>
      <BookingReadinessPanel
        bookingEnabled={state.bookingEnabled}
        guestBookingEnabled={state.guestBookingEnabled}
        onlineBookingVisible={state.onlineBookingVisible}
        options={options}
        publicBookingHref={publicBookingHref}
        timezoneIana={state.timezoneIana}
        warnings={warnings}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Toggle
          checked={state.bookingEnabled}
          disabled={!canManage}
          label={__vt("Booking enabled")}
          onChange={(value) => setBoolean("bookingEnabled", value)}
        />
        <Toggle
          checked={state.onlineBookingVisible}
          disabled={!canManage}
          label={__vt("Online booking visible")}
          onChange={(value) => setBoolean("onlineBookingVisible", value)}
        />
        <Toggle
          checked={state.sameDayBookingEnabled}
          disabled={!canManage}
          label={__vt("Allow same-day booking (future times only)")}
          onChange={(value) => setBoolean("sameDayBookingEnabled", value)}
        />
        <Toggle checked={state.reminderEnabled} disabled={!canManage} label={__vt("Send an email reminder within 24 hours of the appointment")} onChange={(value) => setBoolean("reminderEnabled", value)} />
          <Toggle checked={state.autoAssignEnabled} disabled={!canManage} label={__vt("Auto assign available professionals fairly (Portable)")} onChange={(value) => setBoolean("autoAssignEnabled", value)} />
        <Toggle checked={state.confirmationEmailEnabled} disabled={!canManage} label={__vt("Email booking updates (requires connected provider)")} onChange={(value) => setBoolean("confirmationEmailEnabled", value)} />
        <Toggle
          checked={state.anyProfessionalEnabled}
          disabled={!canManage}
          label={__vt("Any Professional")}
          onChange={(value) => setBoolean("anyProfessionalEnabled", value)}
        />
        <Toggle
          checked={state.splitStaffAppointmentEnabled}
          disabled={!canManage}
          label={__vt("Split-staff appointments")}
          onChange={(value) => setBoolean("splitStaffAppointmentEnabled", value)}
        />
        <Toggle
          checked={state.guestBookingEnabled}
          disabled={!canManage}
          label={__vt("Guest booking")}
          onChange={(value) => setBoolean("guestBookingEnabled", value)}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Confirmation mode" /></span>
          <select
            className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                confirmationMode: event.target.value as BookingConfirmationMode,
              }))
            }
            value={state.confirmationMode}
          >
            <option value="request_confirmation"><WorkspaceText text="Request confirmation" /></option>
            <option value="instant_booking"><WorkspaceText text="Instant booking" /></option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-semibold text-zinc-700">
            <WorkspaceText text="POS ticket creation" />
          </span>
          <select
            className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                ticketCreationMode: event.target.value as BookingTicketCreationMode,
              }))
            }
            value={state.ticketCreationMode}
          >
            <option value="manual"><WorkspaceText text="Manual" /></option>
            <option value="on_check_in"><WorkspaceText text="On check-in" /></option>
            <option value="on_service_start"><WorkspaceText text="On service start" /></option>
          </select>
        </label>
        <NumberField
          disabled={!canManage}
          label={__vt("Minimum lead time")}
          onChange={(value) => setNumber("minimumLeadTimeMinutes", value)}
          suffix="min"
          value={state.minimumLeadTimeMinutes}
        />
        <NumberField
          disabled={!canManage}
          label={__vt("Maximum advance")}
          onChange={(value) => setNumber("maximumAdvanceWindowDays", value)}
          suffix="days"
          value={state.maximumAdvanceWindowDays}
        />
        <label className="grid gap-1">
          <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Slot interval" /></span>
          <select
            className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
            disabled={!canManage}
            onChange={(event) => setNumber("slotIntervalMinutes", event.target.value)}
            value={state.slotIntervalMinutes}
          >
            {[5, 10, 15, 20, 30, 60].map((interval) => (
              <option key={interval} value={interval}>
                {interval} <WorkspaceText text="min" />
              </option>
            ))}
          </select>
        </label>
        <NumberField
          disabled={!canManage}
          label={__vt("Cleanup buffer")}
          onChange={(value) => setNumber("defaultCleanupBufferMinutes", value)}
          suffix="min"
          value={state.defaultCleanupBufferMinutes}
        />
        <NumberField
          disabled={!canManage}
          label={__vt("Cancellation window")}
          onChange={(value) => setNumber("cancellationWindowMinutes", value)}
          suffix="min"
          value={state.cancellationWindowMinutes}
        />
        <label className="grid gap-1">
          <span className="text-sm font-semibold text-zinc-700"><WorkspaceText text="Timezone" /></span>
          <TimeZoneSelect
            className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({ ...current, timezoneIana: event.target.value }))
            }
            value={state.timezoneIana}
          />
        </label>
      </div>
      {canManage ? (
        <button
          className="w-fit min-h-10 rounded-md bg-[#f26f3d] px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Saving" : <WorkspaceText text="Save settings" />}
        </button>
      ) : (
        <p className="text-sm text-zinc-600"><WorkspaceText text="You have read-only booking access." /></p>
      )}
      </form>
      <StaffAvailabilityEditor
        availabilityRules={options.availabilityRules}
        canManage={canManage}
        readinessByStaffId={readinessByStaffId}
        selectedStaffId={selectedAvailabilityStaffId}
        staff={options.staff}
        timeBlocks={options.timeBlocks}
        timezone={state.timezoneIana}
      />
    </div>
  );
}

function BookingPagePanel({
  canManage,
  options,
  publicBookingHref,
  salonName,
  setupPermissions,
  settings,
  warnings,
}: {
  canManage: boolean;
  options: BookingWorkspaceClientProps["options"];
  publicBookingHref: string;
  salonName: string;
  setupPermissions: BookingWorkspaceClientProps["setupPermissions"];
  settings: BookingWorkspaceClientProps["settings"];
  warnings: BookingWorkspaceClientProps["warnings"];
}) {
  const __vt = useWorkspaceTranslation();

  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeSetup, setActiveSetup] = useState<QuickSetupPanelId | null>(null);
  const [focusedStaffId, setFocusedStaffId] = useState<string | null>(null);
  const [focusedServiceId, setFocusedServiceId] = useState<string | null>(null);
  const readiness = bookingReadinessSteps({
    bookingEnabled: settings.booking_enabled,
    guestBookingEnabled: settings.guest_booking_enabled,
    onlineBookingVisible: settings.online_booking_visible,
    options,
    publicBookingHref,
    timezoneIana: settings.timezone_iana,
    warnings,
  });
  const readyCount = readiness.filter((item) => item.complete).length;
  const isReady = readyCount === readiness.length;
  const bookableServices = options.services.filter(
    (service) => service.is_active && service.online_booking_enabled,
  );
  const onlineStaff = options.staff.filter(
    (member) => member.is_active && member.online_booking_enabled,
  );
  const readyStaffCount = Object.values(
    buildReadinessByStaff({ bookingEnabled: true, options }),
  ).filter((item) => item.ready).length;

  function openSetup(
    panel: QuickSetupPanelId,
    focusStaffId?: string | null,
    focusServiceId?: string | null,
  ) {
    setActiveSetup(panel);
    setFocusedStaffId(focusStaffId ?? null);
    setFocusedServiceId(focusServiceId ?? null);
  }

  return (
    <section className="booking-page-settings">
      <div className="booking-settings-main">
        <OnlineBookingControlCard
          canManage={canManage}
          isReady={isReady}
          publicBookingHref={publicBookingHref}
          settings={settings}
        />

        <article className="booking-setup-section">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#211c24]">
                <WorkspaceText text="Booking setup" />
              </h2>
            </div>
            <span className="text-xs font-extrabold text-[#786d78]">
              {readyCount}/{readiness.length}
            </span>
          </div>
          <div className="mt-2 grid">
            <QuickSetupCard
              detail={__vt("Active services customers can choose online.")}
              metric={`${bookableServices.length} bookable`}
              onOpen={() => openSetup("services")}
              status={readiness.find((item) => item.id === "services")?.complete ? "ready" : "attention"}
              title={__vt("Services")}
            />
            <QuickSetupCard
              detail={__vt(`${onlineStaff.length} of ${options.staff.length} staff enabled online.`)}
              metric={`${readyStaffCount} ready`}
              onOpen={() => openSetup("professionals")}
              status={readiness.find((item) => item.id === "assignments")?.complete ? "ready" : "attention"}
              title={__vt("Professionals")}
            />
            <QuickSetupCard
              detail={__vt("Based on professional weekly schedules and time off.")}
              metric={summarizeBookingHours(options)}
              onOpen={() => openSetup("hours")}
              status={readiness.find((item) => item.id === "availability")?.complete ? "ready" : "attention"}
              title={__vt("Booking hours")}
            />
            <QuickSetupCard
              detail={__vt(settings.any_professional_enabled ? "Customers may choose Any Professional." : "Customers choose from available professionals.")}
              metric={bookingRulesSummary(settings)}
              onOpen={() => openSetup("rules")}
              status={readiness.find((item) => item.id === "settings")?.complete ? "ready" : "attention"}
              title={__vt("Booking rules")}
            />
          </div>
        </article>
      </div>

      <details className="booking-preview-section" onToggle={event => setPreviewOpen(event.currentTarget.open)}>
        <summary><WorkspaceText text="Customer preview" /></summary>
        {previewOpen ? <div>
        <div className="flex flex-col gap-3 border-b border-[#f0e6df] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className={styles.eyebrow}><WorkspaceText text="Customer preview" /></p>
            <h2 className="mt-2 text-lg font-extrabold text-[#211c24]"><a href="/salon-profile" className="hover:underline">{salonName}</a></h2>
          </div>
          <div className="flex rounded-xl border border-[#ffd6c4] bg-white p-1">
            {(["desktop", "mobile"] as const).map((mode) => (
              <button
                className={classNames(
                  "min-h-9 rounded-lg px-3 text-sm font-extrabold",
                  previewMode === mode
                    ? "bg-[#f26f3d] text-white"
                    : "text-[#786d78] hover:bg-[#fff0e8]",
                )}
                key={mode}
                onClick={() => setPreviewMode(mode)}
                type="button"
              >
                <WorkspaceText text={mode === "desktop" ? "Desktop" : "Mobile"} />
              </button>
            ))}
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-[#ffd6c4] bg-[#fff0e8] p-3">
          <div className="mb-3 flex gap-1.5 px-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffd6c4]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffd6c4]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffd6c4]" />
          </div>
          <div
            className={classNames(
              "mx-auto overflow-hidden rounded-xl border border-[#f0e6df] bg-white",
              previewMode === "mobile" ? "max-w-[390px]" : "w-full",
            )}
          >
            <iframe
              className="h-[640px] w-full bg-white"
              src={publicBookingHref}
              loading="lazy"
              title={__vt("Public booking preview")}
            />
          </div>
        </div>
        </div> : null}
      </details>
      {activeSetup === "services" ? (
        <ServicesQuickSetupDrawer
          canManageAssignments={setupPermissions.canManageBooking}
          canManageServices={setupPermissions.canManageServices}
          initialServiceId={focusedServiceId}
          onClose={() => setActiveSetup(null)}
          options={options}
        />
      ) : null}
      {activeSetup === "professionals" ? (
        <ProfessionalsQuickSetupDrawer
          canManageAssignments={setupPermissions.canManageBooking}
          canManageAvailability={setupPermissions.canManageAvailability}
          canManageStaff={setupPermissions.canManageStaff}
          initialStaffId={focusedStaffId}
          onClose={() => setActiveSetup(null)}
          options={options}
          timezone={settings.timezone_iana}
        />
      ) : null}
      {activeSetup === "hours" ? (
        <BookingHoursQuickSetupDrawer
          canManageAvailability={setupPermissions.canManageAvailability}
          initialStaffId={focusedStaffId}
          onClose={() => setActiveSetup(null)}
          options={options}
          timezone={settings.timezone_iana}
        />
      ) : null}
      {activeSetup === "rules" ? (
        <BookingRulesQuickSetupDrawer
          canManage={setupPermissions.canManageBooking}
          onClose={() => setActiveSetup(null)}
          settings={settings}
        />
      ) : null}
    </section>
  );
}

function AvailabilityPanel({
  canManage,
  options,
  settings,
}: {
  canManage: boolean;
  options: BookingWorkspaceClientProps["options"];
  settings: BookingWorkspaceClientProps["settings"];
}) {
  const searchParams = useSearchParams();
  const readinessByStaffId = useMemo(
    () =>
      buildReadinessByStaff({
        bookingEnabled: settings.booking_enabled,
        options,
      }),
    [options, settings.booking_enabled],
  );

  return (
    <section className="owner-availability-settings">
      <StaffAvailabilityEditor
        initiallyCollapsed
        availabilityRules={options.availabilityRules}
        canManage={canManage}
        readinessByStaffId={readinessByStaffId}
        selectedStaffId={searchParams.get("staffId")}
        staff={options.staff}
        timeBlocks={options.timeBlocks}
        timezone={settings.timezone_iana}
      />
    </section>
  );
}

function OwnerSettingsPanel({
  canManage,
  settings,
}: {
  canManage: boolean;
  settings: BookingWorkspaceClientProps["settings"];
}) {
  const __vt = useWorkspaceTranslation();

  
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<UpdateBookingSettingsInput>({
    anyProfessionalEnabled: settings.any_professional_enabled,
    autoAssignEnabled: settings.auto_assign_enabled !== false,
    reminderEnabled: settings.reminder_enabled !== false,
    confirmationEmailEnabled: settings.confirmation_email_enabled !== false,
    confirmationSmsEnabled: settings.confirmation_sms_enabled !== false,
    bookingEnabled: settings.booking_enabled,
    cancellationWindowMinutes: settings.cancellation_window_minutes,
    confirmationMode: settings.confirmation_mode,
    defaultCleanupBufferMinutes: settings.default_cleanup_buffer_minutes,
    guestBookingEnabled: settings.guest_booking_enabled,
    maximumAdvanceWindowDays: settings.maximum_advance_window_days,
    minimumLeadTimeMinutes: settings.minimum_lead_time_minutes,
    onlineBookingVisible: settings.online_booking_visible,
    sameDayBookingEnabled: settings.same_day_booking_enabled,
    slotIntervalMinutes: settings.slot_interval_minutes,
    splitStaffAppointmentEnabled: settings.split_staff_appointment_enabled,
    ticketCreationMode: settings.ticket_creation_mode,
    timezoneIana: settings.timezone_iana,
  });

  function setBoolean(key: keyof UpdateBookingSettingsInput, value: boolean) {
    setState((current) => ({ ...current, [key]: value }));
  }

  function setNumber(key: keyof UpdateBookingSettingsInput, value: string) {
    setState((current) => ({ ...current, [key]: Number(value) }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const response = await updateBookingSettingsAction(state);
      setResult(response);

      if (response.ok) {
        
      }
    });
  }

  return (
    <form className="owner-booking-preferences" onSubmit={submit}>
      <div className="xl:col-span-2">
        <Message result={result} />
      </div>
      <section className={classNames(styles.panel, "grid gap-4 p-5")}>
        <div>
          <p className={styles.eyebrow}><WorkspaceText text="Online booking" /></p>
          <h2 className="mt-2 text-xl font-extrabold text-[#211c24]"><WorkspaceText text="Publishing controls" /></h2>
        </div>
        <Toggle
          checked={state.bookingEnabled}
          disabled={!canManage}
          label={__vt("Booking enabled")}
          onChange={(value) => setBoolean("bookingEnabled", value)}
        />
        <Toggle
          checked={state.onlineBookingVisible}
          disabled={!canManage}
          label={__vt("Online booking visible")}
          onChange={(value) => setBoolean("onlineBookingVisible", value)}
        />
        <Toggle
          checked={state.sameDayBookingEnabled}
          disabled={!canManage}
          label={__vt("Allow same-day booking (future times only)")}
          onChange={(value) => setBoolean("sameDayBookingEnabled", value)}
        />
      </section>

      <section className={classNames(styles.panel, "grid gap-4 p-5")}>
        <div>
          <p className={styles.eyebrow}><WorkspaceText text="Scheduling rules" /></p>
          <h2 className="mt-2 text-xl font-extrabold text-[#211c24]"><WorkspaceText text="Time windows" /></h2>
        </div>
        <NumberField
          disabled={!canManage}
          label={__vt(`Minimum lead time (${formatMinutes(state.minimumLeadTimeMinutes)})`)}
          onChange={(value) => setNumber("minimumLeadTimeMinutes", value)}
          suffix="min"
          value={state.minimumLeadTimeMinutes}
        />
        <NumberField
          disabled={!canManage}
          label={__vt("Maximum advance")}
          onChange={(value) => setNumber("maximumAdvanceWindowDays", value)}
          suffix="days"
          value={state.maximumAdvanceWindowDays}
        />
        <label className="grid gap-1">
          <span className="text-sm font-extrabold text-[#211c24]"><WorkspaceText text="Slot interval" /></span>
          <select
            className={styles.select}
            disabled={!canManage}
            onChange={(event) => setNumber("slotIntervalMinutes", event.target.value)}
            value={state.slotIntervalMinutes}
          >
            {[5, 10, 15, 20, 30, 60].map((interval) => (
              <option key={interval} value={interval}>
                {interval} <WorkspaceText text="min" />
              </option>
            ))}
          </select>
        </label>
        <NumberField
          disabled={!canManage}
          label={__vt("Cleanup buffer")}
          onChange={(value) => setNumber("defaultCleanupBufferMinutes", value)}
          suffix="min"
          value={state.defaultCleanupBufferMinutes}
        />
      </section>

      <section className={classNames(styles.panel, "grid gap-4 p-5")}>
        <div>
          <p className={styles.eyebrow}><WorkspaceText text="Confirmation" /></p>
          <h2 className="mt-2 text-xl font-extrabold text-[#211c24]"><WorkspaceText text="Booking outcome" /></h2>
        </div>
        <label className="grid gap-1">
          <span className="text-sm font-extrabold text-[#211c24]"><WorkspaceText text="Confirmation mode" /></span>
          <select
            className={styles.select}
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                confirmationMode: event.target.value as BookingConfirmationMode,
              }))
            }
            value={state.confirmationMode}
          >
            <option value="request_confirmation"><WorkspaceText text="Request confirmation" /></option>
            <option value="instant_booking"><WorkspaceText text="Instant booking" /></option>
          </select>
        </label>
        <NumberField
          disabled={!canManage}
          label={__vt(`Cancellation window (${formatMinutes(state.cancellationWindowMinutes)})`)}
          onChange={(value) => setNumber("cancellationWindowMinutes", value)}
          suffix="min"
          value={state.cancellationWindowMinutes}
        />
        <label className="grid gap-1">
          <span className="text-sm font-extrabold text-[#211c24]"><WorkspaceText text="POS ticket creation" /></span>
          <select
            className={styles.select}
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                ticketCreationMode: event.target.value as BookingTicketCreationMode,
              }))
            }
            value={state.ticketCreationMode}
          >
            <option value="manual"><WorkspaceText text="Manual" /></option>
            <option value="on_check_in"><WorkspaceText text="On check-in" /></option>
            <option value="on_service_start"><WorkspaceText text="On service start" /></option>
          </select>
        </label>
      </section>

      <section className={classNames(styles.panel, "grid gap-4 p-5")}>
        <div>
          <p className={styles.eyebrow}><WorkspaceText text="Professional assignment" /></p>
          <h2 className="mt-2 text-xl font-extrabold text-[#211c24]"><WorkspaceText text="Customer choice" /></h2>
        </div>
        <Toggle checked={state.reminderEnabled} disabled={!canManage} label={__vt("Send an email reminder within 24 hours of the appointment")} onChange={(value) => setBoolean("reminderEnabled", value)} />
          <Toggle checked={state.autoAssignEnabled} disabled={!canManage} label={__vt("Auto assign available professionals fairly (Portable)")} onChange={(value) => setBoolean("autoAssignEnabled", value)} />
        <Toggle checked={state.confirmationEmailEnabled} disabled={!canManage} label={__vt("Email booking updates (requires connected provider)")} onChange={(value) => setBoolean("confirmationEmailEnabled", value)} />
        <Toggle
          checked={state.anyProfessionalEnabled}
          disabled={!canManage}
          label={__vt("Any Professional")}
          onChange={(value) => setBoolean("anyProfessionalEnabled", value)}
        />
        <Toggle
          checked={state.splitStaffAppointmentEnabled}
          disabled={!canManage}
          label={__vt("Split-staff appointments")}
          onChange={(value) => setBoolean("splitStaffAppointmentEnabled", value)}
        />
        <Toggle
          checked={state.guestBookingEnabled}
          disabled={!canManage}
          label={__vt("Guest booking")}
          onChange={(value) => setBoolean("guestBookingEnabled", value)}
        />
        <label className="grid gap-1">
          <span className="text-sm font-extrabold text-[#211c24]"><WorkspaceText text="Timezone" /></span>
          <TimeZoneSelect
            className={styles.field}
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({ ...current, timezoneIana: event.target.value }))
            }
            value={state.timezoneIana}
          />
        </label>
      </section>

      <div className="xl:col-span-2">
        {canManage ? (
          <button
            className={classNames(styles.primaryButton, "px-5")}
            disabled={isPending}
            type="submit"
          >
            {isPending ? "Saving" : <WorkspaceText text="Save settings" />}
          </button>
        ) : (
          <p className="text-sm text-[#786d78]"><WorkspaceText text="You have read-only booking access." /></p>
        )}
      </div>
    </form>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[#f0e6df] bg-white px-3">
      <span className="text-sm font-extrabold text-[#211c24]"><WorkspaceText text={label} /></span>
      <input
        checked={checked}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span
        aria-hidden="true"
        className={classNames(
          "relative inline-flex h-6 w-11 shrink-0 rounded-full transition",
          checked ? "bg-[#f26f3d]" : "bg-[#ffd6c4]",
          disabled && "opacity-50",
        )}
      >
        <span
          className={classNames(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </span>
    </label>
  );
}

function NumberField({
  disabled,
  label,
  onChange,
  suffix,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  suffix: string;
  value: number;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-extrabold text-[#211c24]"><WorkspaceText text={label} /></span>
      <div className="flex overflow-hidden rounded-xl border border-[#f0e6df] bg-white">
        <input
          className="min-h-10 min-w-0 flex-1 px-3 text-sm outline-none"
          disabled={disabled}
          min={0}
          onChange={(event) => onChange(event.target.value)}
          type="number"
          value={value}
        />
        <span className="grid min-h-10 place-items-center border-l border-[#f0e6df] px-3 text-sm text-[#786d78]">
          <WorkspaceText text={suffix} />
        </span>
      </div>
    </label>
  );
}

function OwnerAgenda({bookings, filters, range, timezone, canManage, onOpen}: {
  bookings: BookingWorkspaceItem[]; filters: BookingWorkspaceFilters; range: BookingWorkspaceClientProps["range"];
  timezone: string; canManage: boolean; onOpen: (booking: BookingWorkspaceItem) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      const target = event.target as Element;
      if (target.closest('[role="dialog"], .owner-agenda-item')) return;
      root.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(item => {
        if (!item.contains(target) && item.dataset.busy !== "true") item.open = false;
      });
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const visible = rangeScopedBookings(bookings, filters, timezone).slice().sort((a,b)=>Date.parse(a.start_at)-Date.parse(b.start_at));
  const groups = filters.view === "week" ? range.days : filters.dateRange === "day" ? [{date:filters.date,label:""}] :
    [...new Set(visible.map(item=>dateParts(item.start_at,timezone).date))].map(date=>({date,label:formatDateOnly(`${date}T12:00:00Z`,timezone)}));
  return <div className="owner-agenda" ref={root}>
    {!visible.length && filters.view !== "week" ? <p className="owner-agenda-empty"><WorkspaceText text="No appointments for this selection. Choose another date or clear filters." /></p> : null}
    {groups.map(day => {
      const items = visible.filter(item=>dateParts(item.start_at,timezone).date===day.date);
      return <section key={day.date} className="owner-agenda-day">
        {day.label ? <div className="owner-agenda-day-heading"><h2><WorkspaceText text={day.label} /></h2><span>{items.length ? `${items.length} booked` : <WorkspaceText text="No appointments" />}</span></div> : null}
        {items.map(booking=><OwnerAgendaRow key={`${booking.id}:${booking.updated_at}`} booking={booking} timezone={timezone} canManage={canManage} onOpen={onOpen}/>)}
      </section>;
    })}
  </div>;
}

function OwnerAgendaRow({booking,timezone,canManage,onOpen}: {booking:BookingWorkspaceItem;timezone:string;canManage:boolean;onOpen:(booking:BookingWorkspaceItem)=>void}) {
  
  const [pending,startTransition]=useTransition();
  const [result,setResult]=useState<BookingActionResult|null>(null);
  const [confirmed,setConfirmed]=useState(false);
  return <details className="owner-agenda-item" name="owner-appointment" data-busy={pending}>
    <summary className="owner-agenda-row">
      <time dateTime={booking.start_at}><WorkspaceText text={formatTime(booking.start_at,timezone)} /></time>
      <span className="owner-agenda-customer"><strong>{booking.customer?.name ?? "Unknown customer"}</strong>
        <span><WorkspaceText text={booking.serviceNames.join(" / ") || "No services"} /> · {booking.durationMinutes} <WorkspaceText text="min ·" /> {formatMoney(booking.subtotal)}</span>
        <small><WorkspaceText text={booking.assignedStaffNames.join(", ") || "Unassigned"} /></small>
      </span>
      <StatusBadge status={confirmed ? "confirmed" : booking.normalizedStatus} kind={booking.no_show_kind}/><span className="owner-agenda-chevron"><DownChevronIcon/></span>
    </summary>
    <div className="owner-agenda-expanded">
      <dl>
        {canManage && booking.customer?.phone ? <div><dt><WorkspaceText text="Phone" /></dt><dd><a href={`tel:${booking.customer.phone}`}>{booking.customer.phone}</a></dd></div>:null}
        {canManage && booking.customer?.email ? <div><dt><WorkspaceText text="Email" /></dt><dd><a href={`mailto:${booking.customer.email}`}>{booking.customer.email}</a></dd></div>:null}
        {booking.public_notes || booking.notes ? <div><dt><WorkspaceText text="Customer note" /></dt><dd>{booking.public_notes || booking.notes}</dd></div>:null}
        {canManage && booking.internal_notes ? <div><dt><WorkspaceText text="Internal note" /></dt><dd>{booking.internal_notes}</dd></div>:null}
        {Boolean(booking.noShowCount) ? <div><dt><WorkspaceText text="No-show history" /></dt><dd>{booking.noShowCount} <WorkspaceText text="previous no-show" />{booking.noShowCount===1?"":"s"}</dd></div>:null}
        {booking.no_show_reason ? <div><dt><WorkspaceText text="No-show reason" /></dt><dd>{booking.no_show_reason}</dd></div>:null}
        {booking.cancellation_reason ? <div><dt><WorkspaceText text="Cancellation" /></dt><dd>{booking.cancellation_reason}</dd></div>:null}
      </dl>
      <CustomerInspirationSection booking={booking}/>
      <Message result={result}/>
      <div className="owner-agenda-actions">
        {canManage && !confirmed && booking.normalizedStatus === "pending" ? <button className={styles.primaryButton} disabled={pending} type="button" onClick={()=>startTransition(async()=>{
          try {const response=await runBookingStatusAction({bookingId:booking.id,expectedUpdatedAt:booking.updated_at,command:"confirm",reason:""});setResult(response);if(response.ok){setConfirmed(true);}}
          catch {setResult({ok:false,message:"Could not confirm. Please try again."});}
        })}>{pending?"Confirming…":<WorkspaceText text="Confirm" />}</button>:null}
        <button type="button" className={styles.secondaryButton} disabled={pending} onClick={()=>onOpen(booking)}><WorkspaceText text={canManage?"Edit / Manage":"View appointment"} /></button>
        {booking.posTicket ? <a className={styles.secondaryButton} href={`/pos-tickets/${booking.posTicket.id}`}><WorkspaceText text="POS ticket" /></a>:null}
      </div>
    </div>
  </details>;
}

export function BookingWorkspaceClient({
  bookings,
  canManageBookings,
  filters,
  options,
  accountName,
  publicBookingHref,
  range,
  requests,
  salonName,
  setupPermissions,
  settings,
  timezone,
  warnings,
}: BookingWorkspaceClientProps) {
  const __vt = useWorkspaceTranslation();

  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedBookingId =
    searchParams.get("bookingId") ?? filters.selectedBookingId;
  const selectedBooking = useMemo(
    () =>
      selectedBookingId
        ? (bookings.find((booking) => booking.id === selectedBookingId) ?? null)
        : null,
    [bookings, selectedBookingId],
  );
  const [drawerPrefill, setDrawerPrefill] = useState<DraftPrefill | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [timeline, setTimeline] = useState(false);
  const navigation = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    function dismiss(event: PointerEvent) {navigation.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(item=>{if(!item.contains(event.target as Node))item.open=false;});}
    function escape(event: globalThis.KeyboardEvent) {if(event.key==='Escape')navigation.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(item=>item.open=false);}
    document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);
    return ()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);};
  },[]);
  const today=todayInTimeZone(timezone), tomorrow=addDays(today,1);
  function goDay(date:string) {
    setTimeline(false);
    router.push(buildUrl(pathname,searchParams,{date,range:null,view:"day",tab:"calendar",bookingId:null}),{scroll:false});
    navigation.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(item=>item.open=false);
  }


  function openBooking(booking: BookingWorkspaceItem) {
    router.replace(
      buildUrl(pathname, searchParams, { bookingId: booking.id }),
      { scroll: false },
    );
  }

  function closeBooking() {
    router.replace(buildUrl(pathname, searchParams, { bookingId: null }), {
      scroll: false,
    });
  }

  function openRequest(request: BookingWorkspaceRequest) {
    setDrawerPrefill({
      customerUserId: request.customerUserId,
      internalNotes: [
        request.privateNote,
        request.lookId ? `Look ID: ${request.lookId}` : null,
        `Legacy request ID: ${request.id}`,
      ]
        .filter(Boolean)
        .join("\n"),
      serviceId: request.serviceId,
      source: "legacy_request",
      sourceReferenceId: request.id,
      sourceReferenceType: "salon_profile_booking_request",
      staffId: request.staffId,
      startLocal: request.requestedStartAt
        ? toLocalInputValue(request.requestedStartAt, timezone)
        : null,
    });
    setShowCreate(true);
  }

  const appointmentCount = rangeScopedBookings(
    bookings,
    filters,
    timezone,
  ).length;
  const setupIncomplete = bookingReadinessSteps({
    bookingEnabled: settings.booking_enabled,
    guestBookingEnabled: settings.guest_booking_enabled,
    onlineBookingVisible: settings.online_booking_visible,
    options,
    publicBookingHref,
    timezoneIana: settings.timezone_iana,
    warnings,
  }).some((step) => !step.complete);

  return (
    <main
      aria-label={__vt(`${accountName} ${salonName} booking workspace`)}
      className={classNames(styles.bookingSurface, styles.ownerRoot)}
      data-booking-surface="owner"
      data-testid="booking-owner-root"
    >
      <section className="booking-owner-header owner-schedule-header" ref={navigation}>
        <div className="flex min-w-0 items-center gap-3">
<nav style={{ flex: "1 1 auto", minWidth: 0 }} className="owner-schedule-tabs" aria-label={__vt("Booking schedule")}>
          <button type="button" aria-current={filters.tab==='calendar' && filters.date===today && filters.dateRange==='day' && filters.view!=='week'?"page":undefined} onClick={()=>goDay(today)}><CalendarIcon/><span><WorkspaceText text="Today" /></span></button>
          <button type="button" aria-current={filters.tab==='calendar' && filters.date===tomorrow && filters.dateRange==='day' && filters.view!=='week'?"page":undefined} onClick={()=>goDay(tomorrow)}><ChevronIcon direction="right"/><span><WorkspaceText text="Next day" /></span></button>
          <details data-dismissible-popover className="owner-schedule-menu"><summary><CalendarIcon/><span><WorkspaceText text="Calendar" /></span></summary><div className="owner-schedule-popover">
            <SchedulePicker key={filters.date} date={filters.date} range={filters.dateRange} status={filters.status ?? ""} onChange={value => {
              setTimeline(false);
              router.push(buildUrl(pathname, searchParams, { date:value.date, range:value.range === "day" ? null : value.range, status:value.status || null, view:"list", tab:"calendar", bookingId:null }), {scroll:false});
              navigation.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(item=>item.open=false);
            }}/>
          </div></details>
          <details data-dismissible-popover className="owner-schedule-menu"><summary><SettingsIcon/><span><WorkspaceText text="Settings" /></span></summary><div className="owner-schedule-popover owner-settings-menu">
            <WorkspaceTabs appointmentCount={appointmentCount} filters={filters} setupIncomplete={setupIncomplete}/>
          </div></details>
        </nav>
<ContextualSupport />
</div>
        <div className="owner-schedule-date">
          <h1>{filters.tab==='calendar' ? `${filters.dateRange==='day' && filters.view!=='week' ? filters.date===today?'Today, ':filters.date===tomorrow?'Tomorrow, ':'' : ''}${filters.dateRange==='day' && filters.view!=='week' ? new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${filters.date}T12:00:00Z`)):formatToolbarRange(filters,timezone)}` : filters.tab==='booking-page'?'Booking page':filters.tab==='availability'?'Availability':<WorkspaceText text="Booking settings" />}</h1>
          <div><span><WorkspaceText text={filters.tab === "availability" ? `${options.staff.length} professionals` : `${appointmentCount} booked`} /></span>{canManageBookings && filters.tab !== "availability" ? <button type="button" className="owner-schedule-new" data-testid="booking-owner-new-appointment" onClick={()=>{setDrawerPrefill(null);setShowCreate(true);}}><WorkspaceText text="＋ New" /></button>:null}</div>
        </div>
        {filters.query || filters.staffId || filters.status || filters.serviceId || filters.source ? <div className="owner-active-filter"><WorkspaceText text="Filtered appointments" /> <a href={buildUrl(pathname,searchParams,{q:null,staff:null,status:null,service:null,source:null})}><WorkspaceText text="Clear filters" /></a></div>:null}
      </section>

      <section className={styles.ownerContent}>
        {filters.tab === "calendar" ? (
          <>
            <section
              className={styles.workspaceCard}
              data-testid="booking-owner-board"
            >
              {!timeline ? <OwnerAgenda bookings={bookings} canManage={canManageBookings} filters={filters} range={range} timezone={timezone} onOpen={openBooking}/> :
              <CalendarView
                bookings={bookings}
                canManage={canManageBookings}
                filters={filters}
                onOpen={openBooking}
                options={options}
                range={range}
                timezone={timezone}
              />}
            </section>
            {requests.length > 0 ? (
              <section className={classNames(styles.panel, "p-5")}>
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className={styles.eyebrow}><WorkspaceText text="Request inbox" /></p>
                    <h2 className="mt-2 text-xl font-extrabold text-[#211c24]">
                      <WorkspaceText text="Legacy requests" />
                    </h2>
                  </div>
                  <p className="text-sm text-[#786d78]">
                    {requests.length} <WorkspaceText text="request" />{requests.length === 1 ? "" : "s"}
                  </p>
                </div>
                <RequestsPanel
                  canManage={canManageBookings}
                  onConvert={openRequest}
                  requests={requests}
                  timezone={timezone}
                />
              </section>
            ) : null}
          </>
        ) : null}

        {filters.tab === "booking-page" ? (
          <BookingPagePanel
            canManage={canManageBookings}
            options={options}
            publicBookingHref={publicBookingHref}
            salonName={salonName}
            setupPermissions={setupPermissions}
            settings={settings}
            warnings={warnings}
          />
        ) : null}

        {filters.tab === "availability" ? (
          <AvailabilityPanel
            canManage={canManageBookings}
            options={options}
            settings={settings}
          />
        ) : null}

        {filters.tab === "settings" ? (
          <OwnerSettingsPanel
            canManage={canManageBookings}
            settings={settings}
          />
        ) : null}
      </section>

      {selectedBooking ? (
        <DetailDrawer
          key={selectedBooking.id}
          booking={selectedBooking}
          canManage={canManageBookings}
          onClose={closeBooking}
          options={options}
          settings={settings}
          timezone={timezone}
        />
      ) : null}

      {showCreate ? (
        <AppointmentDrawer
          bookings={bookings}
          onClose={() => setShowCreate(false)}
          options={options}
          prefill={drawerPrefill}
          settings={settings}
          timezone={timezone}
        />
      ) : null}
    </main>
  );
}
