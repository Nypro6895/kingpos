"use client";

import {
  createPublicBookingAction,
  loadPublicBookingAvailabilityHintsAction,
  loadPublicBookingSlotsAction,
} from "@/app/book/actions";
import type {
  PublicBookingAddOnSelection,
  PublicBookingAvailabilityHint,
  PublicBookingAvailabilityScope,
  PublicBookingPageData,
  PublicBookingSlot,
  PublicBookingStaffMode,
} from "@/lib/public-booking";
import { useEffect, useMemo, useState, useTransition } from "react";

type PublicBookingClientProps = {
  data: PublicBookingPageData;
};

type CustomerDraft = {
  email: string;
  firstName: string;
  lastName: string;
  notes: string;
  phone: string;
};

type CustomerFieldKey = keyof Pick<
  CustomerDraft,
  "email" | "firstName" | "lastName" | "phone"
>;

type CustomerFieldErrors = Partial<Record<CustomerFieldKey, string>>;

type BookingIdentityMode = "choice" | "guest";

type StoredBookingDraft = {
  customer: CustomerDraft;
  date: string;
  identityMode?: BookingIdentityMode;
  inspirationId?: string | null;
  inspirationRemoved?: boolean;
  lineStaffByKey: Record<string, string>;
  selectedAddOnSelections: PublicBookingAddOnSelection[];
  selectedServiceIds: string[];
  selectedSlotStart: string;
  staffId: string;
  staffMode: PublicBookingStaffMode;
  step: number;
  version: 2;
};

type SummaryLine = {
  key: string;
  lineType: "add_on" | "service";
  parentName: string | null;
  service: PublicBookingPageData["services"][number];
};

type AvailabilityHintMap = Record<string, PublicBookingAvailabilityHint | undefined>;

const STEPS = [
  "Services",
  "Professional",
  "Date & time",
  "Your details",
  "Review",
] as const;

const styles = {
  addButton: "public-booking-add-button",
  addButtonSelected: "public-booking-add-button-selected",
  addonCard: "public-booking-addon-card",
  addonCardSelected: "public-booking-addon-card-selected",
  addonGrid: "public-booking-addon-grid",
  addonPanel: "public-booking-addon-panel",
  bookingSurface: "public-booking-surface",
  checkboxInput: "public-booking-checkbox-input",
  checkboxVisual: "public-booking-checkbox-visual",
  editorialImage: "public-booking-editorial-image",
  editorialRail: "public-booking-editorial",
  eyebrow: "public-booking-eyebrow",
  field: "public-booking-field",
  pageTitle: "public-booking-page-title",
  pill: "public-booking-pill",
  pillActive: "public-booking-pill-active",
  pillRow: "public-booking-pill-row",
  priceColumn: "public-booking-price-column",
  professionalAvatar: "public-booking-professional-avatar",
  professionalGrid: "public-booking-professional-grid",
  professionalGridScroll: "public-booking-professional-grid-scroll",
  professionalList: "public-booking-professional-list",
  professionalMeta: "public-booking-professional-meta",
  professionalName: "public-booking-professional-name",
  professionalNext: "public-booking-professional-next",
  professionalNextLoading: "public-booking-professional-next-loading",
  professionalOption: "public-booking-professional-option",
  professionalOptionAuto: "public-booking-professional-option-auto",
  professionalOptionCompact: "public-booking-professional-option-compact",
  professionalOptionSelected: "public-booking-professional-option-selected",
  professionalRadio: "public-booking-professional-radio",
  professionalRadioVisual: "public-booking-professional-radio-visual",
  professionalRole: "public-booking-professional-role",
  professionalShowMore: "public-booking-professional-show-more",
  professionalSplitHeader: "public-booking-professional-split-header",
  professionalSplitPanel: "public-booking-professional-split-panel",
  professionalSplitSection: "public-booking-professional-split-section",
  primaryButton: "public-booking-primary-button",
  progress: "public-booking-progress",
  progressActive: "public-booking-progress-active",
  progressCircle: "public-booking-progress-circle",
  progressDone: "public-booking-progress-done",
  progressStep: "public-booking-progress-step",
  quickBookStrip: "public-booking-quick-book-strip",
  publicCard: "public-booking-card",
  publicCopy: "public-booking-copy",
  publicHeading: "public-booking-heading",
  publicMain: "public-booking-content",
  publicRoot: "public-booking-root",
  publicShell: "public-booking-shell",
  publicTitle: "public-booking-title",
  secondaryButton: "public-booking-secondary-button",
  select: "public-booking-select",
  serviceCard: "public-booking-service-card",
  serviceCardSelected: "public-booking-service-card-selected",
  serviceIcon: "public-booking-service-icon",
  statusArrived: "public-booking-status-arrived",
  statusBadge: "public-booking-status-badge",
  statusPending: "public-booking-status-pending",
  summary: "public-booking-summary",
  summaryDivider: "public-booking-summary-divider",
  summaryMedia: "public-booking-summary-media",
  summaryPrimary: "public-booking-summary-primary",
} as const;

const STEP_SERVICES = 0;
const STEP_PROFESSIONAL = 1;
const STEP_TIME = 2;
const STEP_DETAILS = 3;
const STEP_REVIEW = 4;
const STEP_DONE = 5;
const PUBLIC_BOOKING_DRAFT_VERSION = 2;

function classNames(...classes: (false | null | string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function initialsFor(value: string | null | undefined) {
  const parts = (value ?? "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length
    ? parts
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("")
    : "K";
}

function draftStorageKey(salonId: string | null | undefined) {
  return salonId ? `kingpos.publicBookingDraft.${salonId}` : null;
}

function readStoredBookingDraft(salonId: string | null | undefined) {
  const key = draftStorageKey(salonId);

  if (!key || typeof window === "undefined") {
    return null;
  }

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as
      | Partial<StoredBookingDraft>
      | null;

    if (
      !parsed ||
      parsed.version !== PUBLIC_BOOKING_DRAFT_VERSION ||
      !Array.isArray(parsed.selectedServiceIds)
    ) {
      return null;
    }

    return parsed as StoredBookingDraft;
  } catch {
    return null;
  }
}

function clearStoredBookingDraft(salonId: string | null | undefined) {
  const key = draftStorageKey(salonId);

  if (key && typeof window !== "undefined") {
    window.sessionStorage.removeItem(key);
  }
}

function splitDisplayName(value: string | null | undefined) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { firstName: "", lastName: "" };
  }

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.at(-1) ?? "",
  };
}

function nonEmpty(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function emailIsValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function phoneIsValid(value: string) {
  return value.replace(/\D+/g, "").length >= 7;
}

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function maskEmail(value: string | null | undefined) {
  const email = nonEmpty(value);

  if (!email || !email.includes("@")) {
    return null;
  }

  const [local, domain] = email.split("@");
  const safeLocal =
    local.length <= 2 ? `${local[0] ?? "*"}*` : `${local.slice(0, 2)}***`;

  return `${safeLocal}@${domain}`;
}

function maskPhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D+/g, "");

  if (digits.length < 4) {
    return null;
  }

  return `***-***-${digits.slice(-4)}`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function minutes(value: number) {
  if (value < 60) {
    return `${value} min`;
  }

  const hours = Math.floor(value / 60);
  const remaining = value % 60;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
}

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: timezone,
    weekday: "short",
  }).format(new Date(value));
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function zonedDateKey(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(value);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return `${read("year")}-${read("month")}-${read("day")}`;
}

function addDaysKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

function nextAvailabilityText(input: {
  hint: PublicBookingAvailabilityHint | undefined;
  timezone: string;
}) {
  if (!input.hint) {
    return "Check availability";
  }

  if (!input.hint.startAt) {
    return "No openings in the next 30 days";
  }

  const start = new Date(input.hint.startAt);
  const slotDate = zonedDateKey(start, input.timezone);
  const today = zonedDateKey(new Date(), input.timezone);
  const tomorrow = addDaysKey(today, 1);
  const time = formatTime(input.hint.startAt, input.timezone);

  if (slotDate === today) {
    return `Next available: Today, ${time}`;
  }

  if (slotDate === tomorrow) {
    return `Next available: Tomorrow, ${time}`;
  }

  return `Next available: ${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: input.timezone,
    weekday: "short",
  }).format(start)}`;
}

function splitHintKey(lineKey: string, staffId: string | null) {
  return `split:${lineKey}:${staffId || "any"}`;
}

function staffHintKey(staffId: string) {
  return `staff:${staffId}`;
}

function serviceStaffNames(data: PublicBookingPageData, serviceId: string | null) {
  if (!serviceId) {
    return [];
  }

  const ids = data.staffByService[serviceId] ?? [];
  return ids
    .map((id) => data.staff.find((staff) => staff.id === id))
    .filter((staff): staff is PublicBookingPageData["staff"][number] => Boolean(staff));
}

function uniqueStrings(values: string[]) {
  return values.filter((value, index, list) => value && list.indexOf(value) === index);
}

function addOnKey(selection: PublicBookingAddOnSelection) {
  return `${selection.parentServiceId}:${selection.serviceId}`;
}

function StaffAvatar({
  className,
  staff,
}: {
  className?: string;
  staff: PublicBookingPageData["staff"][number];
}) {
  return (
    <span className={classNames(styles.professionalAvatar, className)}>
      {staff.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" src={staff.avatarUrl} />
      ) : (
        initialsFor(staff.displayName)
      )}
    </span>
  );
}

