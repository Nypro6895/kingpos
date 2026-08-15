"use client";

import {
  createServiceAction,
  saveServiceConfigsAction,
} from "@/app/services/actions";
import {
  validateServiceConfig,
  wouldCreateServiceAddOnCycle,
} from "@/lib/service-contract";
import type {
  SaveServiceConfigsResult,
  ServiceConfigFieldErrors,
  ServiceConfigInput,
  ServicesWorkspaceData,
  ServiceWorkspaceService,
} from "@/types/service";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

type StatusFilter = "active" | "all" | "inactive" | "needs_setup" | "online";

type ServicesManagerProps = {
  data: ServicesWorkspaceData;
  initialServiceId: string | null;
};

const EMPTY_CREATE_DRAFT: Omit<ServiceConfigInput, "serviceId"> = {
  addOnServiceIds: [],
  basePrice: 0,
  bookingStaffIds: [],
  category: null,
  description: null,
  durationMinutes: 30,
  isActive: true,
  name: "",
  onlineBookingEnabled: false,
};

function classNames(...values: Array<false | null | string | undefined>) {
  return values.filter(Boolean).join(" ");
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function serviceConfig(service: ServiceWorkspaceService): ServiceConfigInput {
  return {
    addOnServiceIds: [...service.addOnServiceIds],
    basePrice: Number(service.base_price),
    bookingStaffIds: [...service.bookingStaffIds],
    category: service.category,
    description: service.description,
    durationMinutes: service.duration_minutes,
    isActive: service.is_active,
    name: service.name,
    onlineBookingEnabled: service.online_booking_enabled,
    serviceId: service.id,
  };
}

function normalizedConfigKey(config: ServiceConfigInput) {
  return JSON.stringify({
    ...config,
    addOnServiceIds: [...config.addOnServiceIds],
    bookingStaffIds: [...config.bookingStaffIds],
    category: config.category?.trim() || null,
    description: config.description?.trim() || null,
    name: config.name.trim(),
  });
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function draftReadiness(
  config: ServiceConfigInput,
  data: ServicesWorkspaceData,
) {
  const selectedStaff = data.staff.filter((member) =>
    config.bookingStaffIds.includes(member.id),
  );
  const readyStaffCount = selectedStaff.filter((member) => member.publicReady).length;
  const ready =
    config.isActive &&
    config.onlineBookingEnabled &&
    readyStaffCount > 0;

  return {
    bookingStaffCount: selectedStaff.length,
    label: !config.isActive
      ? "Unavailable"
      : !config.onlineBookingEnabled
        ? "Disabled"
        : readyStaffCount === 0
          ? "Needs setup"
          : "Ready",
    needsSetup: config.onlineBookingEnabled && !ready,
    ready,
    readyStaffCount,
  };
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="services-toggle"
      data-state={checked ? "on" : "off"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" />
    </button>
  );
}

function FieldError({
  errors,
  field,
}: {
  errors: ServiceConfigFieldErrors;
  field: keyof ServiceConfigFieldErrors;
}) {
  return errors[field] ? (
    <span className="services-field-error">{errors[field]}</span>
  ) : null;
}

function ServiceEditor({
  addOnIdsByServiceId,
  canManage,
  config,
  data,
  onChange,
  service,
}: {
  addOnIdsByServiceId: Map<string, string[]>;
  canManage: boolean;
  config: ServiceConfigInput;
  data: ServicesWorkspaceData;
  onChange: (patch: Partial<ServiceConfigInput>) => void;
  service: ServiceWorkspaceService;
}) {
  const [staffQuery, setStaffQuery] = useState("");
  const [addOnQuery, setAddOnQuery] = useState("");
  const errors = validateServiceConfig(config).fieldErrors;
  const readiness = draftReadiness(config, data);
  const normalizedStaffQuery = staffQuery.trim().toLowerCase();
  const normalizedAddOnQuery = addOnQuery.trim().toLowerCase();
  const visibleStaff = data.staff.filter(
    (member) =>
      !normalizedStaffQuery ||
      member.displayName.toLowerCase().includes(normalizedStaffQuery),
  );
  const visibleAddOns = data.services
    .filter((candidate) => candidate.id !== service.id)
    .filter(
      (candidate) =>
        !normalizedAddOnQuery ||
        candidate.name.toLowerCase().includes(normalizedAddOnQuery) ||
        (candidate.category ?? "").toLowerCase().includes(normalizedAddOnQuery),
    )
    .sort((left, right) => {
      const leftSelected = config.addOnServiceIds.includes(left.id) ? 0 : 1;
      const rightSelected = config.addOnServiceIds.includes(right.id) ? 0 : 1;
      return leftSelected - rightSelected || left.name.localeCompare(right.name);
    });

  function toggleStaff(staffId: string, selected: boolean) {
    onChange({
      bookingStaffIds: selected
        ? [...config.bookingStaffIds, staffId]
        : config.bookingStaffIds.filter((id) => id !== staffId),
    });
  }

  function toggleAddOn(addOnServiceId: string, selected: boolean) {
    onChange({
      addOnServiceIds: selected
        ? [...config.addOnServiceIds, addOnServiceId]
        : config.addOnServiceIds.filter((id) => id !== addOnServiceId),
    });
  }

  return (
    <div className="service-editor">
      <section className="service-editor__section">
        <div className="service-editor__heading">
          <div>
            <h3>Service details</h3>
            <p>Available for salon operations and POS.</p>
          </div>
        </div>

        <div className="service-editor__fields">
          <label className="services-field services-field--wide">
            <span>Name</span>
            <input
              disabled={!canManage}
              maxLength={120}
              onChange={(event) => onChange({ name: event.target.value })}
              value={config.name}
            />
            <FieldError errors={errors} field="name" />
          </label>

          <label className="services-field">
            <span>Category</span>
            <input
              disabled={!canManage}
              maxLength={80}
              onChange={(event) =>
                onChange({ category: event.target.value || null })
              }
              placeholder="Uncategorized"
              value={config.category ?? ""}
            />
            <FieldError errors={errors} field="category" />
          </label>

          <label className="services-field">
            <span>Price</span>
            <span className="services-number-field">
              <span aria-hidden="true">$</span>
              <input
                disabled={!canManage}
                min="0"
                onChange={(event) =>
                  onChange({ basePrice: Number(event.target.value) })
                }
                step="0.01"
                type="number"
                value={config.basePrice}
              />
            </span>
            <FieldError errors={errors} field="basePrice" />
          </label>

          <label className="services-field">
            <span>Duration</span>
            <span className="services-number-field services-number-field--suffix">
              <input
                disabled={!canManage}
                max="1440"
                min="1"
                onChange={(event) =>
                  onChange({ durationMinutes: Number(event.target.value) })
                }
                step="1"
                type="number"
                value={config.durationMinutes}
              />
              <span aria-hidden="true">min</span>
            </span>
            <FieldError errors={errors} field="durationMinutes" />
          </label>

          <label className="services-field services-field--wide">
            <span>Description</span>
            <textarea
              disabled={!canManage}
              maxLength={2000}
              onChange={(event) =>
                onChange({ description: event.target.value || null })
              }
              rows={3}
              value={config.description ?? ""}
            />
            <FieldError errors={errors} field="description" />
          </label>
        </div>

        <div className="service-editor__setting">
          <div>
            <strong>Active in salon</strong>
            <p>Available for salon operations and POS.</p>
          </div>
          <Toggle
            checked={config.isActive}
            disabled={!canManage}
            label={`Set ${config.name || "service"} active state`}
            onChange={(checked) =>
              onChange({
                isActive: checked,
                ...(checked ? {} : { onlineBookingEnabled: false }),
              })
            }
          />
        </div>
      </section>

      <section className="service-editor__section service-editor__section--online">
        <div className="service-editor__heading service-editor__heading--online">
          <div>
            <h3>Online booking</h3>
            <p>Allow customers to find and book this service online.</p>
          </div>
          <Toggle
            checked={config.onlineBookingEnabled}
            disabled={!canManage || !config.isActive}
            label={`Enable online booking for ${config.name || "service"}`}
            onChange={(checked) => onChange({ onlineBookingEnabled: checked })}
          />
        </div>

        {!config.isActive ? (
          <p className="services-inline-warning">
            Activate this service before enabling online booking.
          </p>
        ) : null}

        <div className="booking-readiness" data-state={readiness.ready ? "ready" : "pending"}>
          <div>
            <span>Booking readiness</span>
            <strong>{readiness.label}</strong>
          </div>
          <p>
            {readiness.ready
              ? `${readiness.readyStaffCount} online-ready professional${
                  readiness.readyStaffCount === 1 ? "" : "s"
                } selected.`
              : config.onlineBookingEnabled
                ? "Select at least one online-ready professional."
                : "Online booking is currently off for this service."}
          </p>
        </div>

        {config.onlineBookingEnabled && config.bookingStaffIds.length === 0 ? (
          <p className="services-inline-warning">No booking staff selected.</p>
        ) : null}

        <div className="service-editor__subsection">
          <div className="service-editor__subheading">
            <div>
              <h4>Booking staff</h4>
              <p>Choose which professionals customers can book for this service.</p>
            </div>
            <span>{config.bookingStaffIds.length} selected</span>
          </div>
          <label className="services-search services-search--compact">
            <span className="sr-only">Search booking staff</span>
            <input
              onChange={(event) => setStaffQuery(event.target.value)}
              placeholder="Search professionals"
              type="search"
              value={staffQuery}
            />
          </label>
          <div className="booking-option-list">
            {visibleStaff.map((member) => {
              const selected = config.bookingStaffIds.includes(member.id);
              const disabled =
                !canManage || (!member.isActive && !selected) || !config.isActive;

              return (
                <label
                  className="booking-option-row"
                  data-disabled={disabled || undefined}
                  key={member.id}
                >
                  <input
                    checked={selected}
                    disabled={disabled}
                    onChange={(event) =>
                      toggleStaff(member.id, event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span className="booking-option-row__avatar" aria-hidden="true">
                    {initials(member.displayName)}
                  </span>
                  <span className="booking-option-row__body">
                    <strong>{member.displayName}</strong>
                    <span>
                      {!member.isActive
                        ? "Inactive professional"
                        : member.publicReady
                          ? "Online-ready"
                          : "Online setup incomplete"}
                    </span>
                  </span>
                  <span
                    className="services-readonly-status"
                    data-state={
                      !member.isActive
                        ? "inactive"
                        : member.publicReady
                          ? "ready"
                          : "warning"
                    }
                  >
                    {!member.isActive
                      ? "Inactive"
                      : member.publicReady
                        ? "Ready"
                        : "Needs setup"}
                  </span>
                </label>
              );
            })}
            {visibleStaff.length === 0 ? (
              <p className="booking-option-list__empty">No professionals match.</p>
            ) : null}
          </div>
          <FieldError errors={errors} field="bookingStaffIds" />
        </div>

        <div className="service-editor__subsection">
          <div className="service-editor__subheading">
            <div>
              <h4>Booking add-ons</h4>
              <p>Add optional services customers can choose online.</p>
            </div>
            <span>{config.addOnServiceIds.length} selected</span>
          </div>
          <label className="services-search services-search--compact">
            <span className="sr-only">Search booking add-ons</span>
            <input
              onChange={(event) => setAddOnQuery(event.target.value)}
              placeholder="Search add-ons"
              type="search"
              value={addOnQuery}
            />
          </label>
          <div className="booking-option-list">
            {visibleAddOns.map((candidate) => {
              const selected = config.addOnServiceIds.includes(candidate.id);
              const createsCycle =
                !selected &&
                wouldCreateServiceAddOnCycle({
                  addOnIdsByServiceId,
                  addOnServiceId: candidate.id,
                  parentServiceId: service.id,
                });
              const disabled =
                !canManage ||
                (!candidate.is_active && !selected) ||
                createsCycle;

              return (
                <label
                  className="booking-option-row booking-option-row--addon"
                  data-disabled={disabled || undefined}
                  key={candidate.id}
                >
                  <input
                    checked={selected}
                    disabled={disabled}
                    onChange={(event) =>
                      toggleAddOn(candidate.id, event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span className="booking-option-row__body">
                    <strong>{candidate.name}</strong>
                    <span>
                      +{money(Number(candidate.base_price))} · +
                      {candidate.duration_minutes} min
                    </span>
                  </span>
                  <span
                    className="services-readonly-status"
                    data-state={
                      !candidate.is_active
                        ? "inactive"
                        : createsCycle
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {!candidate.is_active
                      ? selected
                        ? "Linked · inactive"
                        : "Inactive"
                      : createsCycle
                        ? "Creates cycle"
                        : candidate.category || "Service"}
                  </span>
                </label>
              );
            })}
            {visibleAddOns.length === 0 ? (
              <p className="booking-option-list__empty">No add-ons match.</p>
            ) : null}
          </div>
          <FieldError errors={errors} field="addOnServiceIds" />
        </div>
      </section>
    </div>
  );
}

function CreateServiceDrawer({
  canManage,
  onClose,
  onCreated,
}: {
  canManage: boolean;
  onClose: () => void;
  onCreated: (serviceId: string) => void;
}) {
  const [draft, setDraft] = useState(EMPTY_CREATE_DRAFT);
  const [result, setResult] = useState<SaveServiceConfigsResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const errors = validateServiceConfig({ ...draft, serviceId: null }).fieldErrors;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPending, onClose]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateServiceConfig({ ...draft, serviceId: null });

    if (!validation.valid || !canManage) {
      setResult({
        message:
          Object.values(validation.fieldErrors)[0] ??
          "You do not have permission to create services.",
        ok: false,
      });
      return;
    }

    setResult(null);
    startTransition(async () => {
      const response = await createServiceAction(draft);
      setResult(response);

      if (response.ok && response.serviceIds[0]) {
        onCreated(response.serviceIds[0]);
      }
    });
  }

  return (
    <div className="service-drawer-backdrop" role="presentation">
      <aside
        aria-labelledby="new-service-title"
        aria-modal="true"
        className="service-drawer"
        role="dialog"
      >
        <header className="service-drawer__header">
          <div>
            <p>Service catalog</p>
            <h2 id="new-service-title">New service</h2>
          </div>
          <button
            aria-label="Close new service drawer"
            className="services-icon-button"
            disabled={isPending}
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <form className="service-drawer__form" onSubmit={submit}>
          <div className="service-drawer__content">
            {result && !result.ok ? (
              <p className="services-message services-message--error">
                {result.message}
              </p>
            ) : null}

            <label className="services-field">
              <span>Name</span>
              <input
                autoFocus
                maxLength={120}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                value={draft.name}
              />
              <FieldError errors={errors} field="name" />
            </label>

            <label className="services-field">
              <span>Category</span>
              <input
                maxLength={80}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    category: event.target.value || null,
                  }))
                }
                placeholder="Uncategorized"
                value={draft.category ?? ""}
              />
              <FieldError errors={errors} field="category" />
            </label>

            <div className="service-drawer__two-columns">
              <label className="services-field">
                <span>Price</span>
                <span className="services-number-field">
                  <span aria-hidden="true">$</span>
                  <input
                    min="0"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        basePrice: Number(event.target.value),
                      }))
                    }
                    step="0.01"
                    type="number"
                    value={draft.basePrice}
                  />
                </span>
                <FieldError errors={errors} field="basePrice" />
              </label>

              <label className="services-field">
                <span>Duration</span>
                <span className="services-number-field services-number-field--suffix">
                  <input
                    max="1440"
                    min="1"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        durationMinutes: Number(event.target.value),
                      }))
                    }
                    step="1"
                    type="number"
                    value={draft.durationMinutes}
                  />
                  <span aria-hidden="true">min</span>
                </span>
                <FieldError errors={errors} field="durationMinutes" />
              </label>
            </div>

            <div className="service-drawer__setting">
              <div>
                <strong>Active in salon</strong>
                <p>Available for salon operations and POS.</p>
              </div>
              <Toggle
                checked={draft.isActive}
                label="Set new service active state"
                onChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    isActive: checked,
                    onlineBookingEnabled: checked
                      ? current.onlineBookingEnabled
                      : false,
                  }))
                }
              />
            </div>

            <div className="service-drawer__setting">
              <div>
                <strong>Online booking</strong>
                <p>Off by default. Booking staff can be added after creation.</p>
              </div>
              <Toggle
                checked={draft.onlineBookingEnabled}
                disabled={!draft.isActive}
                label="Enable online booking for new service"
                onChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    onlineBookingEnabled: checked,
                  }))
                }
              />
            </div>
          </div>

          <footer className="service-drawer__footer">
            <button
              className="services-button services-button--secondary"
              disabled={isPending}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="services-button services-button--primary"
              disabled={isPending}
              type="submit"
            >
              {isPending ? "Creating..." : "Create service"}
            </button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

