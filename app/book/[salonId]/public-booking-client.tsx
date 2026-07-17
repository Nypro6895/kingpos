"use client";

import {
  createPublicBookingAction,
  loadPublicBookingSlotsAction,
} from "@/app/book/actions";
import type {
  PublicBookingAddOnSelection,
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
  primaryButton: "public-booking-primary-button",
  progress: "public-booking-progress",
  progressActive: "public-booking-progress-active",
  progressCircle: "public-booking-progress-circle",
  progressDone: "public-booking-progress-done",
  progressStep: "public-booking-progress-step",
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
    : "KP";
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

function UnavailableState({ data }: { data: PublicBookingPageData }) {
  return (
    <main
      className={classNames(styles.bookingSurface, styles.publicRoot)}
      data-booking-surface="public"
      data-testid="public-booking-root"
    >
      <div className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-5 py-10">
        <section className={classNames(styles.publicCard, "w-full p-6")}>
          <p className={styles.eyebrow}>KingPOS booking</p>
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

export function PublicBookingClient({ data }: PublicBookingClientProps) {
  const settings = data.settings;
  const mainServices = data.services.filter((service) => !service.isAddOnOnly);
  const initialServiceId =
    data.initialSelection.serviceId &&
    mainServices.some((service) => service.id === data.initialSelection.serviceId)
      ? data.initialSelection.serviceId
      : (mainServices[0]?.id ?? "");
  const initialServiceIds =
    data.initialSelection.serviceIds.length > 0
      ? data.initialSelection.serviceIds.filter((serviceId) =>
          mainServices.some((service) => service.id === serviceId),
        )
      : initialServiceId
        ? [initialServiceId]
        : [];
  const categoryNames = [
    ...new Set(mainServices.map((service) => service.category ?? "Services")),
  ];
  const initialCategory =
    mainServices.find((service) => service.id === initialServiceId)?.category ??
    categoryNames[0] ??
    "Services";

  const [step, setStep] = useState(0);
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
  const [lineStaffIds, setLineStaffIds] = useState<string[]>([]);
  const [date, setDate] = useState(data.initialSelection.date);
  const [slots, setSlots] = useState<PublicBookingSlot[]>(data.slots);
  const [selectedSlotStart, setSelectedSlotStart] = useState(data.slots[0]?.startAt ?? "");
  const [customer, setCustomer] = useState<CustomerDraft>({
    email: "",
    firstName: "",
    lastName: "",
    notes: "",
    phone: "",
  });
  const [honeypot, setHoneypot] = useState("");
  const [result, setResult] = useState<{
    bookingId?: string;
    manageToken?: string | null;
    message: string;
    ok: boolean;
    status?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
  const summaryServices = useMemo(
    () =>
      selectedServices.flatMap((service) => [
        service,
        ...selectedAddOns
          .filter((selection) => selection.parent.id === service.id)
          .map((selection) => selection.service),
      ]),
    [selectedAddOns, selectedServices],
  );
  const eligibleStaff = useMemo(
    () => staffEligibleForServices(data, summaryServices.map((service) => service.id)),
    [data, summaryServices],
  );
  const selectedSlot = slots.find((slot) => slot.startAt === selectedSlotStart) ?? null;
  const visibleServices = mainServices.filter(
    (service) => (service.category ?? "Services") === category,
  );
  const total = summaryServices.reduce((sum, service) => sum + service.basePrice, 0);
  const totalMinutes = summaryServices.reduce(
    (sum, service) => sum + service.durationMinutes,
    0,
  );

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
    setLineStaffIds([]);
  }

  useEffect(() => {
    if (data.state !== "ready" || selectedServiceIds.length === 0) {
      return;
    }

    let active = true;
    startTransition(async () => {
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

      setSlots(nextSlots);
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
    staffId,
    staffMode,
  ]);

  if (data.state !== "ready" || !settings || !data.salon) {
    return <UnavailableState data={data} />;
  }

  const canContinue =
    step === STEP_SERVICES
      ? selectedServiceIds.length > 0
      : step === STEP_PROFESSIONAL
        ? staffMode === "any" ||
          (staffMode === "specific" &&
            eligibleStaff.some((staff) => staff.id === staffId)) ||
          staffMode === "split"
        : step === STEP_TIME
          ? Boolean(selectedSlot)
          : step === STEP_DETAILS
            ? Boolean(
                customer.firstName.trim() &&
                  customer.lastName.trim() &&
                  customer.phone.trim() &&
                  customer.email.trim(),
              )
            : true;
  const manageHref =
    result?.manageToken && typeof window !== "undefined"
      ? `${window.location.origin}/booking/manage/${result.manageToken}`
      : result?.manageToken
        ? `/booking/manage/${result.manageToken}`
        : null;

  function submitBooking() {
    if (!selectedSlot) {
      setError("Choose an available time.");
      setStep(STEP_TIME);
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await createPublicBookingAction({
        addOnSelections: selectedAddOnSelections,
        customerEmail: customer.email,
        customerFirstName: customer.firstName,
        customerLastName: customer.lastName,
        customerPhone: customer.phone,
        honeypot,
        idempotencyKey: crypto.randomUUID(),
        lineStaffIds,
        lookId: data.initialSelection.lookId,
        publicNotes: customer.notes,
        salonId: data.salon?.salonId ?? "",
        serviceId: selectedServiceIds[0] ?? null,
        serviceIds: selectedServiceIds,
        source: data.initialSelection.source,
        staffId,
        staffMode,
        startAt: selectedSlot.startAt,
      });

      setResult(response);
      setStep(STEP_DONE);
      if (!response.ok) {
        setError(response.message);
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
        : staffId
          ? data.staff.find((staff) => staff.id === staffId)?.displayName ?? "Selected"
          : "Choose professional";
  const confirmationTitle =
    result?.ok && result.status === "confirmed"
      ? "Booking confirmed"
      : result?.ok
        ? "Request received"
        : "Booking not submitted";
  const nextLabel =
    step === STEP_SERVICES
      ? "Next: Choose professional"
      : step === STEP_PROFESSIONAL
        ? "Next: Date & time"
        : step === STEP_TIME
          ? "Next: Your details"
          : "Next: Review";
  const primaryActionLabel =
    step === STEP_REVIEW
      ? isPending
        ? "Submitting..."
        : settings.confirmationMode === "instant_booking"
          ? "Confirm booking"
          : "Request appointment"
      : nextLabel;
  const primaryActionDisabled =
    step === STEP_REVIEW ? isPending || !selectedSlot : !canContinue;

  function activatePrimaryAction() {
    if (step === STEP_REVIEW) {
      submitBooking();
      return;
    }

    setStep((current) => Math.min(STEP_REVIEW, current + 1));
  }

  return (
    <main
      className={classNames(styles.bookingSurface, styles.publicRoot)}
      data-booking-surface="public"
      data-testid="public-booking-root"
    >
      <section className={styles.publicShell} data-testid="public-booking-shell">
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
                <span className={styles.progressCircle}>{done ? "✓" : index + 1}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

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
              <div className="grid gap-4">
                {settings.anyProfessionalEnabled ? (
                  <button
                    className={classNames(
                      styles.publicCard,
                      "flex items-center justify-between gap-4 p-5 text-left",
                      staffMode === "any" && "border-[#642a56] bg-[#f7f2f7]",
                    )}
                    onClick={() => setStaffMode("any")}
                    type="button"
                  >
                    <span>
                      <span className="block text-lg font-extrabold text-[#211c24]">
                        Any professional
                      </span>
                      <span className="mt-1 block text-sm text-[#786d78]">
                        We will show times with eligible staff.
                      </span>
                    </span>
                    <span className={classNames(styles.addButton, staffMode === "any" && styles.addButtonSelected)}>
                      {staffMode === "any" ? "✓" : "Select"}
                    </span>
                  </button>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  {eligibleStaff.map((staff) => (
                    <button
                      className={classNames(
                        styles.publicCard,
                        "flex items-center gap-4 p-5 text-left",
                        staffMode === "specific" &&
                          staff.id === staffId &&
                          "border-[#642a56] bg-[#f7f2f7]",
                      )}
                      key={staff.id}
                      onClick={() => {
                        setStaffMode("specific");
                        setStaffId(staff.id);
                      }}
                      type="button"
                    >
                      <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-[#efe8f3] text-sm font-extrabold text-[#642a56]">
                        {staff.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt="" className="h-full w-full object-cover" src={staff.avatarUrl} />
                        ) : (
                          initialsFor(staff.displayName)
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-lg font-extrabold text-[#211c24]">
                          {staff.displayName}
                        </span>
                        {staff.jobTitle ? (
                          <span className="block text-sm text-[#786d78]">{staff.jobTitle}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
                {settings.splitStaffAppointmentEnabled && summaryServices.length > 1 ? (
                  <section className={classNames(styles.publicCard, "grid gap-3 p-5")}>
                    <p className="text-lg font-extrabold text-[#211c24]">Split by service</p>
                    {summaryServices.map((service, index) => (
                      <label className="grid gap-2" key={`${service.id}-${index}`}>
                        <span className="text-sm font-extrabold text-[#211c24]">
                          {service.name}
                        </span>
                        <select
                          className={styles.select}
                          onChange={(event) => {
                            setStaffMode("split");
                            setLineStaffIds((current) => {
                              const next = [...current];
                              next[index] = event.target.value;
                              return next;
                            });
                          }}
                          value={lineStaffIds[index] ?? ""}
                        >
                          <option value="">Best available</option>
                          {serviceStaffNames(data, service.id).map((staff) => (
                            <option key={staff.id} value={staff.id}>
                              {staff.displayName}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </section>
                ) : null}
              </div>
            </section>
          ) : null}

          {step === STEP_TIME ? (
            <section>
              <div className={styles.publicHeading}>
                <p className={styles.eyebrow}>Date & time</p>
                <h1 className={styles.publicTitle}>Find a time</h1>
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
              {slots.length === 0 ? (
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
              <div className={classNames(styles.publicCard, "grid gap-4 p-5 sm:grid-cols-2")}>
                {[
                  ["First name", "firstName"],
                  ["Last name", "lastName"],
                  ["Phone", "phone"],
                  ["Email", "email"],
                ].map(([label, key]) => (
                  <label className="grid gap-2" key={key}>
                    <span className="text-sm font-extrabold text-[#211c24]">{label}</span>
                    <input
                      className={styles.field}
                      onChange={(event) =>
                        setCustomer((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                      value={customer[key as keyof CustomerDraft]}
                    />
                  </label>
                ))}
                <label className="hidden">
                  Company
                  <input
                    autoComplete="off"
                    onChange={(event) => setHoneypot(event.target.value)}
                    tabIndex={-1}
                    value={honeypot}
                  />
                </label>
                <label className="grid gap-2 sm:col-span-2">
                  <span className="text-sm font-extrabold text-[#211c24]">
                    Notes for the salon
                  </span>
                  <textarea
                    className="min-h-28 rounded-xl border border-[#e7dfe5] px-3 py-2 text-sm outline-none focus:border-[#8f4a7b] focus:ring-4 focus:ring-[#642a56]/10"
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
            </section>
          ) : null}

          {step === STEP_REVIEW ? (
            <section>
              <div className={styles.publicHeading}>
                <p className={styles.eyebrow}>Review</p>
                <h1 className={styles.publicTitle}>Review your visit</h1>
              </div>
              <div className={classNames(styles.publicCard, "grid gap-4 p-5")}>
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
                      {customer.firstName} {customer.lastName}
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

          {step === STEP_DONE ? (
            <section className={classNames(styles.publicCard, "p-6")}>
              <p className={styles.eyebrow}>Confirmation</p>
              <h1 className={classNames(styles.publicTitle, "mt-3")}>{confirmationTitle}</h1>
              <p className="mt-4 text-sm leading-6 text-[#786d78]">
                {result?.message ?? "Your booking request has been processed."}
              </p>
              {manageHref ? (
                <a className={classNames(styles.primaryButton, "mt-6 px-5")} href={manageHref}>
                  Manage booking
                </a>
              ) : null}
              {!result?.ok ? (
                <button
                  className={classNames(styles.secondaryButton, "mt-4 px-5")}
                  onClick={() => setStep(STEP_TIME)}
                  type="button"
                >
                  Choose another time
                </button>
              ) : null}
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
          <div className="grid gap-4 text-sm">
            {summaryServices.length === 0 ? (
              <p className="text-[#786d78]">Choose a service to start.</p>
            ) : (
              summaryServices.map((service) => (
                <div className="flex justify-between gap-4" key={service.id}>
                  <span>
                    <span className="block font-extrabold text-[#211c24]">{service.name}</span>
                    <span className="text-xs text-[#786d78]">{minutes(service.durationMinutes)}</span>
                  </span>
                  <span className="font-extrabold text-[#211c24]">{money(service.basePrice)}</span>
                </div>
              ))
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
      </section>
    </main>
  );
}