function ProfessionalRadioOption({
  availabilityText,
  checked,
  className,
  description,
  isLoading,
  name,
  onChange,
  staff,
  title,
  value,
}: {
  availabilityText: string;
  checked: boolean;
  className?: string;
  description?: string | null;
  isLoading: boolean;
  name: string;
  onChange: () => void;
  staff?: PublicBookingPageData["staff"][number];
  title: string;
  value: string;
}) {
  return (
    <label
      className={classNames(
        styles.professionalOption,
        !staff && styles.professionalOptionAuto,
        checked && styles.professionalOptionSelected,
        className,
      )}
    >
      <input
        checked={checked}
        className={styles.professionalRadio}
        name={name}
        onChange={onChange}
        type="radio"
        value={value}
      />
      {staff ? <StaffAvatar staff={staff} /> : null}
      <span className={styles.professionalMeta}>
        <span className={styles.professionalName}>{title}</span>
        {description ? (
          <span className={styles.professionalRole}>{description}</span>
        ) : null}
        <span
          className={classNames(
            styles.professionalNext,
            isLoading && styles.professionalNextLoading,
          )}
        >
          {availabilityText}
        </span>
      </span>
      <span className={styles.professionalRadioVisual} aria-hidden="true" />
    </label>
  );
}

function staffEligibleForServices(data: PublicBookingPageData, serviceIds: string[]) {
  const uniqueServiceIds = uniqueStrings(serviceIds);

  if (uniqueServiceIds.length === 0) {
    return [];
  }

  const staffIds = uniqueServiceIds.reduce<string[] | null>((current, serviceId) => {
    const ids = data.staffByService[serviceId] ?? [];

    return current === null
      ? ids
      : current.filter((staffId) => ids.includes(staffId));
  }, null);

  return (staffIds ?? [])
    .map((id) => data.staff.find((staff) => staff.id === id))
    .filter((staff): staff is PublicBookingPageData["staff"][number] => Boolean(staff));
}