export function ServicesManager({
  data,
  initialServiceId,
}: ServicesManagerProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(
    data.services.some((service) => service.id === initialServiceId)
      ? initialServiceId
      : null,
  );
  const [drafts, setDrafts] = useState<Record<string, ServiceConfigInput>>({});
  const [serviceErrors, setServiceErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<SaveServiceConfigsResult | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dirtyIds = Object.keys(drafts);
  const normalizedQuery = query.trim().toLowerCase();

  const effectiveConfigs = useMemo(
    () =>
      new Map(
        data.services.map((service) => [
          service.id,
          drafts[service.id] ?? serviceConfig(service),
        ]),
      ),
    [data.services, drafts],
  );
  const addOnIdsByServiceId = useMemo(
    () =>
      new Map(
        data.services.map((service) => [
          service.id,
          effectiveConfigs.get(service.id)?.addOnServiceIds ?? [],
        ]),
      ),
    [data.services, effectiveConfigs],
  );
  const categories = useMemo(
    () =>
      [...new Set(data.services.map((service) => service.category?.trim()).filter(
        (value): value is string => Boolean(value),
      ))].sort((left, right) => left.localeCompare(right)),
    [data.services],
  );
  const visibleServices = data.services.filter((service) => {
    const config = effectiveConfigs.get(service.id) ?? serviceConfig(service);
    const readiness = draftReadiness(config, data);
    const matchesQuery =
      !normalizedQuery ||
      config.name.toLowerCase().includes(normalizedQuery) ||
      (config.category ?? "").toLowerCase().includes(normalizedQuery) ||
      (config.description ?? "").toLowerCase().includes(normalizedQuery);
    const matchesCategory =
      category === "all" || (config.category || "Uncategorized") === category;
    const matchesStatus =
      status === "all" ||
      (status === "active" && config.isActive) ||
      (status === "inactive" && !config.isActive) ||
      (status === "online" &&
        config.isActive &&
        config.onlineBookingEnabled) ||
      (status === "needs_setup" && readiness.needsSetup);

    return matchesQuery && matchesCategory && matchesStatus;
  });
  const summary = data.services.reduce(
    (current, service) => {
      const config = effectiveConfigs.get(service.id) ?? serviceConfig(service);
      return {
        active: current.active + (config.isActive ? 1 : 0),
        online:
          current.online +
          (config.isActive && config.onlineBookingEnabled ? 1 : 0),
      };
    },
    { active: 0, online: 0 },
  );

  useEffect(() => {
    if (dirtyIds.length === 0) {
      return;
    }

    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    function confirmNavigation(event: MouseEvent) {
      const target = event.target;
      const anchor =
        target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;

      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.download ||
        anchor.href === window.location.href
      ) {
        return;
      }

      if (!window.confirm("Discard unsaved service changes and leave this page?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", confirmNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", confirmNavigation, true);
    };
  }, [dirtyIds.length]);

  function updateService(
    service: ServiceWorkspaceService,
    patch: Partial<ServiceConfigInput>,
  ) {
    const baseline = serviceConfig(service);
    setDrafts((current) => {
      const next = {
        ...(current[service.id] ?? baseline),
        ...patch,
      };

      if (normalizedConfigKey(next) === normalizedConfigKey(baseline)) {
        const remaining = { ...current };
        delete remaining[service.id];
        return remaining;
      }

      return { ...current, [service.id]: next };
    });
    setServiceErrors((current) => {
      const remaining = { ...current };
      delete remaining[service.id];
      return remaining;
    });
    setMessage(null);
  }

  function saveAll() {
    const configs = dirtyIds.map((serviceId) => drafts[serviceId]);
    const firstInvalid = configs.find(
      (config) => !validateServiceConfig(config).valid,
    );

    if (firstInvalid) {
      setExpandedServiceId(firstInvalid.serviceId ?? null);
      setMessage({
        message: "Review the highlighted fields before saving.",
        ok: false,
      });
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const response = await saveServiceConfigsAction(configs);
      setMessage(response);

      if (response.ok) {
        setDrafts({});
        setServiceErrors({});
        router.refresh();
      } else {
        setServiceErrors(
          response.serviceErrors ??
            Object.fromEntries(
              dirtyIds.map((serviceId) => [serviceId, response.message]),
            ),
        );
      }
    });
  }

  function discardAll() {
    setDrafts({});
    setServiceErrors({});
    setMessage(null);
  }

  function handleCreated(serviceId: string) {
    setShowCreate(false);
    setExpandedServiceId(serviceId);
    setMessage({ message: "Service created. Add booking staff or add-ons when ready.", ok: true, serviceIds: [serviceId] });
    router.replace(`/services?service=${serviceId}`);
    router.refresh();
  }

  return (
    <main className="services-page">
      <div className="services-page__frame services-page__content">
        {data.canManage ? (
          <div className="services-page__actions">
            <button
              className="services-button services-button--primary"
              onClick={() => setShowCreate(true)}
              type="button"
            >
              <span aria-hidden="true">+</span>
              New service
            </button>
          </div>
        ) : null}

        {!data.canManage ? (
          <p className="services-message">
            You have read-only access to the service catalog.
          </p>
        ) : null}

        {message ? (
          <p
            className={classNames(
              "services-message",
              message.ok
                ? "services-message--success"
                : "services-message--error",
            )}
          >
            {message.message}
          </p>
        ) : null}

        <section className="services-toolbar" aria-label="Service filters">
          <label className="services-search">
            <span className="sr-only">Search services</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search services"
              type="search"
              value={query}
            />
          </label>
          <label>
            <span className="sr-only">Category filter</span>
            <select
              onChange={(event) => setCategory(event.target.value)}
              value={category}
            >
              <option value="all">All categories</option>
              <option value="Uncategorized">Uncategorized</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Status filter</span>
            <select
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              value={status}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="online">Online</option>
              <option value="needs_setup">Needs setup</option>
            </select>
          </label>
          <p className="services-toolbar__summary">
            {summary.active} active · {summary.online} online · {categories.length}{" "}
            categor{categories.length === 1 ? "y" : "ies"}
          </p>
        </section>

        {data.services.length === 0 ? (
          <section className="services-page__empty">
            <h2>No services yet</h2>
            <p>Create the first service when the salon catalog is ready.</p>
          </section>
        ) : visibleServices.length === 0 ? (
          <section className="services-page__empty">
            <h2>No matching services</h2>
            <p>Try a different search, category, or status.</p>
          </section>
        ) : (
          <section className="services-list" aria-label="Salon services">
            <div className="services-list__header" aria-hidden="true">
              <span>Service</span>
              <span>Price</span>
              <span>Duration</span>
              <span>Active</span>
              <span>Online booking</span>
              <span>Booking staff</span>
              <span />
            </div>
            <div className="services-list__rows">
              {visibleServices.map((service) => {
                const config =
                  effectiveConfigs.get(service.id) ?? serviceConfig(service);
                const readiness = draftReadiness(config, data);
                const expanded = expandedServiceId === service.id;
                const dirty = Boolean(drafts[service.id]);

                return (
                  <article
                    className="service-row"
                    data-dirty={dirty || undefined}
                    data-expanded={expanded || undefined}
                    key={service.id}
                  >
                    <div className="service-row__summary">
                      <div className="service-row__identity">
                        <strong>{config.name || "Untitled service"}</strong>
                        <span>{config.category || "Uncategorized"}</span>
                        {dirty ? <em>Unsaved</em> : null}
                      </div>
                      <div className="service-row__value" data-label="Price">
                        {money(config.basePrice)}
                      </div>
                      <div className="service-row__value" data-label="Duration">
                        {config.durationMinutes} min
                      </div>
                      <div className="service-row__state" data-label="Active">
                        {data.canManage ? (
                          <Toggle
                            checked={config.isActive}
                            disabled={isPending}
                            label={`Set ${config.name} active state`}
                            onChange={(checked) =>
                              updateService(service, {
                                isActive: checked,
                                ...(checked
                                  ? {}
                                  : { onlineBookingEnabled: false }),
                              })
                            }
                          />
                        ) : (
                          <span
                            className="services-readonly-status"
                            data-state={config.isActive ? "ready" : "inactive"}
                          >
                            {config.isActive ? "Active" : "Inactive"}
                          </span>
                        )}
                      </div>
                      <div className="service-row__state" data-label="Online booking">
                        {data.canManage ? (
                          <div className="service-row__toggle-with-label">
                            <Toggle
                              checked={config.onlineBookingEnabled}
                              disabled={isPending || !config.isActive}
                              label={`Enable online booking for ${config.name}`}
                              onChange={(checked) =>
                                updateService(service, {
                                  onlineBookingEnabled: checked,
                                })
                              }
                            />
                            <span data-state={readiness.needsSetup ? "warning" : undefined}>
                              {readiness.label}
                            </span>
                          </div>
                        ) : (
                          <span
                            className="services-readonly-status"
                            data-state={
                              readiness.ready
                                ? "ready"
                                : readiness.needsSetup
                                  ? "warning"
                                  : "neutral"
                            }
                          >
                            {readiness.label}
                          </span>
                        )}
                      </div>
                      <div className="service-row__staff" data-label="Booking staff">
                        {config.bookingStaffIds.length > 0
                          ? `${config.bookingStaffIds.length} staff`
                          : "—"}
                      </div>
                      <button
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${config.name}`}
                        className="services-expand-button"
                        onClick={() =>
                          setExpandedServiceId(expanded ? null : service.id)
                        }
                        type="button"
                      >
                        <span aria-hidden="true" />
                      </button>
                    </div>

                    {serviceErrors[service.id] ? (
                      <p className="service-row__error">
                        {serviceErrors[service.id]}
                      </p>
                    ) : null}

                    {expanded ? (
                      <ServiceEditor
                        addOnIdsByServiceId={addOnIdsByServiceId}
                        canManage={data.canManage && !isPending}
                        config={config}
                        data={data}
                        onChange={(patch) => updateService(service, patch)}
                        service={service}
                      />
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {dirtyIds.length > 0 ? (
        <div className="services-save-bar" role="status">
          <div className="services-page__frame services-save-bar__inner">
            <p>
              <strong>{dirtyIds.length}</strong> service
              {dirtyIds.length === 1 ? " has" : "s have"} unsaved changes
            </p>
            <div>
              <button
                className="services-button services-button--secondary"
                disabled={isPending}
                onClick={discardAll}
                type="button"
              >
                Discard
              </button>
              <button
                className="services-button services-button--primary"
                disabled={isPending}
                onClick={saveAll}
                type="button"
              >
                {isPending ? "Saving..." : "Save all changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreate ? (
        <CreateServiceDrawer
          canManage={data.canManage}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      ) : null}
    </main>
  );
}
