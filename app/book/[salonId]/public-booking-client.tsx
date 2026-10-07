"use client";
import "@/components/booking-ui/public-booking.css";

import {
  createPublicBookingAction,
} from "@/lib/public-booking-submit-client";
import { loadPublicBookingAvailabilityHintsAction, loadPublicBookingSlotsAction } from "@/lib/public-booking-availability-client";
import type {
  PublicBookingAddOnSelection,
  PublicBookingAvailabilityHint,
  PublicBookingAvailabilityScope,
  PublicBookingPageData,
  PublicBookingSlot,
  PublicBookingStaffMode,
} from "@/lib/public-booking";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { ReylumiIcon } from "@/components/reylumi-icons";
import compact from "./booking-wizard.module.css";

type PublicBookingClientProps = {
  data: PublicBookingPageData;
  embedded?: boolean;
  onClose?: () => void;
  onBusyChange?: (busy: boolean) => void;
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

const STEPS = ["Services", "Staff", "Time", "Confirm"] as const;

const styles = {
  addButton: "public-booking-add-button",
  addButtonSelected: "public-booking-add-button-selected",
  addonCard: "public-booking-addon-card",
  addonCardSelected: "public-booking-addon-card-selected",
  addonGrid: "public-booking-addon-grid",
  addonPanel: "public-booking-addon-panel",
  bookingSurface: "public-booking-surface",
  brandBar: "public-booking-brand-bar",
  brandLink: "public-booking-brand-link",
  brandLogo: "public-booking-brand-logo",
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
  mobileActionBar: "public-booking-mobile-action-bar",
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
const STEP_REVIEW = 3;
const STEP_DONE = 4;
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

function normalizeWebsite(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function displayWebsite(value: string | null | undefined) {
  return value?.replace(/^https?:\/\//i, "").replace(/\/$/, "") ?? null;
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
    try { window.sessionStorage.removeItem(key); } catch { /* Draft storage is optional. */ }
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
    return `Next: Today, ${time}`;
  }

  if (slotDate === tomorrow) {
    return `Next: Tomorrow, ${time}`;
  }

  return `Next: ${new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: input.timezone,
    weekday: "short",
  }).format(start)}, ${time}`;
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

function ReylumiExploreLink() {
  return (
    <a
      aria-label="Go to Reylumi Explore"
      className={styles.brandLink}
      data-testid="public-booking-reylumi-link"
      href="/explore"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt="Reylumi"
        className={styles.brandLogo}
        src="/brand/reylumi-logo-horizontal.png"
      />
    </a>
  );
}

function UnavailableState({ data }: { data: PublicBookingPageData }) {
  const salon = data.salon;
  const canOpenSalonProfile = Boolean(salon?.publicProfileEnabled);
  const salonProfileHref =
    salon && canOpenSalonProfile
      ? `/explore/salons/${salon.salonId}`
      : "/explore";
  const salonWebsite = normalizeWebsite(salon?.website);
  const contactHref = salon?.phone
    ? `tel:${salon.phone}`
    : salon?.email
      ? `mailto:${salon.email}`
      : salonWebsite;
  const contactLabel = salon?.phone
    ? salon.phone
    : salon?.email
      ? salon.email
      : salonWebsite
        ? displayWebsite(salon?.website)
        : null;
  const isMissingSalon = data.state === "not_found" || !salon;
  const title = isMissingSalon
    ? data.title
    : `${salon.name} is not ready for online booking yet`;
  const message = isMissingSalon
    ? data.message
    : canOpenSalonProfile
      ? "This booking page is not available yet. Please contact the salon directly, visit their profile, or return to Explore."
      : "This booking page is not available yet. Please contact the salon directly or return to Explore.";

  return (
    <main
      className={classNames(styles.bookingSurface, styles.publicRoot)}
      data-booking-surface="public"
      data-testid="public-booking-root"
    >
      <div className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-5 py-10">
        <div className="w-full">
          <ReylumiExploreLink />
          <section className={classNames(styles.publicCard, "mt-5 w-full p-6 sm:p-8")}>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              {salon?.logoUrl || salon?.coverUrl ? (
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-[#f0e6df] bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    className="h-full w-full object-cover"
                    src={salon.logoUrl ?? salon.coverUrl ?? ""}
                  />
                </div>
              ) : salon ? (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#fff0e8] text-lg font-extrabold text-[#f26f3d]">
                  {initialsFor(salon.name)}
                </div>
              ) : null}
              <div className="min-w-0">
                <p className={styles.eyebrow}>Reylumi booking</p>
                <h1 className={classNames(styles.pageTitle, "mt-3")}>{title}</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[#786d78]">
                  {message}
                </p>
                {contactLabel ? (
                  <p className="mt-4 text-sm font-semibold text-[#211c24]">
                    Contact:{" "}
                    <a
                      className="text-[#e85f2b] underline-offset-4 hover:underline"
                      href={contactHref ?? undefined}
                    >
                      {contactLabel}
                    </a>
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              {canOpenSalonProfile ? (
                <a
                  className={classNames(styles.secondaryButton, "px-5")}
                  href={salonProfileHref}
                >
                  View salon profile
                </a>
              ) : null}
              <a
                className={classNames(styles.secondaryButton, "px-5")}
                href="/explore"
              >
                Back to Explore
              </a>
              {contactHref ? (
                <a
                  className={classNames(styles.primaryButton, "px-5")}
                  href={contactHref}
                >
                  Contact salon
                </a>
              ) : null}
            </div>
          </section>
        </div>
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

export function PublicBookingClient({ data, embedded = false, onClose, onBusyChange }: PublicBookingClientProps) {
  const router = useRouter();
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
      : hasInitialInspiration || data.initialSelection.staffId
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
  const initialCustomerName = splitDisplayName(
    data.currentUser?.displayName ??
      [data.currentUser?.firstName, data.currentUser?.lastName]
        .filter(Boolean)
        .join(" "),
  );

  const [step, setStep] = useState(
    Math.min(STEP_REVIEW, Math.max(STEP_SERVICES, data.initialSelection.initialStep)),
  );
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [editDetails, setEditDetails] = useState(false);
  const [accountSessionChanged, setAccountSessionChanged] = useState(false);
  const [keepInitialStaff, setKeepInitialStaff] = useState(true);
  const [optionsServiceId, setOptionsServiceId] = useState<string | null>(null);
  const optionsDialog = useRef<HTMLDialogElement>(null);
  const timesRail = useRef<HTMLDivElement>(null);
  const timeDrag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  useEffect(() => {
    if (!optionsServiceId) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    optionsDialog.current?.showModal();
    return () => { document.body.style.overflow = previous; };
  }, [optionsServiceId]);
  useEffect(() => {
    if (step === STEP_DONE) {
      document.getElementById("public-booking-confirmation-title")?.focus();
    }
  }, [step]);
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
  const [selectedSlotStart, setSelectedSlotStart] = useState(data.initialSelection.startAt ?? data.slots[0]?.startAt ?? "");
  const [availabilityResult, setAvailabilityResult] = useState<{
    hints: AvailabilityHintMap;
    signature: string;
  }>({
    hints: {},
    signature: "",
  });
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
  const [fieldErrors, setFieldErrors] = useState<CustomerFieldErrors>({});
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [inspirationRemoved, setInspirationRemoved] = useState(false);
  const [error, setError] = useState<string | null>(data.initialSelection.requestedTimeUnavailable ? "That time is no longer available. Choose another time." : null);
  const [isPending, startTransition] = useTransition();
  useEffect(() => { onBusyChange?.(isPending); }, [isPending, onBusyChange]);
  const hintCache = useRef(new Map<string, { expires: number; controller?:AbortController; settled?:boolean; promise: Promise<PublicBookingAvailabilityHint[]> }>());
  const initialSlotsLoaded = useRef(false);
  const slotCache = useRef(new Map<string, { expires: number; controller?:AbortController; settled?:boolean; promise: Promise<PublicBookingSlot[]> }>());
  const manualDate = useRef(Boolean(data.initialSelection.dateExplicit || data.initialSelection.startAt));
  const searchedSelection = useRef("");
  const [availabilityError, setAvailabilityError] = useState(false);
  const [slotError, setSlotError] = useState(false);
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
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
          .filter((service) => !selectedServiceIds.includes(service.id))
          .map((service) => ({ parent, service })),
      ),
    [data.services, selectedServiceIds, selectedServices],
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
    (slotResult.signature !== slotRequestSignature && !slotError);
  const eligibleStaff = useMemo(
    () => staffEligibleForServices(data, summaryServices.map((service) => service.id)),
    [data, summaryServices],
  );
  const selectedSlot = slots.find((slot) => slot.startAt === selectedSlotStart) ?? null;
  const professionalOnlyStaffId =
    activeInspiration?.readinessState === "professional_ready" &&
    selectedServiceIds.length === 0
      ? staffId
      : "";
  const visibleServices = mainServices
    .filter((service) => category === "All" || (service.category ?? "Services") === category)
    .filter(service => `${service.name} ${service.description ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
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
          (!selectedLineStaffId && settings.anyProfessionalEnabled) ||
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
    () => JSON.stringify({ scopes: availabilityScopes, serviceIds: selectedServiceIds, addOnSelections: selectedAddOnSelections }),
    [availabilityScopes, selectedServiceIds, selectedAddOnSelections],
  );
  const availabilityHints =
    availabilityResult.signature === availabilityScopeSignature
      ? availabilityResult.hints
      : {};
  const availabilityStatus =
    availabilityScopes.length === 0
      ? "idle"
      : availabilityResult.signature !== availabilityScopeSignature
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
        nextSelectedServiceIds.includes(selection.parentServiceId) &&
        !nextSelectedServiceIds.includes(selection.serviceId),
      ),
    );
    setSelectedSlotStart("");
    setError(null);

    // Keep the selected professional per service before switching to split staff.
    const preferredStaffId = staffMode === "specific" ? staffId : null;
    if (preferredStaffId) {
      setLineStaffByKey(current => ({ ...current, ...Object.fromEntries(
        nextSelectedServiceIds
          .filter(id => (data.staffByService[id] ?? []).includes(preferredStaffId))
          .map(id => [`service:${id}`, current[`service:${id}`] || preferredStaffId]),
      ) }));
    }

    if (nextSelectedServiceIds.length === 0) {
      if (data.initialSelection.staffId) return;
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
      return false;
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

    try {
      window.sessionStorage.setItem(key, JSON.stringify(draft));
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (embedded || data.state !== "ready" || !data.salon) {
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
          !validServiceIdSet.has(selection.serviceId) &&
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
      manualDate.current = true;
      setDate(draft.date);
      setSelectedSlotStart(draft.selectedSlotStart);
      setInspirationRemoved(
        (draft.inspirationId ?? null) ===
          (data.initialSelection.inspiration?.id ?? null) &&
          draft.inspirationRemoved === true,
      );
      setCustomer((current) => ({
        email: nonEmpty(data.currentUser?.email) ?? draft.customer.email ?? current.email,
        firstName:
          nonEmpty(data.currentUser?.firstName) ??
          nonEmpty(initialCustomerName.firstName) ??
          draft.customer.firstName ??
          current.firstName,
        lastName:
          nonEmpty(data.currentUser?.lastName) ??
          nonEmpty(initialCustomerName.lastName) ??
          draft.customer.lastName ??
          current.lastName,
        notes: draft.customer.notes ?? current.notes,
        phone: nonEmpty(data.currentUser?.phone) ?? draft.customer.phone ?? current.phone,
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
    embedded,
  ]);

  useEffect(() => {
    if (data.state !== "ready" || !data.salon || availabilityScopes.length === 0 || (embedded && step >= STEP_TIME)) return;
    let active = true;
    let ownedController:AbortController|undefined;
    const signature = availabilityScopeSignature;
    const timer = setTimeout(async () => {
      setAvailabilityError(false);
      let entry = hintCache.current.get(signature);
      if (!entry || entry.expires < Date.now()) {
        if (hintCache.current.size >= 24) hintCache.current.delete(hintCache.current.keys().next().value!);
        ownedController=new AbortController();
        entry = { expires: Date.now() + 30000, controller:ownedController, promise: loadPublicBookingAvailabilityHintsAction({ salonId: data.salon!.salonId, scopes: availabilityScopes, selection: { addOnSelections: selectedAddOnSelections, serviceId: selectedServiceIds[0] ?? null, serviceIds: selectedServiceIds } },ownedController.signal) };
        hintCache.current.set(signature, entry);
      }
      try {
        const hints = await entry.promise;
        entry.settled=true;
        if (active) setAvailabilityResult({ hints: Object.fromEntries(hints.map(hint => [hint.key, hint])), signature });
      } catch { if(hintCache.current.get(signature)===entry)hintCache.current.delete(signature); if (active) setAvailabilityError(true); }
    }, hintCache.current.has(signature) ? 0 : 180);
    return () => {
      active = false; clearTimeout(timer);
      const entry=hintCache.current.get(signature);
      if(ownedController && entry?.controller===ownedController && !entry.settled){
        ownedController.abort();hintCache.current.delete(signature);
      }
    };
  }, [availabilityScopeSignature, availabilityScopes, data.salon, data.state, selectedAddOnSelections, selectedServiceIds, availabilityRetry, embedded, step]);

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

  const slotReadDelay = step >= STEP_TIME ? 0 : 120;
  useEffect(() => {
    if (data.state !== "ready" || selectedServiceIds.length === 0) return;
    let active = true;
    let ownedController:AbortController|undefined;
    const signature = slotRequestSignature;
    const selectionSignature = JSON.stringify({ selectedServiceIds, selectedAddOnSelections, lineStaffIds, staffId, staffMode });
    const findEarliest = !manualDate.current && searchedSelection.current !== selectionSignature;
    if (!initialSlotsLoaded.current) {
      initialSlotsLoaded.current = true;
      if ((data.availabilityResolved || data.slots.length > 0) && data.initialSelection.staffMode !== "split") slotCache.current.set(signature, { expires: Date.now() + 30000, promise: Promise.resolve(data.slots) });
    }
    const timer = setTimeout(async () => {
      setSlotError(false);
      let entry = slotCache.current.get(signature);
      if (!entry || entry.expires < Date.now()) {
        if (slotCache.current.size >= 32) slotCache.current.delete(slotCache.current.keys().next().value!);
        ownedController=new AbortController();
        entry = { expires: Date.now() + 30000, controller:ownedController, promise: loadPublicBookingSlotsAction({ salonId: data.salon?.salonId ?? "", selection: { findEarliest, addOnSelections: selectedAddOnSelections, date, lineStaffIds, serviceId: selectedServiceIds[0] ?? null, serviceIds: selectedServiceIds, staffId, staffMode } },ownedController.signal) };
        slotCache.current.set(signature, entry);
      }
      try {
        const nextSlots = await entry.promise;
        entry.settled=true;
        if (!active) return;
        searchedSelection.current = selectionSignature;
        const nextDate = findEarliest && nextSlots[0] && settings ? zonedDateKey(new Date(nextSlots[0].startAt), settings.timezoneIana) : date;
        const nextSignature = nextDate === date ? signature : JSON.stringify({ ...JSON.parse(signature), date: nextDate });
        if (nextDate !== date) {
          slotCache.current.set(nextSignature, { expires: Date.now() + 30000, promise: Promise.resolve(nextSlots) });
          setDate(nextDate);
        }
        setSlotResult({ signature: nextSignature, slots: nextSlots });
        setSelectedSlotStart(current => nextSlots.some(slot => slot.startAt === current) ? current : nextSlots[0]?.startAt ?? "");
      } catch { if(slotCache.current.get(signature)===entry)slotCache.current.delete(signature); if (active) setSlotError(true); }
    }, slotCache.current.has(signature) ? 0 : slotReadDelay);
    return () => {
      active = false; clearTimeout(timer);
      const entry=slotCache.current.get(signature);
      if(ownedController && entry?.controller===ownedController && !entry.settled){
        ownedController.abort();slotCache.current.delete(signature);
      }
    };
  }, [data.salon?.salonId, data.state, data.slots, data.availabilityResolved, data.initialSelection.staffMode, date, lineStaffIds, selectedAddOnSelections, selectedServiceIds, slotRequestSignature, staffId, staffMode, availabilityRetry, settings, slotReadDelay]);

  if (data.state !== "ready" || !settings || !data.salon) {
    if (embedded) return <div className={compact.unavailable}><button className={compact.icon} onClick={onClose} aria-label="Close booking">&times;</button><h2>{data.title}</h2><p className={compact.muted}>{data.message}</p></div>;
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
        ? (staffMode === "any" && settings?.anyProfessionalEnabled) ||
          (staffMode === "specific" &&
            eligibleStaff.some((staff) => staff.id === staffId)) ||
          (staffMode === "split" && splitSelectionValid)
        : step === STEP_TIME
          ? Boolean(selectedSlot)
          : true;
  const accountManageHref =
    result?.ok && result.accountLinked && result.bookingId
      ? "/my-bookings"
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
      setStep(STEP_REVIEW);
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const response = await createPublicBookingAction({
          expectedAccountId: data.currentUser?.id ?? null,
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
          if (response.accountLinked && !embedded) {
            setResult(response);
            setStep(STEP_DONE);
            router.replace(`/my-bookings?created=${encodeURIComponent(response.bookingId)}&message=Booking%20created%20successfully.`);
            return;
          }
          setResult(response);
          setStep(STEP_DONE);
          setIdempotencyKey(newIdempotencyKey());
          return;
        }

        setResult(null);

        if (response.code === "account_session_changed") {
          const draftSaved = storeDraftForAuth();
          setAccountSessionChanged(true);
          setError(draftSaved ? response.message : "Please sign in again to confirm this booking. You may need to choose your services and time again.");
          setStep(STEP_REVIEW);
          return;
        }

        if (response.code === "unavailable_slot") {
          slotCache.current.delete(slotRequestSignature);
          hintCache.current.clear();
          setSlotResult({ signature: "", slots: [] });
          setAvailabilityRetry(value => value + 1);
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
          setEditDetails(true);
          validateCustomerDetails();
          setError(response.message);
          setStep(STEP_REVIEW);
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
  const bookingConfirmed = result?.confirmationStatus
    ? result.confirmationStatus === "confirmed"
    : result?.status === "confirmed";
  const confirmationTitle =
    result?.ok && bookingConfirmed
      ? "Booking confirmed"
      : result?.ok
        ? "Request received"
        : "Booking not submitted";
  const primaryActionLabel = step === STEP_REVIEW
    ? isPending ? "Submitting..." : settings.confirmationMode === "instant_booking" ? "Confirm booking" : "Request appointment"
    : embedded ? "Continue" : ["Next: Choose staff", "Next: Choose time", "Next: Review & confirm"][step];
  const primaryActionDisabled = isPending || (step === STEP_REVIEW ? accountSessionChanged || !selectedSlot || (!signedIn && !settings.guestBookingEnabled) : !canContinue);

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
    if (step === STEP_PROFESSIONAL) {
      // Use only a hint for the exact current selection, including split staff.
      const scope = availabilityScopes.find((candidate) =>
        candidate.staffMode === staffMode &&
        (staffMode === "specific" ? candidate.staffId === staffId :
          staffMode === "split" ? JSON.stringify(candidate.lineStaffIds) === JSON.stringify(lineStaffIds) : true),
      );
      const nextStartAt = scope ? availabilityHints[scope.key]?.startAt : null;
      if (nextStartAt && settings) {
        const nextStart = new Date(nextStartAt);
        if (!Number.isNaN(nextStart.getTime())) {
          setDate(zonedDateKey(nextStart, settings.timezoneIana));
          setSelectedSlotStart(nextStartAt);
        }
      }
      setStep(STEP_TIME);
      return;
    }

    if (step === STEP_REVIEW) { submitBooking(); return; }
    if (step === STEP_TIME) { setStep(STEP_REVIEW); return; }
    if (step === STEP_SERVICES && staffMode === "specific" && staffId && summaryLines.every(line => serviceStaffNames(data, line.service.id).some(staff => staff.id === staffId))) { setStep(STEP_TIME); return; }
    if (step === STEP_SERVICES && settings?.splitStaffAppointmentEnabled && summaryLines.length > 1) {
      const preferredStaffId = (staffMode === "specific" ? staffId : null) || data.initialSelection.staffId;
      setLineStaffByKey(current => Object.fromEntries(summaryLines.map(line => {
        const eligible = serviceStaffNames(data, line.service.id);
        const previous = current[line.key];
        return [line.key, previous && eligible.some(staff => staff.id === previous) ? previous : preferredStaffId && eligible.some(staff => staff.id === preferredStaffId) ? preferredStaffId : ""];
      })));
      setStaffMode("split");
    }
    setStep(current => Math.min(STEP_REVIEW, current + 1));
  }

  function removeInspiration() {
    setInspirationRemoved(true);

    if (selectedServiceIds.length === 0) {
      setStep(STEP_SERVICES);
    }
  }

  const splitStaff = settings.splitStaffAppointmentEnabled && summaryLines.length > 1;
  const staffGroups = splitStaff ? summaryLines : [{ key: "all", service: { name: summaryServices.map(service => service.name).join(" + "), durationMinutes: totalMinutes } }];
  const optionsParent = selectedServices.find(service => service.id === optionsServiceId);
  const chooseStaff = (lineKey: string, value: string) => {
    setSelectedSlotStart("");
    setError(null);
    if (splitStaff) {
      setStaffMode("split");
      setLineStaffByKey(current => ({ ...current, [lineKey]: value }));
    } else { setStaffMode(value ? "specific" : "any"); setStaffId(value); }
  };
  const goBack = () => { setError(null); setStep(current => Math.max(STEP_SERVICES, current - 1)); };
  const isReview = step === STEP_REVIEW || (embedded && step === STEP_DONE);
  const selectedServiceNames = summaryLines.map(line => line.service.name).join(" + ");
  const addMoreButton = <button type="button" className={compact.textLink} disabled={isPending} onClick={() => { setKeepInitialStaff(false); setCategory("All"); setSearch(""); setError(null); setStep(STEP_SERVICES); }}>+ Add more</button>;

  return <main className={`${compact.root} ${embedded ? compact.embedded : ""}`} data-booking-surface="public" data-booking-complete={step === STEP_DONE ? "true" : undefined} data-booking-flow-state={bookingFlowState} data-testid="public-booking-root">
    <section className={compact.shell} data-testid="public-booking-shell">
      {embedded ? <header className={compact.quickHeader}><strong>{step === STEP_SERVICES ? "Choose services" : step === STEP_PROFESSIONAL ? "Choose staff" : step === STEP_TIME ? "Choose a time" : step === STEP_REVIEW ? "Confirm booking" : confirmationTitle}</strong><button className={compact.icon} onClick={onClose} aria-label="Close booking" type="button">&times;</button></header> : <header className={compact.header}>
        {step > STEP_SERVICES && step < STEP_DONE ? <button className={compact.icon} type="button" aria-label="Back to previous step" onClick={goBack}>&larr;</button> : <a className={compact.icon} aria-label="Back to Explore" href="/explore">&larr;</a>}
        <div className={compact.salon}>{data.salon.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={compact.logo} src={data.salon.logoUrl} alt="" />
        ) : null}<span>{data.salon.name}</span></div>
        <a className={compact.icon} href="/explore" aria-label="Close booking">&times;</a>
      </header>}
      {!embedded && step < STEP_DONE ? <nav className={compact.progress} aria-label="Booking progress" data-testid="public-booking-stepper">
        {STEPS.map((label, index) => <span key={label} className="inline-flex items-center gap-3"><button aria-current={step === index ? "step" : undefined} disabled={index > step || isPending} onClick={() => setStep(index)} type="button">{label}</button>{index < STEPS.length - 1 ? <span aria-hidden="true">&rsaquo;</span> : null}</span>)}
      </nav> : null}
      <div className={compact.content} data-testid="public-booking-content">
        {error ? <div className={compact.error} role="alert"><p>{error}</p>{accountSessionChanged ? <a className={`${compact.textLink} mt-1 inline-block text-sm font-medium underline underline-offset-2`} href={signInHref} onClick={storeDraftForAuth}>sign in</a> : null}</div> : null}
        {!error && activeInspiration?.message && (activeInspiration.status === "service_unavailable" || activeInspiration.status === "staff_unavailable") ? <p className={compact.error} role="status">{activeInspiration.message}</p> : null}
        {step === STEP_SERVICES ? <section>
          <h1>Choose services</h1>{embedded ? <p className={`${compact.muted} mb-3`}>{keepInitialStaff && data.initialSelection.staffId ? `With ${data.staff.find(staff => staff.id === data.initialSelection.staffId)?.displayName ?? "your selected staff"} \u00b7 ` : ""}{data.salon.name}</p> : null}
          <input className={compact.field} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search services..." aria-label="Search services" type="search" />
          <div className={compact.tabs} aria-label="Service categories">{["All", ...categoryNames.filter(name => name !== "All")].map(name => <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>
          <div className={compact.list}>{visibleServices.map(service => {
            const selected = selectedServiceIds.includes(service.id);
            const options = service.addOnIds.filter(id => data.services.some(item => item.id === id && !selectedServiceIds.includes(id)));
            const extras = selectedAddOnSelections.filter(item => item.parentServiceId === service.id).length;
            return <div className={compact.service} key={service.id}>
              <label><span><strong>{service.name}</strong><small className={compact.muted}>{service.description || service.category}{service.description || service.category ? " \u00b7 " : ""}{minutes(service.durationMinutes)}</small></span><span className="font-semibold">{money(service.basePrice)}</span><input aria-label={service.name} className={compact.check} type="checkbox" checked={selected} onChange={() => { chooseService(service.id); if (!selected && options.length > 0) setOptionsServiceId(service.id); }} /></label>
              {selected && options.length > 0 ? <button className={compact.textLink} type="button" onClick={() => setOptionsServiceId(service.id)}>Options{extras ? ` \u00b7 ${extras} selected` : ""} &rsaquo;</button> : null}
            </div>;
          })}</div>
          {visibleServices.length === 0 ? <p className={compact.muted}>No matching services.</p> : null}
        </section> : null}
        {step === STEP_PROFESSIONAL ? <section><h1>Choose staff</h1>{embedded ? <p className={compact.muted}>{data.salon.name}</p> : null}
          {staffGroups.map(line => {
            const options = splitStaff ? serviceStaffNames(data, (line as SummaryLine).service.id) : eligibleStaff;
            const value = splitStaff ? staffMode === "specific" ? staffId : lineStaffByKey[line.key] ?? "" : staffMode === "specific" ? staffId : "";
            const hintKey = (id: string) => splitStaff ? splitHintKey(line.key, id || null) : id ? staffHintKey(id) : "any";
            return <fieldset className={compact.staffGroup} key={line.key}><legend>{line.service.name} <span className={compact.muted}>&middot; {minutes(line.service.durationMinutes)}</span></legend>
              {[...(settings.anyProfessionalEnabled ? [{ id: "", displayName: "Any available", avatarUrl: null }] : []), ...options].map(staff => <label className={compact.staff} key={staff.id || "any"}>
                {staff.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={compact.avatar} src={staff.avatarUrl} alt="" />
                ) : <span className={compact.avatar}>{staff.id ? initialsFor(staff.displayName) : "AA"}</span>}
                <span className={compact.staffMeta}><strong>{staff.displayName}</strong><small>{availabilityStatus === "loading" ? "Checking times..." : availabilityError ? "Choose a time next" : nextAvailabilityText({ hint: availabilityHints[hintKey(staff.id)], timezone: settings.timezoneIana })}</small></span>
                <input className={compact.check} type="radio" name={`staff-${line.key}`} aria-label={`${line.service.name}: ${staff.displayName}`} checked={value === staff.id && (staffMode !== "specific" || Boolean(staffId))} onChange={() => chooseStaff(line.key, staff.id)} />
              </label>)}
              {options.length === 0 ? <p className={compact.muted}>No eligible staff for this selection.</p> : null}
            </fieldset>;
          })}
          <p className={`${compact.muted} mt-4`}>Times shown are suggestions. Choose a start time next.</p>
        </section> : null}
        {step === STEP_TIME ? <section><h1>Choose start time</h1>{embedded ? <div className={compact.quickSelection}>{activeInspiration?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={activeInspiration.imageUrl} alt="" />) : null}<div><div className={compact.selectionTitle}><strong>{selectedServiceNames}</strong>{addMoreButton}</div><p className={compact.muted}>{data.staff.find(staff => staff.id === staffId)?.displayName ?? "Any available"} &middot; {data.salon.name}</p><p className={compact.muted}>{minutes(totalMinutes)} &middot; Est. {money(total)}</p></div></div> : null}
          <div className={compact.dates} aria-label="Choose a date">{dateStrip.map(day => <button key={day.value} type="button" aria-label={day.label} aria-pressed={day.value === date} onClick={() => { manualDate.current = true; setSelectedSlotStart(""); setDate(day.value); }}><span>{embedded && day.value === zonedDateKey(new Date(), settings.timezoneIana) ? "Today" : embedded && day.value === addDaysKey(zonedDateKey(new Date(), settings.timezoneIana), 1) ? "Tomorrow" : day.label.split(",")[0].split(" ")[0]}</span><strong>{embedded ? new Intl.DateTimeFormat("en-US", {month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(`${day.value}T12:00:00Z`)) : Number(day.value.slice(-2))}</strong></button>)}</div>
          <div className="flex items-center justify-between gap-3"><label className={compact.textLink}>Choose date<input className="max-w-[9rem] text-xs text-text-secondary" type="date" aria-label="Choose another date" value={date} min={zonedDateKey(new Date(), settings.timezoneIana)} max={addDaysKey(zonedDateKey(new Date(), settings.timezoneIana), settings.maximumAdvanceWindowDays)} onChange={event => { if (event.target.value) { manualDate.current = true; setSelectedSlotStart(""); setDate(event.target.value); } }} /></label></div>
          <div className={compact.timePicker}>
            <button className={compact.icon} aria-label="Earlier times" type="button" onClick={() => timesRail.current?.scrollBy({ left: -240, behavior: "smooth" })}>&lsaquo;</button>
            <div className={compact.times} ref={timesRail}
              onPointerDown={event => { if (event.pointerType === "mouse") timeDrag.current = { x: event.clientX, left: event.currentTarget.scrollLeft, moved: false }; }}
              onPointerMove={event => { const drag = timeDrag.current; if (!drag || event.buttons !== 1) return; const delta = event.clientX - drag.x; if (Math.abs(delta) > 8) { drag.moved = true; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.scrollLeft = drag.left - delta; } }}
              onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (!timeDrag.current?.moved) timeDrag.current = null; }}
              onPointerCancel={() => { timeDrag.current = null; }}
              onClickCapture={event => { if (timeDrag.current?.moved) { event.preventDefault(); event.stopPropagation(); } timeDrag.current = null; }} role="group" aria-label="Available start times">{slots.map(slot => <button key={slot.startAt} data-testid="public-booking-slot" type="button" aria-pressed={slot.startAt === selectedSlotStart} onClick={() => setSelectedSlotStart(slot.startAt)}>{slot.label}</button>)}</div>
            <button className={compact.icon} aria-label="Later times" type="button" onClick={() => timesRail.current?.scrollBy({ left: 240, behavior: "smooth" })}>&rsaquo;</button>
          </div>
          {slotsLoading ? <p role="status" className={compact.muted}>Checking available times...</p> : slotError ? <p role="alert" className={compact.error}>Times could not be loaded. <button className={compact.textLink} type="button" onClick={() => setAvailabilityRetry(value => value + 1)}>Try again</button></p> : slots.length === 0 ? <p className={compact.muted}>No available times for this selection.</p> : <p className={compact.muted}>Available slots follow salon hours.</p>}
          {selectedSlot ? <div className={compact.selectedTime}><div><strong>{formatTime(selectedSlot.startAt, settings.timezoneIana)}&ndash;{formatTime(selectedSlot.endAt, settings.timezoneIana)}</strong><p className={compact.muted}>{[...new Set(selectedSlot.lines.map(line => line.staffName))].join(" + ")}</p></div><span className={compact.muted}>{minutes(totalMinutes)} &middot; {slotHour(selectedSlot, settings.timezoneIana) < 12 ? "Morning" : "Afternoon"}</span></div> : null}
        </section> : null}
        {isReview ? <section><h1>Review &amp; confirm</h1>
          <div className={compact.receipt}>
            <div className={compact.receiptHeader}>{embedded ? <ReylumiIcon className="h-5 w-5 shrink-0" name="calendar" /> : null}<div><strong>{selectedSlot ? formatDateTime(selectedSlot.startAt, settings.timezoneIana) : "Choose a time"}{selectedSlot ? `\u2013${formatTime(selectedSlot.endAt, settings.timezoneIana)}` : ""}</strong><p className={compact.muted}>{data.salon.name} &middot; {salonLocation}</p></div></div>
            {embedded && step < STEP_DONE ? <div className={compact.selectionTitle}><strong>Services</strong>{addMoreButton}</div> : null}
            {summaryLines.map((line,index) => <div className={compact.receiptRow} key={line.key}><div><strong>{line.service.name}</strong><p className={compact.muted}>{selectedSlot?.lines[index]?.staffName ?? "Any available"} &middot; {minutes(selectedSlot?.lines[index]?.durationMinutes ?? line.service.durationMinutes)}{line.parentName ? ` \u00b7 Add-on for ${line.parentName}` : ""}</p></div><strong>{money(selectedSlot?.lines[index]?.unitPrice ?? line.service.basePrice)}</strong></div>)}
          {activeInspiration ? <details className={compact.notes}><summary>{embedded ? "Inspiration (optional)" : "Booked look & notes"}</summary><div className="flex gap-3">{activeInspiration.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="h-20 w-20 rounded-lg object-cover" src={activeInspiration.imageUrl} alt="Booked look" />
          ) : null}<div><strong>{activeInspiration.title}</strong><p className={compact.muted}>{activeInspiration.caption ?? activeInspiration.message}</p><button type="button" className={compact.textLink} onClick={removeInspiration}>Remove look</button></div></div></details> : null}
            <div className={compact.total}><div>Estimated total<p className={compact.muted}>{minutes(totalMinutes)}</p></div><span>{money(total)}</span></div>
          </div>
          {signedIn && embedded ? <div className={compact.auth}>{data.currentUser?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={compact.avatar} src={data.currentUser.avatarUrl} alt="" />) : <span className={compact.avatar}>{initialsFor(accountDisplayName)}</span>}<span className="flex-1"><strong>{accountDisplayName}</strong><small>Contact details saved</small></span><button type="button" className={compact.textLink} onClick={() => setEditDetails(value => !value)}>{editDetails ? "Done" : "Edit"}</button></div> : signedIn ? <div className={compact.auth}><span><strong>{accountDisplayName}</strong><span className="block text-xs">{[accountMaskedEmail, accountMaskedPhone].filter(Boolean).join(" \u00b7 ")}</span></span><span>Saved to your account</span></div> : <a className={compact.auth} href={signInHref} onClick={storeDraftForAuth}><strong>Sign in to autofill</strong><span>&rsaquo;</span></a>}
          {!signedIn && !settings.guestBookingEnabled ? <p className={compact.muted}>Sign in to book this salon. <a className={compact.textLink} href={signupHref} onClick={storeDraftForAuth}>Create an account</a></p> : <>
            {step !== STEP_DONE && (editDetails || !signedIn || signedInNeedsName || signedInNeedsPhone || signedInNeedsEmail) ? <div className="mt-3 flex justify-between text-xs"><strong>Your details</strong><span className={compact.muted}>Required *</span></div> : null}
            <div className={compact.fields}>{(["firstName", "lastName", "phone", "email"] as const).filter(key => editDetails || !signedIn || (key === "firstName" || key === "lastName" ? signedInNeedsName : key === "phone" ? signedInNeedsPhone : signedInNeedsEmail)).map(key => <label key={key}><span>{{ firstName: "First name", lastName: "Last name", phone: "Phone", email: "Email" }[key]} <span className="text-red-600">*</span></span><input id={`public-booking-${key}`} className={compact.field} autoComplete={{firstName:"given-name",lastName:"family-name",phone:"tel",email:"email"}[key]} type={key === "phone" ? "tel" : key === "email" ? "email" : "text"} value={customer[key]} required aria-invalid={Boolean(fieldErrors[key])} aria-describedby={fieldErrors[key] ? `error-${key}` : undefined} onChange={event => { setCustomerField(key,event.target.value); if (!signedIn) setIdentityMode("guest"); }} />{fieldErrors[key] ? <span id={`error-${key}`} className={compact.error}>{fieldErrors[key]}</span> : null}</label>)}</div>
            <details className={compact.notes}><summary>Add a note (optional)</summary><textarea className={compact.field} aria-label="Appointment note" value={customer.notes} onChange={event => setCustomerField("notes", event.target.value)} /></details>
          </>}
          <input aria-hidden="true" tabIndex={-1} className="hidden" autoComplete="off" value={honeypot} onChange={event => setHoneypot(event.target.value)} />
          <p className={`${compact.muted} mt-3`}>{embedded ? "No online payment required." : "Estimate only. The salon records the final amount."}</p>
        </section> : null}
        {step === STEP_DONE && !embedded && result?.ok ? <section><h1 id="public-booking-confirmation-title" tabIndex={-1}>{confirmationTitle}</h1><p className={compact.muted}>{result.message}</p><div className={`${compact.receipt} mt-4`}><strong>{data.salon.name}</strong><p>{selectedSlot ? formatDateTime(selectedSlot.startAt, settings.timezoneIana) : ""}</p><p className={compact.muted}>{summaryServices.map(service => service.name).join(" / ")}</p></div>{embedded && result.accountLinked ? <a className={`${compact.primary} mt-4`} href={`/my-bookings?details=${encodeURIComponent(result.bookingId ?? "")}`}>View booking</a> : manageHref ? <a className={`${compact.primary} mt-4`} href={manageHref}>Manage booking</a> : null}{embedded ? <button type="button" className={compact.textLink} onClick={onClose}>Continue exploring</button> : null}{!result.accountLinked ? <p className={`${compact.muted} mt-2`}>Save your secure manage link to change this appointment.</p> : null}</section> : null}
      </div>
      {embedded && step === STEP_DONE && result?.ok ? <div className={compact.success} role="status"><ReylumiIcon name={bookingConfirmed ? "check" : "calendar"} className="h-4 w-4 shrink-0" /><span>{bookingConfirmed ? "Your appointment is confirmed." : "Awaiting salon confirmation."}</span><a href={result.accountLinked ? `/my-bookings?details=${encodeURIComponent(result.bookingId ?? "")}` : manageHref ?? "/my-bookings"}>View booking</a></div> : null}
      {step < STEP_DONE ? <footer className={compact.footer}><div className={compact.footerMeta} hidden={embedded && (step === STEP_TIME || step === STEP_REVIEW)}><div className={compact.footerSelection}><div className={compact.selectionTitle}><strong>{selectedServiceNames || "Choose services"}</strong>{step > STEP_SERVICES ? addMoreButton : null}</div><small>{minutes(totalMinutes)}</small></div><strong>{money(total)} est.</strong></div><button className={compact.primary} data-testid="public-booking-next" type="button" disabled={primaryActionDisabled} onClick={activatePrimaryAction}>{primaryActionLabel}</button></footer> : null}
      {optionsServiceId && optionsParent ? <dialog className={compact.dialog} ref={optionsDialog} aria-labelledby="service-options-title" onClose={() => setOptionsServiceId(null)} onClick={event => { if (event.target === event.currentTarget) optionsDialog.current?.close(); }}><div className={compact.dialogTitle}><h2 id="service-options-title">{optionsParent.name} options</h2><button type="button" className={compact.icon} aria-label="Close service options" onClick={() => optionsDialog.current?.close()}>&times;</button></div>
        {addOnOptions.filter(option => option.parent.id === optionsServiceId).map(({parent,service}) => {
          const selection = {parentServiceId:parent.id, serviceId:service.id};
          const checked = selectedAddOnSelections.some(item => addOnKey(item) === addOnKey(selection));
          return <div className={compact.service} key={service.id}><label><span><strong>{service.name}</strong><small className={compact.muted}>Adds {minutes(service.durationMinutes)}</small></span><span>{money(service.basePrice)}</span><input type="checkbox" className={compact.check} checked={checked} disabled={!checked && selectedAddOnSelections.length >= 6} aria-label={service.name} onChange={event => { const add = event.target.checked; setSelectedSlotStart(""); setSelectedAddOnSelections(current => add ? [...current.filter(item => addOnKey(item) !== addOnKey(selection)),selection] : current.filter(item => addOnKey(item) !== addOnKey(selection))); }} /></label></div>;
        })}{selectedAddOnSelections.length >= 6 ? <p className={compact.muted}>Up to 6 extras per booking.</p> : null}<button type="button" className={compact.primary} onClick={() => optionsDialog.current?.close()}>Done</button>
      </dialog> : null}
    </section>
  </main>;
}