function UnavailableState({ data }: { data: PublicBookingPageData }) {
  return (
    <main
      className={classNames(styles.bookingSurface, styles.publicRoot)}
      data-booking-surface="public"
      data-testid="public-booking-root"
    >
      <div className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-5 py-10">
        <section className={classNames(styles.publicCard, "w-full p-6")}>
          <p className={styles.eyebrow}>Reylumi booking</p>
          <h1 className={classNames(styles.pageTitle, "mt-3")}>{data.title}</h1>
          <p className="mt-3 text-sm leading-6 text-[#786d78]">{data.message}</p>
          {data.readiness.length > 0 ? (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {data.readiness.map((item) => (
                <li
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#e7dfe5] bg-white px-4 py-3 text-sm"
                  key={item.id}
                >
                  <span className="font-extrabold text-[#211c24]">{item.label}</span>
                  <span
                    className={classNames(
                      styles.statusBadge,
                      item.complete ? styles.statusArrived : styles.statusPending,
                    )}
                  >
                    {item.complete ? "Ready" : "Needs setup"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function slotHour(slot: PublicBookingSlot, timezone: string) {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(new Date(slot.startAt)),
  );
}

function BookingInspirationCard({
  compact = false,
  currentServiceName,
  currentStaffName,
  inspiration,
  onChangeProfessional,
  onChangeService,
  onRemove,
}: {
  compact?: boolean;
  currentServiceName?: string | null;
  currentStaffName?: string | null;
  inspiration: NonNullable<PublicBookingPageData["initialSelection"]["inspiration"]>;
  onChangeProfessional?: () => void;
  onChangeService?: () => void;
  onRemove?: () => void;
}) {
  const contentLabel = inspiration.contentType === "update" ? "post" : "look";
  const label =
    currentServiceName && inspiration.contentType === "look"
      ? "BOOK THIS LOOK"
      : "BOOK WITH THIS INSPIRATION";
  const serviceLabel = currentServiceName
    ? `You're booking ${currentServiceName}${
        currentStaffName ? ` with ${currentStaffName}` : ""
      } for this ${contentLabel}.`
    : inspiration.message ??
      "Choose services and a professional. We'll keep this inspiration attached.";
  const originalContext = inspiration.originalServiceName
    ? `Original: ${inspiration.originalServiceName}${
        inspiration.originalStaffName ? ` with ${inspiration.originalStaffName}` : ""
      }`
    : null;
  const thumbClass = classNames(
    "overflow-hidden rounded-lg bg-[#f7f2f7]",
    compact ? "h-16 w-16" : "h-20 w-20 sm:h-24 sm:w-24",
  );

  return (
    <section
      className={classNames(
        compact
          ? "grid grid-cols-[64px_1fr] gap-3 rounded-lg bg-[#f7f2f7] p-3"
          : classNames(styles.publicCard, "mb-5 grid gap-4 p-4 sm:grid-cols-[96px_1fr]"),
      )}
      data-testid="booking-inspiration-card"
    >
      {inspiration.imageUrl ? (
        <a
          aria-label="Open inspiration image"
          className={thumbClass}
          href={inspiration.imageUrl}
          rel="noreferrer"
          target="_blank"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={`${inspiration.title} inspiration`}
            className="h-full w-full object-cover"
            src={inspiration.imageUrl}
          />
        </a>
      ) : (
        <div className={thumbClass}>
          <span className="grid h-full w-full place-items-center px-2 text-center text-xs font-extrabold text-[#642a56]">
            Inspiration
          </span>
        </div>
      )}
      <div className="min-w-0">
        <p className={styles.eyebrow}>{label}</p>
        <h2 className="mt-1 line-clamp-2 text-base font-extrabold text-[#211c24]">
          {inspiration.title}
        </h2>
        <p className="mt-1 text-sm font-extrabold text-[#642a56]">
          {serviceLabel}
        </p>
        {!currentServiceName && originalContext ? (
          <p className="mt-2 text-xs font-semibold text-[#786d78]">
            {originalContext}
          </p>
        ) : null}
        {inspiration.message && currentServiceName ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            {inspiration.message}
          </p>
        ) : inspiration.caption ? (
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#786d78]">
            {inspiration.caption}
          </p>
        ) : null}
        {!compact ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {onChangeService ? (
              <button
                className={classNames(styles.secondaryButton, "px-3 py-2 text-sm")}
                onClick={onChangeService}
                type="button"
              >
                {inspiration.serviceId ? "Change service" : "Choose service"}
              </button>
            ) : null}
            {onChangeProfessional ? (
              <button
                className={classNames(styles.secondaryButton, "px-3 py-2 text-sm")}
                onClick={onChangeProfessional}
                type="button"
              >
                Change professional
              </button>
            ) : null}
            {onRemove ? (
              <button
                className="px-2 py-2 text-sm font-extrabold text-[#642a56]"
                onClick={onRemove}
                type="button"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function BookingInspirationSummaryRow({
  currentServiceName,
  inspiration,
}: {
  currentServiceName?: string | null;
  inspiration: NonNullable<PublicBookingPageData["initialSelection"]["inspiration"]>;
}) {
  const bookedAs = currentServiceName
    ? `Booking as ${currentServiceName}`
    : "Choose a service to continue.";
  const label =
    inspiration.contentType === "update"
      ? "Inspired by this post"
      : "Inspired by this look";

  return (
    <div className="grid grid-cols-[52px_1fr] items-center gap-3">
      <div className="h-[52px] w-[52px] overflow-hidden rounded-lg bg-[#f7f2f7]">
        {inspiration.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className="h-full w-full object-cover"
            src={inspiration.imageUrl}
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-[10px] font-extrabold text-[#642a56]">
            IMG
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-extrabold text-[#211c24]">
          {label}
        </p>
        <p className="truncate text-xs font-semibold text-[#786d78]">
          {bookedAs}
        </p>
      </div>
    </div>
  );
}

export function PublicBookingClient({ data }: PublicBookingClientProps) {
  const settings = data.settings;
  const mainServices = useMemo(
    () => data.services.filter((service) => !service.isAddOnOnly),
    [data.services],
  );
  const hasInitialInspiration = Boolean(data.initialSelection.inspiration);
  const initialServiceId =
    data.initialSelection.serviceId &&
    mainServices.some((service) => service.id === data.initialSelection.serviceId)
      ? data.initialSelection.serviceId
      : hasInitialInspiration
        ? ""
      : (mainServices[0]?.id ?? "");
  const initialServiceIds =
    data.initialSelection.serviceIds.length > 0
      ? data.initialSelection.serviceIds.filter((serviceId) =>
          mainServices.some((service) => service.id === serviceId),
        )
      : initialServiceId
        ? [initialServiceId]
        : [];
  const categoryNames = useMemo(
    () => [...new Set(mainServices.map((service) => service.category ?? "Services"))],
    [mainServices],
  );
  const initialCategory =
    mainServices.find((service) => service.id === initialServiceId)?.category ??
    categoryNames[0] ??
    "Services";
  const initialCustomerName = splitDisplayName(
    data.currentUser?.displayName ??
      [data.currentUser?.firstName, data.currentUser?.lastName]
        .filter(Boolean)
        .join(" "),
  );

  const [step, setStep] = useState(
    Math.min(STEP_REVIEW, Math.max(STEP_SERVICES, data.initialSelection.initialStep)),
  );
  const [category, setCategory] = useState(initialCategory);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(
    initialServiceIds,
  );
  const [selectedAddOnSelections, setSelectedAddOnSelections] = useState<
    PublicBookingAddOnSelection[]
  >(
    data.initialSelection.addOnSelections.length > 0
      ? data.initialSelection.addOnSelections
      : initialServiceIds.length === 1
        ? data.initialSelection.addOnServiceIds.map((serviceId) => ({
            parentServiceId: initialServiceIds[0],
            serviceId,
          }))
        : [],
  );
  const [staffMode, setStaffMode] = useState<PublicBookingStaffMode>(
    data.initialSelection.staffMode,
  );
  const [staffId, setStaffId] = useState(data.initialSelection.staffId ?? "");
  const [lineStaffByKey, setLineStaffByKey] = useState<Record<string, string>>({});
  const [date, setDate] = useState(data.initialSelection.date);
  const [slotResult, setSlotResult] = useState<{
    signature: string;
    slots: PublicBookingSlot[];
  }>({
    signature: "",
    slots: data.slots,
  });
  const [selectedSlotStart, setSelectedSlotStart] = useState(data.slots[0]?.startAt ?? "");
  const [availabilityResult, setAvailabilityResult] = useState<{
    hints: AvailabilityHintMap;
    signature: string;
  }>({
    hints: {},
    signature: "",
  });
  const [showAllProfessionals, setShowAllProfessionals] = useState(false);
  const [customer, setCustomer] = useState<CustomerDraft>({
    email: data.currentUser?.email ?? "",
    firstName: data.currentUser?.firstName ?? initialCustomerName.firstName,
    lastName: data.currentUser?.lastName ?? initialCustomerName.lastName,
    notes: "",
    phone: data.currentUser?.phone ?? "",
  });
  const [identityMode, setIdentityMode] = useState<BookingIdentityMode>("choice");
  const [honeypot, setHoneypot] = useState("");
  const [result, setResult] = useState<{
    accountLinked?: boolean;
    bookingId?: string;
    code?: string;
    confirmationStatus?: string;
    manageToken?: string | null;
    message: string;
    ok: boolean;
    status?: string;
  } | null>(null);
  const [detailsSheetIntent, setDetailsSheetIntent] = useState<"review" | "submit">(
    "review",
  );
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<CustomerFieldErrors>({});
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [inspirationRemoved, setInspirationRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isAvailabilityPending, startAvailabilityTransition] = useTransition();
  const [isSlotPending, startSlotTransition] = useTransition();
  const activeInspiration =
    data.initialSelection.inspiration && !inspirationRemoved
      ? data.initialSelection.inspiration
      : null;

  const selectedServices = useMemo(
    () =>
      selectedServiceIds
        .map((id) => data.services.find((service) => service.id === id))
        .filter((service): service is PublicBookingPageData["services"][number] =>
          Boolean(service),
        ),
    [data.services, selectedServiceIds],
  );
  const addOnOptions = useMemo(
    () =>
      selectedServices.flatMap((parent) =>
        parent.addOnIds
          .map((id) => data.services.find((service) => service.id === id))
          .filter((service): service is PublicBookingPageData["services"][number] =>
            Boolean(service),
          )
          .map((service) => ({ parent, service })),
      ),
    [data.services, selectedServices],
  );
  const selectedAddOns = useMemo(
    () =>
      selectedAddOnSelections
        .map((selection) => ({
          parent: data.services.find((service) => service.id === selection.parentServiceId),
          service: data.services.find((service) => service.id === selection.serviceId),
        }))
        .filter(
          (item): item is {
            parent: PublicBookingPageData["services"][number];
            service: PublicBookingPageData["services"][number];
          } => Boolean(item.parent && item.service),
        ),
    [selectedAddOnSelections, data.services],
  );
  const summaryLines = useMemo<SummaryLine[]>(
    () =>
      selectedServices.flatMap((service) => [
        {
          key: `service:${service.id}`,
          lineType: "service" as const,
          parentName: null,
          service,
        },
        ...selectedAddOns
          .filter((selection) => selection.parent.id === service.id)
          .map((selection) => ({
            key: `add_on:${selection.parent.id}:${selection.service.id}`,
            lineType: "add_on" as const,
            parentName: selection.parent.name,
            service: selection.service,
          })),
      ]),
    [selectedAddOns, selectedServices],
  );
  const summaryServices = useMemo(
    () => summaryLines.map((line) => line.service),
    [summaryLines],
  );
  const lineStaffIds = useMemo(
    () => summaryLines.map((line) => lineStaffByKey[line.key] ?? ""),
    [lineStaffByKey, summaryLines],
  );
  const slotRequestSignature = useMemo(
    () =>
      JSON.stringify({
        addOnSelections: selectedAddOnSelections,
        date,
        lineStaffIds,
        serviceIds: selectedServiceIds,
        staffId,
        staffMode,
      }),
    [
      date,
      lineStaffIds,
      selectedAddOnSelections,
      selectedServiceIds,
      staffId,
      staffMode,
    ],
  );
  const slots =
    data.state === "ready" &&
    selectedServiceIds.length > 0 &&
    slotResult.signature === slotRequestSignature
      ? slotResult.slots
      : [];
  const slotsLoading =
    data.state === "ready" &&
    selectedServiceIds.length > 0 &&
    (isSlotPending || slotResult.signature !== slotRequestSignature);
  const eligibleStaff = useMemo(
    () => staffEligibleForServices(data, summaryServices.map((service) => service.id)),
    [data, summaryServices],
  );
  const visibleEligibleStaff = useMemo(() => {
    if (showAllProfessionals || eligibleStaff.length <= 6) {
      return eligibleStaff;
    }

    const firstStaff = eligibleStaff.slice(0, 6);
    const selectedStaff = eligibleStaff.find((staff) => staff.id === staffId);

    if (
      selectedStaff &&
      !firstStaff.some((staff) => staff.id === selectedStaff.id)
    ) {
      return [...firstStaff.slice(0, 5), selectedStaff];
    }

    return firstStaff;
  }, [eligibleStaff, showAllProfessionals, staffId]);
  const selectedSlot = slots.find((slot) => slot.startAt === selectedSlotStart) ?? null;
  const professionalOnlyStaffId =
    activeInspiration?.readinessState === "professional_ready" &&
    selectedServiceIds.length === 0
      ? staffId
      : "";
  const visibleServices = mainServices
    .filter((service) => (service.category ?? "Services") === category)
    .sort((left, right) => {
      if (!professionalOnlyStaffId) {
        return 0;
      }

      const leftMatches = (data.staffByService[left.id] ?? []).includes(
        professionalOnlyStaffId,
      );
      const rightMatches = (data.staffByService[right.id] ?? []).includes(
        professionalOnlyStaffId,
      );

      if (leftMatches === rightMatches) {
        return 0;
      }

      return leftMatches ? -1 : 1;
    });
  const total = selectedSlot
    ? selectedSlot.lines.reduce((sum, line) => sum + line.unitPrice, 0)
    : summaryServices.reduce((sum, service) => sum + service.basePrice, 0);
  const totalMinutes = selectedSlot
    ? selectedSlot.lines.reduce((sum, line) => sum + line.durationMinutes, 0)
    : summaryServices.reduce(
        (sum, service) => sum + service.durationMinutes,
        0,
      );
  const splitSelectionValid = Boolean(
    settings?.splitStaffAppointmentEnabled &&
      summaryLines.length > 1 &&
      summaryLines.every((line, index) => {
        const selectedLineStaffId = lineStaffIds[index];

        return (
          !selectedLineStaffId ||
          serviceStaffNames(data, line.service.id).some(
            (staff) => staff.id === selectedLineStaffId,
          )
        );
      }),
  );
  const availabilityScopes = useMemo<PublicBookingAvailabilityScope[]>(() => {
    if (!settings || summaryLines.length === 0) {
      return [];
    }

    const scopes: PublicBookingAvailabilityScope[] = [];

    if (settings.anyProfessionalEnabled) {
      scopes.push({
        key: "any",
        staffMode: "any",
      });
    }

    for (const staff of eligibleStaff) {
      scopes.push({
        key: staffHintKey(staff.id),
        staffId: staff.id,
        staffMode: "specific",
      });
    }

    if (settings.splitStaffAppointmentEnabled && summaryLines.length > 1) {
      for (const [index, line] of summaryLines.entries()) {
        const autoLineStaffIds = [...lineStaffIds];
        autoLineStaffIds[index] = "";
        scopes.push({
          key: splitHintKey(line.key, null),
          lineStaffIds: autoLineStaffIds,
          staffMode: "split",
        });

        for (const staff of serviceStaffNames(data, line.service.id)) {
          const nextLineStaffIds = [...lineStaffIds];
          nextLineStaffIds[index] = staff.id;

          scopes.push({
            key: splitHintKey(line.key, staff.id),
            lineStaffIds: nextLineStaffIds,
            staffMode: "split",
          });
        }
      }
    }

    return scopes;
  }, [data, eligibleStaff, lineStaffIds, settings, summaryLines]);
  const availabilityScopeSignature = useMemo(
    () => JSON.stringify(availabilityScopes),
    [availabilityScopes],
  );
  const availabilityHints =
    availabilityResult.signature === availabilityScopeSignature
      ? availabilityResult.hints
      : {};
  const availabilityStatus =
    availabilityScopes.length === 0
      ? "idle"
      : isAvailabilityPending ||
          availabilityResult.signature !== availabilityScopeSignature
        ? "loading"
        : "ready";
  function chooseService(serviceId: string) {
    const service = mainServices.find((candidate) => candidate.id === serviceId);

    if (!service) {
      return;
    }

    const nextSelectedServiceIds = selectedServiceIds.includes(serviceId)
      ? selectedServiceIds.filter((id) => id !== serviceId)
      : [...selectedServiceIds, serviceId];

    setSelectedServiceIds(nextSelectedServiceIds);
    setSelectedAddOnSelections((current) =>
      current.filter((selection) =>
        nextSelectedServiceIds.includes(selection.parentServiceId),
      ),
    );
    setSelectedSlotStart("");
    setError(null);

    if (nextSelectedServiceIds.length === 0) {
      setStaffId("");
      setStaffMode(settings?.anyProfessionalEnabled ? "any" : "specific");
      return;
    }

    const originalStaffId = activeInspiration?.originalStaffId ?? null;

    if (
      originalStaffId &&
      nextSelectedServiceIds.every((id) =>
        (data.staffByService[id] ?? []).includes(originalStaffId),
      )
    ) {
      setStaffId(originalStaffId);
      setStaffMode("specific");
      return;
    }

    if (
      staffMode === "specific" &&
      staffId &&
      !nextSelectedServiceIds.every((id) =>
        (data.staffByService[id] ?? []).includes(staffId),
      )
    ) {
      setStaffId("");
      setStaffMode(settings?.anyProfessionalEnabled ? "any" : "specific");
    }
  }

  function storeDraftForAuth() {
    const key = draftStorageKey(data.salon?.salonId);

    if (!key || typeof window === "undefined") {
      return;
    }

    const draft: StoredBookingDraft = {
      customer,
      date,
      identityMode,
      inspirationId: data.initialSelection.inspiration?.id ?? null,
      inspirationRemoved,
      lineStaffByKey,
      selectedAddOnSelections,
      selectedServiceIds,
      selectedSlotStart,
      staffId,
      staffMode,
      step,
      version: PUBLIC_BOOKING_DRAFT_VERSION,
    };

    window.sessionStorage.setItem(key, JSON.stringify(draft));
  }

  useEffect(() => {
    if (data.state !== "ready" || !data.salon) {
      return;
    }

    let active = true;
    queueMicrotask(() => {
      if (!active) {
        return;
      }

      const draft = readStoredBookingDraft(data.salon?.salonId);

      if (!draft) {
        return;
      }

      const validServiceIds = draft.selectedServiceIds.filter((serviceId) =>
        mainServices.some((service) => service.id === serviceId),
      );

      if (validServiceIds.length === 0) {
        clearStoredBookingDraft(data.salon?.salonId);
        return;
      }

      const validServiceIdSet = new Set(validServiceIds);
      const validAddOnSelections = draft.selectedAddOnSelections.filter(
        (selection) =>
          validServiceIdSet.has(selection.parentServiceId) &&
          data.services.some((service) => service.id === selection.serviceId),
      );
      const firstService = mainServices.find(
        (service) => service.id === validServiceIds[0],
      );

      setSelectedServiceIds(validServiceIds);
      setSelectedAddOnSelections(validAddOnSelections);
      setStaffMode(draft.staffMode);
      setStaffId(draft.staffId);
      setLineStaffByKey(draft.lineStaffByKey);
      setDate(draft.date);
      setSelectedSlotStart(draft.selectedSlotStart);
      setInspirationRemoved(
        (draft.inspirationId ?? null) ===
          (data.initialSelection.inspiration?.id ?? null) &&
          draft.inspirationRemoved === true,
      );
      setCustomer((current) => ({
        email: data.currentUser?.email ?? draft.customer.email ?? current.email,
        firstName:
          data.currentUser?.firstName ??
          initialCustomerName.firstName ??
          draft.customer.firstName ??
          current.firstName,
        lastName:
          data.currentUser?.lastName ??
          initialCustomerName.lastName ??
          draft.customer.lastName ??
          current.lastName,
        notes: draft.customer.notes ?? current.notes,
        phone: data.currentUser?.phone ?? draft.customer.phone ?? current.phone,
      }));
      setIdentityMode(data.currentUser ? "choice" : draft.identityMode ?? "choice");
      setCategory(firstService?.category ?? categoryNames[0] ?? "Services");
      setStep(Math.min(STEP_REVIEW, Math.max(STEP_SERVICES, draft.step)));
      clearStoredBookingDraft(data.salon?.salonId);
    });

    return () => {
      active = false;
    };
  }, [
    categoryNames,
    data.currentUser,
    data.initialSelection.inspiration?.id,
    data.salon,
    data.services,
    data.state,
    initialCustomerName.firstName,
    initialCustomerName.lastName,
    mainServices,
  ]);

  useEffect(() => {
    if (data.state !== "ready" || !data.salon || availabilityScopes.length === 0) {
      return;
    }

    let active = true;
    const signature = availabilityScopeSignature;
    startAvailabilityTransition(async () => {
      const hints = await loadPublicBookingAvailabilityHintsAction({
        salonId: data.salon?.salonId ?? "",
        scopes: availabilityScopes,
        selection: {
          addOnSelections: selectedAddOnSelections,
          serviceId: selectedServiceIds[0] ?? null,
          serviceIds: selectedServiceIds,
        },
      });

      if (!active) {
        return;
      }

      setAvailabilityResult({
        hints: Object.fromEntries(hints.map((hint) => [hint.key, hint])),
        signature,
      });
    });

    return () => {
      active = false;
    };
  }, [
    availabilityScopeSignature,
    availabilityScopes,
    data.salon,
    data.state,
    selectedAddOnSelections,
    selectedServiceIds,
  ]);

  useEffect(() => {
    if (selectedServiceIds.length === 0 || staffMode !== "specific" || !staffId) {
      return;
    }

    if (eligibleStaff.some((staff) => staff.id === staffId)) {
      return;
    }

    queueMicrotask(() => {
      setStaffId("");
      setStaffMode(settings?.anyProfessionalEnabled ? "any" : "specific");
      setSelectedSlotStart("");
    });
  }, [eligibleStaff, selectedServiceIds.length, settings, staffId, staffMode]);

  useEffect(() => {
    if (data.state !== "ready" || selectedServiceIds.length === 0) {
      return;
    }

    let active = true;
    const signature = slotRequestSignature;
    startSlotTransition(async () => {
      const nextSlots = await loadPublicBookingSlotsAction({
        salonId: data.salon?.salonId ?? "",
        selection: {
          addOnSelections: selectedAddOnSelections,
          date,
          lineStaffIds,
          serviceId: selectedServiceIds[0] ?? null,
          serviceIds: selectedServiceIds,
          staffId,
          staffMode,
        },
      });

      if (!active) {
        return;
      }

      setSlotResult({ signature, slots: nextSlots });
      setSelectedSlotStart((current) =>
        nextSlots.some((slot) => slot.startAt === current)
          ? current
          : nextSlots[0]?.startAt ?? "",
      );
    });

    return () => {
      active = false;
    };
  }, [
    data.salon?.salonId,
    data.state,
    date,
    lineStaffIds,
    selectedAddOnSelections,
    selectedServiceIds,
    slotRequestSignature,
    staffId,
    staffMode,
  ]);

  if (data.state !== "ready" || !settings || !data.salon) {
    return <UnavailableState data={data} />;
  }

  const signedIn = Boolean(data.currentUser);
  const accountDisplayName =
    nonEmpty(data.currentUser?.displayName) ??
    nonEmpty([data.currentUser?.firstName, data.currentUser?.lastName].filter(Boolean).join(" ")) ??
    nonEmpty(data.currentUser?.email) ??
    nonEmpty(data.currentUser?.phone) ??
    "Your Reylumi account";
  const accountMaskedEmail = maskEmail(data.currentUser?.email);
  const accountMaskedPhone = maskPhone(data.currentUser?.phone);
  const signedInNeedsName =
    signedIn &&
    !nonEmpty(data.currentUser?.displayName) &&
    !nonEmpty(data.currentUser?.firstName) &&
    !nonEmpty(data.currentUser?.lastName);
  const signedInNeedsPhone = signedIn && !nonEmpty(data.currentUser?.phone);
  const signedInNeedsEmail = signedIn && !nonEmpty(data.currentUser?.email);
  const signedInDetailsComplete =
    (!signedInNeedsName ||
      Boolean(customer.firstName.trim() && customer.lastName.trim())) &&
    (!signedInNeedsPhone || Boolean(customer.phone.trim())) &&
    (!signedInNeedsEmail || Boolean(customer.email.trim()));
  const guestDetailsComplete = Boolean(
    customer.firstName.trim() &&
      customer.lastName.trim() &&
      customer.phone.trim() &&
      customer.email.trim(),
  );
  const detailsCanContinue = signedIn
    ? signedInDetailsComplete
    : identityMode === "guest" && guestDetailsComplete;
  const canContinue =
    step === STEP_SERVICES
      ? selectedServiceIds.length > 0
      : step === STEP_PROFESSIONAL
        ? staffMode === "any" ||
          (staffMode === "specific" &&
            eligibleStaff.some((staff) => staff.id === staffId)) ||
          (staffMode === "split" && splitSelectionValid)
        : step === STEP_TIME
          ? Boolean(selectedSlot)
          : step === STEP_DETAILS
            ? detailsCanContinue
            : true;
  const accountManageHref =
    result?.ok && result.accountLinked && result.bookingId
      ? `/my-bookings/${result.bookingId}`
      : null;
  const guestManageHref =
    result?.manageToken && typeof window !== "undefined"
      ? `${window.location.origin}/booking/manage/${result.manageToken}`
      : result?.manageToken
        ? `/booking/manage/${result.manageToken}`
        : null;
  const manageHref = accountManageHref ?? guestManageHref;
  const authReturnPath =
    data.salon && activeInspiration
      ? `/book/${data.salon.salonId}?${new URLSearchParams({
          inspiration: activeInspiration.id,
          source: data.initialSelection.source,
        }).toString()}`
      : data.salon
        ? `/book/${data.salon.salonId}`
        : "/explore";
  const signInHref = `/login?next=${encodeURIComponent(authReturnPath)}`;
  const signupHref = `/signup?next=${encodeURIComponent(authReturnPath)}`;
  const salonProfileHref = data.salon
    ? `/explore/salons/${data.salon.salonId}`
    : "/explore";

  function setCustomerField(key: keyof CustomerDraft, value: string) {
    setCustomer((current) => ({
      ...current,
      [key]: value,
    }));

    if (key !== "notes") {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  function validateCustomerDetails() {
    const nextErrors: CustomerFieldErrors = {};
    const requiresName =
      !signedIn ||
      (!nonEmpty(data.currentUser?.displayName) &&
        !nonEmpty(data.currentUser?.firstName) &&
        !nonEmpty(data.currentUser?.lastName));
    const requiresPhone = !signedIn || !nonEmpty(data.currentUser?.phone);
    const requiresEmail = !signedIn || !nonEmpty(data.currentUser?.email);

    if (requiresName && !customer.firstName.trim()) {
      nextErrors.firstName = "Enter your first name.";
    }

    if (requiresName && !customer.lastName.trim()) {
      nextErrors.lastName = "Enter your last name.";
    }

    if (requiresPhone && !phoneIsValid(customer.phone)) {
      nextErrors.phone = "Enter a valid phone number.";
    }

    if (requiresEmail && !emailIsValid(customer.email)) {
      nextErrors.email = "Enter a valid email address.";
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function openDetailsSheet(intent: "review" | "submit" = "review") {
    setDetailsSheetIntent(intent);
    setDetailsSheetOpen(true);
    setError(null);
  }

  function continueFromDetailsSheet() {
    if (!validateCustomerDetails()) {
      return;
    }

    setDetailsSheetOpen(false);
    if (!signedIn) {
      setIdentityMode("guest");
    }

    if (detailsSheetIntent === "submit") {
      submitBooking();
      return;
    }

    setStep(STEP_REVIEW);
  }

  function submitBooking() {
    if (!selectedSlot) {
      setError("Choose an available time.");
      setStep(STEP_TIME);
      return;
    }

    if (selectedServiceIds.length === 0) {
      setError("Choose a service to continue.");
      setStep(STEP_SERVICES);
      return;
    }

    if (!validateCustomerDetails()) {
      openDetailsSheet("submit");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const response = await createPublicBookingAction({
          addOnSelections: selectedAddOnSelections,
          customerEmail: customer.email,
          customerFirstName: customer.firstName,
          customerLastName: customer.lastName,
          customerPhone: customer.phone,
          honeypot,
          idempotencyKey,
          lineStaffIds,
          inspirationId:
            activeInspiration?.status === "unavailable"
              ? null
              : activeInspiration?.id ?? null,
          lookId:
            activeInspiration?.sourceType === "salon_profile_look" &&
            activeInspiration.status !== "unavailable"
              ? activeInspiration.id
              : null,
          publicNotes: customer.notes,
          salonId: data.salon?.salonId ?? "",
          serviceId: selectedServiceIds[0] ?? null,
          serviceIds: selectedServiceIds,
          source: data.initialSelection.source,
          sourceReferenceType:
            activeInspiration?.status === "unavailable"
              ? null
              : activeInspiration?.sourceType ?? null,
          staffId,
          staffMode,
          startAt: selectedSlot.startAt,
        });

        if (response.ok && response.bookingId) {
          setResult(response);
          setStep(STEP_DONE);
          setIdempotencyKey(newIdempotencyKey());
          return;
        }

        setResult(null);

        if (response.code === "unavailable_slot") {
          setSelectedSlotStart("");
          setError("That time is no longer available. Choose another time.");
          setStep(STEP_TIME);
          return;
        }

        if (
          response.code === "required_customer_details" ||
          response.code === "invalid_customer_email" ||
          response.code === "invalid_customer_phone"
        ) {
          validateCustomerDetails();
          setError(response.message);
          openDetailsSheet("submit");
          return;
        }

        setError(response.message || "We couldn't submit this booking. Try again.");
      } catch {
        setResult(null);
        setError("We couldn't submit this booking. Try again.");
      }
    });
  }

  const dateStrip = Array.from({ length: 7 }, (_, index) => {
    const base = new Date(`${date}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + index);
    const value = base.toISOString().slice(0, 10);

    return {
      label: new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
        weekday: "short",
      }).format(base),
      value,
    };
  });
  const salonLocation = [data.salon.city, data.salon.state].filter(Boolean).join(", ");
  const selectedStaffLabel =
    selectedSlot
      ? [...new Set(selectedSlot.lines.map((line) => line.staffName))].join(", ")
      : staffMode === "any"
        ? "Any professional"
        : staffMode === "split"
          ? summaryLines
              .map((line, index) => {
                const selectedLineStaffId = lineStaffIds[index];
                const staff = selectedLineStaffId
                  ? data.staff.find((member) => member.id === selectedLineStaffId)
                  : null;

                return `${line.service.name}: ${staff?.displayName ?? "Best available"}`;
              })
              .join(", ")
          : staffId
            ? data.staff.find((staff) => staff.id === staffId)?.displayName ?? "Selected"
            : "Choose professional";
  const currentBookingServiceName =
    summaryServices.length > 0
      ? summaryServices.map((service) => service.name).join(", ")
      : null;
  const currentBookingStaffName =
    selectedServiceIds.length === 0
      ? null
      : selectedSlot
        ? [...new Set(selectedSlot.lines.map((line) => line.staffName))].join(", ")
        : staffMode === "specific" && staffId
          ? data.staff.find((staff) => staff.id === staffId)?.displayName ?? null
          : null;
  const confirmationTitle =
    result?.ok && result.status === "confirmed"
      ? "Booking confirmed"
      : result?.ok
        ? "Request received"
        : "Booking not submitted";
  const isQuickBook =
    activeInspiration?.readinessState === "quick_ready" &&
    activeInspiration.status === "ready";
  const nextLabel =
    step === STEP_SERVICES && selectedServiceIds.length === 0
      ? "Choose a service to continue"
      : step === STEP_SERVICES
        ? "Next: Choose professional"
      : step === STEP_PROFESSIONAL
        ? "Next: Date & time"
        : step === STEP_TIME
          ? !detailsCanContinue && selectedSlot
            ? "Enter your details"
            : isQuickBook && signedIn && signedInDetailsComplete
            ? "Next: Review"
            : "Next: Your details"
          : step === STEP_DETAILS && !detailsCanContinue
            ? "Enter your details"
          : "Next: Review";
  const primaryActionLabel =
    step === STEP_REVIEW
      ? isPending
        ? "Submitting..."
        : error
          ? "Retry"
        : settings.confirmationMode === "instant_booking"
          ? "Confirm booking"
          : "Request appointment"
      : nextLabel;
  const primaryActionDisabled =
    step === STEP_REVIEW
      ? isPending || !selectedSlot || selectedServiceIds.length === 0
      : !canContinue && !(step === STEP_TIME && selectedSlot && !detailsCanContinue);

  const bookingFlowState = isPending
    ? "submitting"
    : result?.ok && result.bookingId
      ? "confirmed"
      : error
        ? "recoverable_error"
        : selectedServiceIds.length === 0
          ? "selection_incomplete"
          : !selectedSlot
            ? "ready_for_slot"
            : !detailsCanContinue
              ? "identity_required"
              : "ready_to_submit";

  function activatePrimaryAction() {
    if (step === STEP_REVIEW) {
      if (!detailsCanContinue) {
        openDetailsSheet("submit");
        return;
      }

      submitBooking();
      return;
    }

    if (step === STEP_TIME && selectedSlot && !detailsCanContinue) {
      openDetailsSheet("review");
      return;
    }

    if (step === STEP_TIME && detailsCanContinue) {
      setStep(STEP_REVIEW);
      return;
    }

    setStep((current) => Math.min(STEP_REVIEW, current + 1));
  }

  function removeInspiration() {
    setInspirationRemoved(true);

    if (selectedServiceIds.length === 0) {
      setStep(STEP_SERVICES);
    }
  }

  return (
    <main
      className={classNames(styles.bookingSurface, styles.publicRoot)}
      data-booking-surface="public"
      data-booking-flow-state={bookingFlowState}
      data-testid="public-booking-root"
    >
      <section className={styles.publicShell} data-testid="public-booking-shell">
        {isQuickBook ? (
          <div
            className={styles.quickBookStrip}
            data-testid="public-booking-quick-book"
          >
            Choose a time for this look
          </div>
        ) : (
        <nav
          className={styles.progress}
          aria-label="Booking progress"
          data-testid="public-booking-stepper"
        >
          {STEPS.map((label, index) => {
            const active = step === index;
            const done = step > index;

            return (
              <button
                aria-current={active ? "step" : undefined}
                className={classNames(
                  styles.progressStep,
                  active && styles.progressActive,
                  done && styles.progressDone,
                )}
                disabled={index > step || step === STEP_DONE}
                key={label}
                onClick={() => setStep(index)}
                type="button"
              >
                <span className={styles.progressCircle}>{done ? "OK" : index + 1}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
        )}

        <aside className={styles.editorialRail} data-testid="public-booking-editorial">
          <div className={styles.editorialImage}>
            {data.salon.coverUrl || data.salon.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={data.salon.coverUrl ?? data.salon.logoUrl ?? ""} />
            ) : null}
          </div>
          <p className="mt-4 text-sm leading-6 text-[#786d78]">
            {data.salon.tagline ?? "Clean tools, thoughtful care, beautiful results."}
          </p>
        </aside>

        <div className={styles.publicMain} data-testid="public-booking-content">
          {error ? (
            <p className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {activeInspiration ? (
            <BookingInspirationCard
              currentServiceName={currentBookingServiceName}
              currentStaffName={currentBookingStaffName}
              inspiration={activeInspiration}
              onChangeProfessional={
                step === STEP_PROFESSIONAL || selectedServiceIds.length === 0
                  ? undefined
                  : () => setStep(STEP_PROFESSIONAL)
              }
              onChangeService={() => setStep(STEP_SERVICES)}
              onRemove={removeInspiration}
            />
          ) : null}

          {step === STEP_SERVICES ? (
            <section>
              <div className={styles.publicHeading}>
                <p className={styles.eyebrow}>Build your visit</p>
                <h1 className={styles.publicTitle}>Choose your services</h1>
                <p className={styles.publicCopy}>
                  Select one or more services and any linked add-ons. We will only show professionals and times that can accommodate your visit.
                </p>
              </div>
              <div className={classNames(styles.pillRow, "mb-7")}>
                {categoryNames.map((name) => (
                  <button
                    className={classNames(
                      styles.pill,
                      category === name && styles.pillActive,
                    )}
                    key={name}
                    onClick={() => setCategory(name)}
                    type="button"
                  >
                    {name}
                  </button>
                ))}
                {addOnOptions.length > 0 ? (
                  <button className={styles.pill} type="button">
                    Add-ons {selectedAddOnSelections.length}
                  </button>
                ) : null}
              </div>
              <div className="grid gap-4">
                {mainServices.length === 0 ? (
                  <p className={classNames(styles.publicCard, "p-5 text-sm text-[#786d78]")}>
                    No primary services are available for online booking yet.
                  </p>
                ) : null}
                {visibleServices.map((service) => {
                  const isSelected = selectedServiceIds.includes(service.id);
                  const isBookable = (data.staffByService[service.id] ?? []).length > 0;

                  return (
                    <button
                      className={classNames(
                        styles.serviceCard,
                        isSelected && styles.serviceCardSelected,
                        !isBookable && "opacity-60",
                      )}
                      data-testid="public-booking-service-card"
                      disabled={!isBookable}
                      key={service.id}
                      onClick={() => chooseService(service.id)}
                      type="button"
                    >
                      <span className={styles.serviceIcon} aria-hidden="true">
                        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24">
                          <path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
                        </svg>
                      </span>
                      <span className="min-w-0 text-left">
                        <span className="block text-lg font-extrabold text-[#211c24]">
                          {service.name}
                        </span>
                        <span className="mt-1 block text-sm leading-6 text-[#786d78]">
                          {service.description || service.category || "Personalized salon service."}
                        </span>
                      </span>
                      <span className={styles.priceColumn}>
                        <span className="block text-xl font-extrabold text-[#211c24]">
                          {money(service.basePrice)}
                        </span>
                        <span className="mt-1 block text-sm italic text-[#642a56]">
                          {minutes(service.durationMinutes)}
                        </span>
                      </span>
                      <span
                        className={classNames(
                          styles.addButton,
                          isSelected && styles.addButtonSelected,
                        )}
                      >
                        {isSelected ? "✓" : "+ Add"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <section className={styles.addonPanel} data-testid="public-booking-addon-panel">
                <p className="text-sm font-extrabold text-[#642a56]">Make it yours</p>
                <p className="mt-1 text-sm text-[#786d78]">
                  Add linked extras for selected services.
                </p>
                {addOnOptions.length > 0 ? (
                  <div className={styles.addonGrid}>
                    {addOnOptions.map(({ parent, service }) => {
                      const selection = {
                        parentServiceId: parent.id,
                        serviceId: service.id,
                      };
                      const selected = selectedAddOnSelections.some(
                        (item) => addOnKey(item) === addOnKey(selection),
                      );

                      return (
                        <label
                          className={classNames(
                            styles.addonCard,
                            selected && styles.addonCardSelected,
                          )}
                          key={`${parent.id}:${service.id}`}
                        >
                          <span>
                            <span className="mb-1 block text-xs font-extrabold uppercase tracking-[0.08em] text-[#642a56]">
                              {parent.name}
                            </span>
                            <span className="block font-extrabold text-[#211c24]">
                              {service.name}
                            </span>
                            <span className="mt-1 block text-sm text-[#786d78]">
                              {service.description || `Adds ${minutes(service.durationMinutes)}`}
                            </span>
                          </span>
                          <span className="text-right">
                            <span className="block font-extrabold text-[#211c24]">
                              {money(service.basePrice)}
                            </span>
                            <input
                              checked={selected}
                              className={styles.checkboxInput}
                              onChange={(event) =>
                                setSelectedAddOnSelections((current) => {
                                  if (event.target.checked) {
                                    return current.some(
                                      (item) => addOnKey(item) === addOnKey(selection),
                                    )
                                      ? current
                                      : [...current, selection];
                                  }

                                  return current.filter(
                                    (item) => addOnKey(item) !== addOnKey(selection),
                                  );
                                })
                              }
                              type="checkbox"
                            />
                            <span className={styles.checkboxVisual} aria-hidden="true">
                              ✓
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            </section>
          ) : null}

          {step === STEP_PROFESSIONAL ? (
            <section>
              <div className={styles.publicHeading}>
                <p className={styles.eyebrow}>Professional</p>
                <h1 className={styles.publicTitle}>Choose your professional</h1>
                <p className={styles.publicCopy}>
                  Pick a specific professional or let the salon match you with the best available fit.
                </p>
              </div>
              <div className={styles.professionalList}>
                <div
                  aria-label="Choose professional"
                  className={styles.professionalList}
                  role="radiogroup"
                >
                  {settings.anyProfessionalEnabled ? (
                    <ProfessionalRadioOption
                      availabilityText={nextAvailabilityText({
                        hint: availabilityHints.any,
                        timezone: settings.timezoneIana,
                      })}
                      checked={staffMode === "any"}
                      className={styles.professionalOptionCompact}
                      description="We will show times with eligible staff."
                      isLoading={availabilityStatus === "loading"}
                      name="public-booking-professional"
                      onChange={() => {
                        setStaffMode("any");
                        setStaffId("");
                      }}
                      title="Any professional"
                      value="any"
                    />
                  ) : null}
                  {eligibleStaff.length === 0 ? (
                    <p className={classNames(styles.publicCard, "p-5 text-sm text-[#786d78]")}>
                      No professionals can perform every selected service yet.
                    </p>
                  ) : null}
                  <div className={styles.professionalGrid}>
                    {visibleEligibleStaff.map((staff) => (
                      <ProfessionalRadioOption
                        availabilityText={nextAvailabilityText({
                          hint: availabilityHints[staffHintKey(staff.id)],
                          timezone: settings.timezoneIana,
                        })}
                        checked={staffMode === "specific" && staff.id === staffId}
                        description={staff.jobTitle}
                        isLoading={availabilityStatus === "loading"}
                        key={staff.id}
                        name="public-booking-professional"
                        onChange={() => {
                          setStaffMode("specific");
                          setStaffId(staff.id);
                        }}
                        staff={staff}
                        title={staff.displayName}
                        value={staff.id}
                      />
                    ))}
                  </div>
                  {eligibleStaff.length > 6 ? (
                    <button
                      className={styles.professionalShowMore}
                      onClick={() => setShowAllProfessionals((current) => !current)}
                      type="button"
                    >
                      {showAllProfessionals
                        ? "Show fewer professionals"
                        : `Show ${eligibleStaff.length - visibleEligibleStaff.length} more`}
                    </button>
                  ) : null}
                </div>

                {settings.splitStaffAppointmentEnabled && summaryLines.length > 1 ? (
                  <section
                    aria-labelledby="public-booking-split-heading"
                    className={styles.professionalSplitPanel}
                  >
                    <div className={styles.professionalSplitHeader}>
                      <h2 id="public-booking-split-heading">Split by service</h2>
                      <span>Optional per service</span>
                    </div>
                    {summaryLines.map((line, index) => {
                      const selectedLineStaffId = lineStaffIds[index] ?? "";
                      const staffOptions = serviceStaffNames(data, line.service.id);
                      const groupName = `public-booking-split-${line.key}`;

                      return (
                        <fieldset
                          className={styles.professionalSplitSection}
                          key={line.key}
                        >
                          <legend>
                            <span>{line.service.name}</span>
                            {line.parentName ? (
                              <small>Add-on for {line.parentName}</small>
                            ) : null}
                          </legend>
                          <div
                            className={classNames(
                              styles.professionalGrid,
                              styles.professionalGridScroll,
                            )}
                          >
                            <ProfessionalRadioOption
                              availabilityText={nextAvailabilityText({
                                hint: availabilityHints[splitHintKey(line.key, null)],
                                timezone: settings.timezoneIana,
                              })}
                              checked={
                                staffMode === "split" && selectedLineStaffId === ""
                              }
                              className={styles.professionalOptionCompact}
                              description={`For ${line.service.name}`}
                              isLoading={availabilityStatus === "loading"}
                              name={groupName}
                              onChange={() => {
                                setStaffMode("split");
                                setLineStaffByKey((current) => {
                                  const next = { ...current };
                                  delete next[line.key];
                                  return next;
                                });
                              }}
                              title="Best available"
                              value=""
                            />
                            {staffOptions.map((staff) => (
                              <ProfessionalRadioOption
                                availabilityText={nextAvailabilityText({
                                  hint:
                                    availabilityHints[
                                      splitHintKey(line.key, staff.id)
                                    ],
                                  timezone: settings.timezoneIana,
                                })}
                                checked={
                                  staffMode === "split" &&
                                  selectedLineStaffId === staff.id
                                }
                                description={staff.jobTitle}
                                isLoading={availabilityStatus === "loading"}
                                key={staff.id}
                                name={groupName}
                                onChange={() => {
                                  setStaffMode("split");
                                  setLineStaffByKey((current) => ({
                                    ...current,
                                    [line.key]: staff.id,
                                  }));
                                }}
                                staff={staff}
                                title={staff.displayName}
                                value={staff.id}
                              />
                            ))}
                          </div>
                        </fieldset>
                      );
                    })}
                  </section>
                ) : null}
              </div>
            </section>
          ) : null}

          {step === STEP_TIME ? (
            <section>
              <div className={styles.publicHeading}>
                <p className={styles.eyebrow}>
                  {isQuickBook ? "Book this look" : "Date & time"}
                </p>
                <h1 className={styles.publicTitle}>
                  {isQuickBook ? "Choose a time" : "Find a time"}
                </h1>
                <p className={styles.publicCopy}>Times are shown in {settings.timezoneIana}.</p>
              </div>
              <div className={classNames(styles.pillRow, "mb-5")}>
                {dateStrip.map((day) => (
                  <button
                    className={classNames(
                      styles.pill,
                      date === day.value && styles.pillActive,
                    )}
                    key={day.value}
                    onClick={() => setDate(day.value)}
                    type="button"
                  >
                    {day.label}
                  </button>
                ))}
              </div>
              <label className="mb-5 block max-w-xs">
                <span className="text-sm font-extrabold text-[#211c24]">Date</span>
                <input
                  className={classNames(styles.field, "mt-2 w-full")}
                  onChange={(event) => setDate(event.target.value)}
                  type="date"
                  value={date}
                />
              </label>
              {(["Morning", "Afternoon", "Evening"] as const).map((group) => {
                const groupSlots = slots.filter((slot) => {
                  const hour = slotHour(slot, settings.timezoneIana);

                  return group === "Morning"
                    ? hour < 12
                    : group === "Afternoon"
                      ? hour >= 12 && hour < 17
                      : hour >= 17;
                });

                if (groupSlots.length === 0) {
                  return null;
                }

                return (
                  <section className="mb-5" key={group}>
                    <h2 className="mb-3 text-sm font-extrabold uppercase tracking-[0.08em] text-[#786d78]">
                      {group}
                    </h2>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {groupSlots.map((slot) => (
                        <button
                          className={classNames(
                            "min-h-12 rounded-xl border px-3 text-sm font-extrabold",
                            slot.startAt === selectedSlotStart
                              ? "border-[#642a56] bg-[#642a56] text-white"
                              : "border-[#e7dfe5] bg-white text-[#211c24] hover:border-[#d7c8d3]",
                          )}
                          data-testid="public-booking-slot"
                          key={slot.startAt}
                          onClick={() => setSelectedSlotStart(slot.startAt)}
                          type="button"
                        >
                          {slot.label}
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
              {slotsLoading && slots.length === 0 ? (
                <p className={classNames(styles.publicCard, "p-5 text-sm text-[#786d78]")}>
                  Checking available times...
                </p>
              ) : null}
              {!slotsLoading && slots.length === 0 ? (
                <p className={classNames(styles.publicCard, "p-5 text-sm text-[#786d78]")}>
                  No public slots match this selection for the selected date.
                </p>
              ) : null}
            </section>
          ) : null}

          {step === STEP_DETAILS ? (
            <section>
              <div className={styles.publicHeading}>
                <p className={styles.eyebrow}>Your details</p>
                <h1 className={styles.publicTitle}>Tell us who is coming</h1>
                <p className={styles.publicCopy}>
                  The salon will use this information for appointment updates.
                </p>
              </div>

              {signedIn ? (
                <div className="grid gap-5">
                  <div className={classNames(styles.publicCard, "grid gap-4 p-5")}>
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f7f2f7] text-base font-extrabold text-[#642a56]">
                        {data.currentUser?.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt=""
                            className="h-full w-full object-cover"
                            src={data.currentUser.avatarUrl}
                          />
                        ) : (
                          initialsFor(accountDisplayName)
                        )}
                      </div>
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-extrabold text-[#211c24]">
                          {accountDisplayName}
                        </h2>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[#786d78]">
                          {accountMaskedEmail ? <span>{accountMaskedEmail}</span> : null}
                          {accountMaskedPhone ? <span>{accountMaskedPhone}</span> : null}
                        </div>
                      </div>
                    </div>
                    <p className="rounded-xl bg-[#f7f2f7] px-4 py-3 text-sm font-extrabold text-[#642a56]">
                      This booking will be saved to your account.
                    </p>
                  </div>

                  {signedInNeedsName || signedInNeedsPhone || signedInNeedsEmail ? (
                    <div className={classNames(styles.publicCard, "grid gap-4 p-5 sm:grid-cols-2")}>
                      <div className="sm:col-span-2">
                        <h2 className="text-lg font-extrabold text-[#211c24]">
                          Add missing booking info
                        </h2>
                        <p className="mt-1 text-sm leading-6 text-[#786d78]">
                          These details are used for this appointment.
                        </p>
                      </div>
                      {signedInNeedsName ? (
                        <>
                          <label className="grid gap-2">
                            <span className="text-sm font-extrabold text-[#211c24]">
                              First name
                            </span>
                            <input
                              className={styles.field}
                              id="public-booking-first-name"
                              onChange={(event) =>
                                setCustomer((current) => ({
                                  ...current,
                                  firstName: event.target.value,
                                }))
                              }
                              type="text"
                              value={customer.firstName}
                            />
                          </label>
                          <label className="grid gap-2">
                            <span className="text-sm font-extrabold text-[#211c24]">
                              Last name
                            </span>
                            <input
                              className={styles.field}
                              id="public-booking-last-name"
                              onChange={(event) =>
                                setCustomer((current) => ({
                                  ...current,
                                  lastName: event.target.value,
                                }))
                              }
                              type="text"
                              value={customer.lastName}
                            />
                          </label>
                        </>
                      ) : null}
                      {signedInNeedsPhone ? (
                        <label className="grid gap-2">
                          <span className="text-sm font-extrabold text-[#211c24]">
                            Phone
                          </span>
                          <input
                            className={styles.field}
                            id="public-booking-phone"
                            onChange={(event) =>
                              setCustomer((current) => ({
                                ...current,
                                phone: event.target.value,
                              }))
                            }
                            type="tel"
                            value={customer.phone}
                          />
                        </label>
                      ) : null}
                      {signedInNeedsEmail ? (
                        <label className="grid gap-2">
                          <span className="text-sm font-extrabold text-[#211c24]">
                            Email
                          </span>
                          <input
                            className={styles.field}
                            id="public-booking-email"
                            onChange={(event) =>
                              setCustomer((current) => ({
                                ...current,
                                email: event.target.value,
                              }))
                            }
                            type="email"
                            value={customer.email}
                          />
                        </label>
                      ) : null}
                    </div>
                  ) : null}

                  <div className={classNames(styles.publicCard, "grid gap-4 p-5")}>
                    <label className="grid gap-2">
                      <span className="text-sm font-extrabold text-[#211c24]">
                        Notes for the salon
                      </span>
                      <textarea
                        className="min-h-20 rounded-xl border border-[#e7dfe5] px-3 py-2 text-sm outline-none focus:border-[#8f4a7b] focus:ring-4 focus:ring-[#642a56]/10"
                        onChange={(event) =>
                          setCustomer((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        value={customer.notes}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="grid gap-5">
                  <div className={classNames(styles.publicCard, "grid gap-4 p-5")}>
                    <div>
                      <h2 className="text-lg font-extrabold text-[#211c24]">
                        How would you like to continue?
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-[#786d78]">
                        Already have an account? Sign in to save and manage your
                        bookings.
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <a
                      className={classNames(styles.primaryButton, "px-4")}
                      href={signInHref}
                      onClick={storeDraftForAuth}
                    >
                      Sign in
                    </a>
                    <a
                      className={classNames(styles.secondaryButton, "px-4")}
                      href={signupHref}
                      onClick={storeDraftForAuth}
                    >
                      Create account
                    </a>
                    <button
                      className="px-1 py-2 text-left text-sm font-extrabold text-[#642a56] sm:px-3"
                      onClick={() => setIdentityMode("guest")}
                      type="button"
                    >
                      Continue as guest
                    </button>
                  </div>
                  </div>

                  {identityMode === "guest" ? (
                    <div
                      className={classNames(
                        styles.publicCard,
                        "grid gap-4 p-5 sm:grid-cols-2",
                      )}
                    >
                      <div className="sm:col-span-2">
                        <h2 className="text-lg font-extrabold text-[#211c24]">
                          Continue as guest
                        </h2>
                        <p className="mt-1 text-sm leading-6 text-[#786d78]">
                          Enter contact details for this appointment only.
                        </p>
                      </div>
                      {[
                        ["First name", "firstName"],
                        ["Last name", "lastName"],
                        ["Phone", "phone"],
                        ["Email", "email"],
                      ].map(([label, key]) => (
                        <label className="grid gap-2" key={key}>
                          <span className="text-sm font-extrabold text-[#211c24]">
                            {label}
                          </span>
                          <input
                            className={styles.field}
                            id={`public-booking-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`}
                            onChange={(event) =>
                              setCustomer((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            type={
                              key === "email"
                                ? "email"
                                : key === "phone"
                                  ? "tel"
                                  : "text"
                            }
                            value={customer[key as keyof CustomerDraft]}
                          />
                        </label>
                      ))}
                      <label className="grid gap-2 sm:col-span-2">
                        <span className="text-sm font-extrabold text-[#211c24]">
                          Notes for the salon
                        </span>
                        <textarea
                          className="min-h-20 rounded-xl border border-[#e7dfe5] px-3 py-2 text-sm outline-none focus:border-[#8f4a7b] focus:ring-4 focus:ring-[#642a56]/10"
                          onChange={(event) =>
                            setCustomer((current) => ({
                              ...current,
                              notes: event.target.value,
                            }))
                          }
                          value={customer.notes}
                        />
                      </label>
                      <div className="sm:col-span-2">
                        <button
                          className="text-sm font-extrabold text-[#642a56]"
                          onClick={() => setIdentityMode("choice")}
                          type="button"
                        >
                          Back to account options
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              <label className="hidden">
                Company
                <input
                  autoComplete="off"
                  onChange={(event) => setHoneypot(event.target.value)}
                  tabIndex={-1}
                  value={honeypot}
                />
              </label>
            </section>
          ) : null}

          {step === STEP_REVIEW ? (
            <section>
              <div className={styles.publicHeading}>
                <p className={styles.eyebrow}>Review</p>
                <h1 className={styles.publicTitle}>Review your visit</h1>
              </div>
              <div className={classNames(styles.publicCard, "grid gap-4 p-5")}>
                {activeInspiration ? (
                  <BookingInspirationSummaryRow
                    currentServiceName={currentBookingServiceName}
                    inspiration={activeInspiration}
                  />
                ) : null}
                <dl className="grid gap-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#786d78]">When</dt>
                    <dd className="font-extrabold text-[#211c24]">
                      {selectedSlot ? formatDateTime(selectedSlot.startAt, settings.timezoneIana) : "-"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#786d78]">Professional</dt>
                    <dd className="font-extrabold text-[#211c24]">{selectedStaffLabel}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#786d78]">Customer</dt>
                    <dd className="font-extrabold text-[#211c24]">
                      {signedIn
                        ? accountDisplayName
                        : `${customer.firstName} ${customer.lastName}`.trim()}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#786d78]">Confirmation</dt>
                    <dd className="font-extrabold text-[#211c24]">
                      {settings.confirmationMode === "instant_booking"
                        ? "Instant booking"
                        : "Request confirmation"}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>
          ) : null}

          {step === STEP_DONE && result?.ok && result.bookingId ? (
            <section className={classNames(styles.publicCard, "p-6")}>
              <p className={styles.eyebrow}>Confirmation</p>
              <h1 className={classNames(styles.publicTitle, "mt-3")}>{confirmationTitle}</h1>
              <p className="mt-4 text-sm leading-6 text-[#786d78]">
                {result?.message ?? "Your booking request has been processed."}
              </p>
              {activeInspiration ? (
                <div className="mt-5">
                  <BookingInspirationSummaryRow
                    currentServiceName={currentBookingServiceName}
                    inspiration={activeInspiration}
                  />
                </div>
              ) : null}
              {result?.ok && result.accountLinked ? (
                <p className="mt-4 rounded-xl bg-[#f7f2f7] px-4 py-3 text-sm font-extrabold text-[#642a56]">
                  This booking is saved to your Reylumi account.
                </p>
              ) : null}
              <div className="mt-6 flex flex-wrap gap-3">
                {manageHref ? (
                  <a className={classNames(styles.primaryButton, "px-5")} href={manageHref}>
                    {result?.accountLinked ? "Manage appointment" : "Manage this booking"}
                  </a>
                ) : null}
                {result?.ok && !result.accountLinked ? (
                  <>
                    <p className="basis-full text-sm leading-6 text-[#786d78]">
                      Already have an account? Sign in for faster future bookings.
                    </p>
                    <a
                      className={classNames(styles.secondaryButton, "px-5")}
                      href={signInHref}
                    >
                      Sign in
                    </a>
                    <a
                      className={classNames(styles.secondaryButton, "px-5")}
                      href={signupHref}
                    >
                      Create account
                    </a>
                    <a
                      className={classNames(styles.secondaryButton, "px-5")}
                      href={salonProfileHref}
                    >
                      Continue without account
                    </a>
                  </>
                ) : null}
                {data.salon.phone ? (
                  <a
                    className={classNames(styles.secondaryButton, "px-5")}
                    href={`tel:${data.salon.phone}`}
                  >
                    Contact salon
                  </a>
                ) : data.salon.email ? (
                  <a
                    className={classNames(styles.secondaryButton, "px-5")}
                    href={`mailto:${data.salon.email}`}
                  >
                    Contact salon
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          {step < STEP_REVIEW ? (
            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                className={classNames(styles.secondaryButton, "px-5")}
                disabled={step === STEP_SERVICES}
                onClick={() => setStep((current) => Math.max(STEP_SERVICES, current - 1))}
                type="button"
              >
                Back
              </button>
            </div>
          ) : null}
        </div>

        <aside
          className={classNames(styles.publicCard, styles.summary)}
          data-testid="public-booking-summary"
        >
          <div className="flex items-start gap-3">
            <div className={styles.summaryMedia}>
              {data.salon.logoUrl || data.salon.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="h-full w-full object-cover"
                  src={data.salon.logoUrl ?? data.salon.coverUrl ?? ""}
                />
              ) : (
                initialsFor(data.salon.name)
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold text-[#211c24]">Your booking</h2>
              <p className="mt-2 truncate font-extrabold text-[#211c24]">{data.salon.name}</p>
              {salonLocation ? <p className="mt-1 text-sm text-[#786d78]">{salonLocation}</p> : null}
            </div>
          </div>
          <div className={styles.summaryDivider} />
          {activeInspiration && step !== STEP_DONE ? (
            <>
              <BookingInspirationSummaryRow
                currentServiceName={currentBookingServiceName}
                inspiration={activeInspiration}
              />
              <div className={styles.summaryDivider} />
            </>
          ) : null}
          <div className="grid gap-4 text-sm">
            {summaryServices.length === 0 ? (
              <p className="text-[#786d78]">Choose a service to start.</p>
            ) : (
              summaryServices.map((service, index) => {
                const slotLine = selectedSlot?.lines[index];

                return (
                  <div
                    className="flex justify-between gap-4"
                    key={`${service.id}-${index}`}
                  >
                    <span>
                      <span className="block font-extrabold text-[#211c24]">
                        {service.name}
                      </span>
                      <span className="text-xs text-[#786d78]">
                        {minutes(slotLine?.durationMinutes ?? service.durationMinutes)}
                      </span>
                    </span>
                    <span className="font-extrabold text-[#211c24]">
                      {money(slotLine?.unitPrice ?? service.basePrice)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          {selectedSlot ? (
            <p className="mt-5 rounded-xl bg-[#f7f2f7] px-3 py-3 text-sm font-extrabold text-[#642a56]">
              {formatDateTime(selectedSlot.startAt, settings.timezoneIana)}
            </p>
          ) : null}
          <div className={styles.summaryDivider} />
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[#786d78]">Estimated duration</span>
              <span className="font-extrabold text-[#211c24]">{minutes(totalMinutes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#786d78]">Subtotal</span>
              <span className="text-2xl font-extrabold text-[#211c24]">{money(total)}</span>
            </div>
            <p className="mt-4 text-xs leading-5 text-[#786d78]">
              Lead time: {minutes(settings.minimumLeadTimeMinutes)}. Advance booking: {settings.maximumAdvanceWindowDays} days.
            </p>
          </div>
          {step < STEP_DONE ? (
            <button
              className={classNames(styles.primaryButton, styles.summaryPrimary)}
              data-testid="public-booking-primary-action"
              disabled={primaryActionDisabled}
              onClick={activatePrimaryAction}
              type="button"
            >
              {primaryActionLabel}
            </button>
          ) : null}
        </aside>
        {detailsSheetOpen ? (
          <div
            className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-0 sm:place-items-center sm:p-6"
            data-testid="public-booking-details-sheet"
            role="presentation"
          >
            <section
              aria-labelledby="public-booking-details-sheet-title"
              aria-modal="true"
              className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-2xl sm:p-6"
              role="dialog"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className={styles.eyebrow}>
                    {signedIn ? "Your details" : "Guest details"}
                  </p>
                  <h2
                    className="mt-2 text-2xl font-extrabold text-[#211c24]"
                    id="public-booking-details-sheet-title"
                  >
                    Enter your details
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#786d78]">
                    We will keep your selected service, professional, time, and
                    inspiration attached.
                  </p>
                </div>
                <button
                  aria-label="Close details"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#e7dfe5] text-lg font-extrabold text-[#642a56]"
                  onClick={() => setDetailsSheetOpen(false)}
                  type="button"
                >
                  x
                </button>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {(!signedIn || signedInNeedsName) ? (
                  <>
                    <label className="grid gap-2">
                      <span className="text-sm font-extrabold text-[#211c24]">
                        First name
                      </span>
                      <input
                        aria-invalid={Boolean(fieldErrors.firstName)}
                        className={styles.field}
                        data-testid="public-booking-guest-first-name"
                        onChange={(event) =>
                          setCustomerField("firstName", event.target.value)
                        }
                        type="text"
                        value={customer.firstName}
                      />
                      {fieldErrors.firstName ? (
                        <span
                          className="text-xs font-semibold text-red-700"
                          data-testid="public-booking-field-error"
                        >
                          {fieldErrors.firstName}
                        </span>
                      ) : null}
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-extrabold text-[#211c24]">
                        Last name
                      </span>
                      <input
                        aria-invalid={Boolean(fieldErrors.lastName)}
                        className={styles.field}
                        data-testid="public-booking-guest-last-name"
                        onChange={(event) =>
                          setCustomerField("lastName", event.target.value)
                        }
                        type="text"
                        value={customer.lastName}
                      />
                      {fieldErrors.lastName ? (
                        <span
                          className="text-xs font-semibold text-red-700"
                          data-testid="public-booking-field-error"
                        >
                          {fieldErrors.lastName}
                        </span>
                      ) : null}
                    </label>
                  </>
                ) : null}
                {(!signedIn || signedInNeedsPhone) ? (
                  <label className="grid gap-2">
                    <span className="text-sm font-extrabold text-[#211c24]">
                      Phone
                    </span>
                    <input
                      aria-invalid={Boolean(fieldErrors.phone)}
                      className={styles.field}
                      data-testid="public-booking-guest-phone"
                      onChange={(event) =>
                        setCustomerField("phone", event.target.value)
                      }
                      type="tel"
                      value={customer.phone}
                    />
                    {fieldErrors.phone ? (
                      <span
                        className="text-xs font-semibold text-red-700"
                        data-testid="public-booking-field-error"
                      >
                        {fieldErrors.phone}
                      </span>
                    ) : null}
                  </label>
                ) : null}
                {(!signedIn || signedInNeedsEmail) ? (
                  <label className="grid gap-2">
                    <span className="text-sm font-extrabold text-[#211c24]">
                      Email
                    </span>
                    <input
                      aria-invalid={Boolean(fieldErrors.email)}
                      className={styles.field}
                      data-testid="public-booking-guest-email"
                      onChange={(event) =>
                        setCustomerField("email", event.target.value)
                      }
                      type="email"
                      value={customer.email}
                    />
                    {fieldErrors.email ? (
                      <span
                        className="text-xs font-semibold text-red-700"
                        data-testid="public-booking-field-error"
                      >
                        {fieldErrors.email}
                      </span>
                    ) : null}
                  </label>
                ) : null}
                <label className="grid gap-2 sm:col-span-2">
                  <span className="text-sm font-extrabold text-[#211c24]">
                    Notes for the salon
                  </span>
                  <textarea
                    className="min-h-20 rounded-xl border border-[#e7dfe5] px-3 py-2 text-sm outline-none focus:border-[#8f4a7b] focus:ring-4 focus:ring-[#642a56]/10"
                    data-testid="public-booking-guest-notes"
                    onChange={(event) =>
                      setCustomerField("notes", event.target.value)
                    }
                    value={customer.notes}
                  />
                </label>
              </div>
              {error ? (
                <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                  {error}
                </p>
              ) : null}
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <button
                  className={classNames(styles.secondaryButton, "px-5")}
                  onClick={() => setDetailsSheetOpen(false)}
                  type="button"
                >
                  Back to booking
                </button>
                <button
                  className={classNames(styles.primaryButton, "px-5")}
                  disabled={isPending}
                  onClick={continueFromDetailsSheet}
                  type="button"
                >
                  {detailsSheetIntent === "submit"
                    ? settings.confirmationMode === "instant_booking"
                      ? "Confirm booking"
                      : "Request appointment"
                    : "Continue to review"}
                </button>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
