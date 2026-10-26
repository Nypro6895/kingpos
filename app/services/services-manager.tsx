"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { ContextualSupport } from "@/components/contextual-support";
import { WorkspaceToolbar, toolbarStyles } from "@/components/workspace-toolbar";
import { CompactFilters } from "@/components/compact-filters";
import { DeleteUnusedButton } from "@/app/settings/delete-unused-button";
import { invalidateServicesCatalogForMutation } from "@/lib/services-catalog-runtime";

import {
  createServiceAction,
  saveServiceConfigsAction,
} from "@/app/services/actions";
import {
  validateServiceConfig,
} from "@/lib/service-contract";
import { normalizeSearchText, searchTextMatches } from "@/lib/search-normalization";
import type {
  SaveServiceConfigsResult,
  ServiceConfigFieldErrors,
  ServiceConfigInput,
  ServicesWorkspaceData,
  ServiceWorkspaceService,
} from "@/types/service";
import { ServiceAddOnGroups } from "./service-addon-groups";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

type StatusFilter = "active" | "all" | "inactive" | "needs_setup" | "online";

type ServicesManagerProps = {
  data: ServicesWorkspaceData;
  initialServiceId: string | null;
  embedded?: boolean;
  expectedSalonId?: string;
  catalogScope?: string;
  onSaved?: () => void | Promise<void>;
};

const EMPTY_CREATE_DRAFT: Omit<ServiceConfigInput, "serviceId"> = {
  bookingAddOns: [],
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
    bookingAddOns: (service.bookingAddOns ?? []).map(item => ({...item})),
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
  const readyStaffCount = selectedStaff.filter((member) => member.bookingReady).length;
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
  const __vt = useWorkspaceTranslation();

  return (
    <button
      aria-checked={checked}
      aria-label={__vt(label)}
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

function ServiceEditor({canManage,config,data,onChange}: {
  canManage: boolean; config: ServiceConfigInput; data: ServicesWorkspaceData;
  onChange: (patch: Partial<ServiceConfigInput>) => void;
}) {
  const t = useWorkspaceTranslation();
  const errors = validateServiceConfig(config).fieldErrors;
  const categories = [...new Set(data.services.map(item => item.category?.trim()).filter((item): item is string => Boolean(item)))];
  return <div className="service-editor">
    <section className="service-editor__section">
      <h3><WorkspaceText text="Service details" /></h3>
      <div className="service-editor__fields">
        <label className="services-field"><span><WorkspaceText text="Name" />:</span><input disabled={!canManage} maxLength={120} value={config.name} onChange={event => onChange({name:event.target.value})}/><FieldError errors={errors} field="name" /></label>
        <label className="services-field"><span><WorkspaceText text="Category" />:</span><input disabled={!canManage} maxLength={80} list={"service-categories-" + config.serviceId} value={config.category ?? ""} placeholder={t("Uncategorized")} onChange={event => onChange({category:event.target.value || null})}/><FieldError errors={errors} field="category" /></label>
        <datalist id={"service-categories-" + config.serviceId}>{categories.map(category => <option value={category} key={category}/>)}</datalist>
        <label className="services-field"><span><WorkspaceText text="Price" />:</span><span className="services-number-field"><span>$</span><input disabled={!canManage} type="number" min={0} step="0.01" value={config.basePrice} onChange={event => onChange({basePrice:Number(event.target.value)})}/></span><FieldError errors={errors} field="basePrice" /></label>
        <label className="services-field"><span><WorkspaceText text="Duration" />:</span><span className="services-number-field services-number-field--suffix"><input disabled={!canManage} type="number" min={1} max={1440} step={1} value={config.durationMinutes} onChange={event => onChange({durationMinutes:Number(event.target.value)})}/><span><WorkspaceText text="min" /></span></span><FieldError errors={errors} field="durationMinutes" /></label>
        <label className="services-field"><span><WorkspaceText text="Description" />:</span><textarea disabled={!canManage} rows={3} maxLength={2000} value={config.description ?? ""} onChange={event => onChange({description:event.target.value || null})}/><FieldError errors={errors} field="description" /></label>
      </div>
    </section>
    <section className="service-editor__section">
      <div className="service-editor__subheading"><h3><WorkspaceText text="Staff available" /></h3><span>{config.bookingStaffIds.length} <WorkspaceText text="selected" /></span></div>
      <div className="booking-option-list">{data.staff.map(member => <label className="booking-option-row" key={member.id}>
        <input type="checkbox" disabled={!canManage || (!member.isActive && !config.bookingStaffIds.includes(member.id))}
          checked={config.bookingStaffIds.includes(member.id)} onChange={event => onChange({bookingStaffIds:event.target.checked ? [...config.bookingStaffIds,member.id] : config.bookingStaffIds.filter(id => id !== member.id)})}/>
        <span className="booking-option-row__avatar" aria-hidden="true">{initials(member.displayName)}</span><span className="booking-option-row__body"><strong>{member.displayName}</strong><span><WorkspaceText text={member.bookingReady ? "Online booking enabled" : member.isActive ? "Online booking off" : "Inactive professional"}/></span></span>
      </label>)}</div>
      {config.onlineBookingEnabled && !config.bookingStaffIds.length ? <p className="services-inline-warning"><WorkspaceText text="No booking staff selected."/></p> : null}
      <FieldError errors={errors} field="bookingStaffIds" />
    </section>
    <ServiceAddOnGroups items={config.bookingAddOns ?? []} disabled={!canManage} onChange={bookingAddOns => onChange({bookingAddOns})}/>
    <FieldError errors={errors} field="addOnServiceIds" />
  </div>;
}

function CreateServiceDrawer({
  embedded = false,
  expectedSalonId,
  canManage,
  onClose,
  onCreated,
}: {
  expectedSalonId?: string;
  embedded?: boolean;
  canManage: boolean;
  onClose: () => void;
  onCreated: (serviceId: string) => void | Promise<void>;
}) {
  const __vt = useWorkspaceTranslation();

  const [draft, setDraft] = useState(EMPTY_CREATE_DRAFT);
  const [result, setResult] = useState<SaveServiceConfigsResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [attempted, setAttempted] = useState(false);
  const errors = attempted ? validateServiceConfig({ ...draft, serviceId: null }).fieldErrors : {};
  const creationRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (embedded) creationRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [embedded]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    }

    if (embedded) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPending, onClose, embedded]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
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
      let response: SaveServiceConfigsResult;
      try { response = await createServiceAction(draft, expectedSalonId); }
      catch { setResult({ ok: false, message: "Could not create service. Your changes are still here. Please try again." }); return; }
      setResult(response);

      if (response.ok && response.serviceIds[0]) {
        await onCreated(response.serviceIds[0]);
      }
    });
  }

  return (
    <div ref={creationRef} className={embedded ? "service-create-inline" : "service-drawer-backdrop"} role="presentation"
      onKeyDown={embedded ? (event) => { if (event.key === "Escape") { event.stopPropagation(); if (!isPending) onClose(); } } : undefined}>

      <aside
        aria-labelledby="new-service-title"
        aria-modal={embedded ? undefined : true}
        className="service-drawer"
        role={embedded ? "region" : "dialog"}
      >
        <header className="service-drawer__header">
          <div>
            <p><WorkspaceText text="Service catalog" /></p>
            <h2 id="new-service-title"><WorkspaceText text="New service" /></h2>
          </div>
          <button
            aria-label={__vt("Close new service drawer")}
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
                <WorkspaceText text={result.message} />
              </p>
            ) : null}

            <label className="services-field">
              <span><WorkspaceText text="Name" /></span>
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
              <span><WorkspaceText text="Category" /></span>
              <input
                maxLength={80}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    category: event.target.value || null,
                  }))
                }
                placeholder={__vt("Uncategorized")}
                value={draft.category ?? ""}
              />
              <FieldError errors={errors} field="category" />
            </label>

            <div className="service-drawer__two-columns">
              <label className="services-field">
                <span><WorkspaceText text="Price" /></span>
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
                <span><WorkspaceText text="Duration" /></span>
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
                  <span aria-hidden="true"><WorkspaceText text="min" /></span>
                </span>
                <FieldError errors={errors} field="durationMinutes" />
              </label>
            </div>

            <div className="service-drawer__setting">
              <div>
                <strong><WorkspaceText text="Active in salon" /></strong>
                <p><WorkspaceText text="Available for salon operations and POS." /></p>
              </div>
              <Toggle
                checked={draft.isActive}
                label={__vt("Set new service active state")}
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
                <strong><WorkspaceText text="Online booking" /></strong>
                <p><WorkspaceText text="Off by default. Booking staff can be added after creation." /></p>
              </div>
              <Toggle
                checked={draft.onlineBookingEnabled}
                disabled={!draft.isActive}
                label={__vt("Enable online booking for new service")}
                onChange={(checked) =>
                  setDraft((current) => ({
                    ...current,
                    onlineBookingEnabled: checked,
                  }))
                }
              />
            </div>
            <ServiceAddOnGroups items={draft.bookingAddOns ?? []} disabled={!canManage || isPending} onChange={bookingAddOns => setDraft(current => ({...current,bookingAddOns}))}/>
            <FieldError errors={errors} field="addOnServiceIds" />
          </div>

          <footer className="service-drawer__footer">
            <button
              className="services-button services-button--secondary"
              disabled={isPending}
              onClick={onClose}
              type="button"
            >
              <WorkspaceText text="Cancel" />
            </button>
            <button
              className="services-button services-button--primary"
              disabled={isPending}
              type="submit"
            >
              <WorkspaceText text={isPending ? "Creating..." : "Create service"} />
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
  embedded = false,
  expectedSalonId,
  catalogScope,
  onSaved,
}: ServicesManagerProps) {
  const __vt = useWorkspaceTranslation();
  const catalogSalonIds = [...new Set(data.services.map(service => service.salon_id))];
  const catalogSalonId = expectedSalonId ?? (catalogSalonIds.length === 1 ? catalogSalonIds[0] : undefined);
  const invalidateCatalogMutation = () => invalidateServicesCatalogForMutation(catalogScope, catalogSalonId);

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
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dirtyIds = Object.keys(drafts);
  const normalizedQuery = normalizeSearchText(query);

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
      searchTextMatches(
        [config.name, config.category, config.description],
        normalizedQuery,
      );
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

      if (!window.confirm(__vt("Discard unsaved service changes and leave this page?"))) {
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

  async function refreshAfterSave() {
    try {
      if (onSaved) await onSaved();
      else router.refresh();
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
      setMessage({ ok: false, message: "Saved, but the service list could not refresh. Reload the list to see the latest values." });
    }
  }

  function saveAll(onlyServiceId?: string) {
    const savingIds = onlyServiceId ? dirtyIds.filter(id => id === onlyServiceId) : dirtyIds;
    if (isPending || dirtyIds.length === 0) return;
    const configs = savingIds.map((serviceId) => drafts[serviceId]);
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
      let response: SaveServiceConfigsResult;
      try { response = await saveServiceConfigsAction(configs, expectedSalonId); }
      catch { setMessage({ ok: false, message: "Could not save services. Your changes are still here. Please try again." }); return; }
      setMessage(response);

      if (response.ok) {
        await invalidateCatalogMutation();
        setDrafts(current => Object.fromEntries(Object.entries(current).filter(([id]) => !savingIds.includes(id))));
        setServiceErrors(current => Object.fromEntries(Object.entries(current).filter(([id]) => !savingIds.includes(id))));
        await refreshAfterSave();
      } else {
        setServiceErrors(
          response.serviceErrors ??
            Object.fromEntries(
              savingIds.map((serviceId) => [serviceId, response.message]),
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

  async function handleCreated(serviceId: string) {
    await invalidateCatalogMutation();
    setShowCreate(false);
    setExpandedServiceId(serviceId);
    setMessage({ message: "Service created. Add booking staff or add-ons when ready.", ok: true, serviceIds: [serviceId] });
    if (embedded) await refreshAfterSave();
    if (!embedded) { router.replace(`/services?service=${serviceId}`); }
  }

  return (
    <main className={embedded ? "services-page settings-inline-services" : "services-page"}>
      <div className="services-page__frame services-page__content">
        {refreshFailed ? <button type="button" className="services-button" disabled={isPending} onClick={() => startTransition(async () => { if (onSaved) await refreshAfterSave(); else { router.refresh(); setRefreshFailed(false); } })}><WorkspaceText text="Reload service list" /></button> : null}


        {!data.canManage ? (
          <p className="services-message">
            <WorkspaceText text="You have read-only access to the service catalog." />
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
            <WorkspaceText text={message.message} />
          </p>
        ) : null}

        <WorkspaceToolbar>
          <label className="services-search min-w-0 flex-1">
            <span className="sr-only"><WorkspaceText text="Search services" /></span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={__vt("Search services")}
              type="search"
              value={query}
            />
          </label>
          <CompactFilters label={__vt("Service filters")} active={category !== "all" || status !== "all"}>
            <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs font-medium"><WorkspaceText text="Category" /></span>
            <select className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-2"
              onChange={(event) => setCategory(event.target.value)}
              value={category}
            >
              <option value="all"><WorkspaceText text="All categories" /></option>
              <option value="Uncategorized"><WorkspaceText text="Uncategorized" /></option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium"><WorkspaceText text="Status" /></span>
            <select className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-2"
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              value={status}
            >
              <option value="all"><WorkspaceText text="All statuses" /></option>
              <option value="active"><WorkspaceText text="Active" /></option>
              <option value="inactive"><WorkspaceText text="Inactive" /></option>
              <option value="online"><WorkspaceText text="Online" /></option>
              <option value="needs_setup"><WorkspaceText text="Needs setup" /></option>
            </select>
          </label>
            </div>
          </CompactFilters>
        {data.canManage ? (
          <div className="services-page__actions">
            <button
              className={toolbarStyles.primary}
              aria-label={__vt("New service")}
              onClick={() => setShowCreate(true)}
              type="button"
            >
              <span aria-hidden="true">+</span>
              <span className="sm:hidden"><WorkspaceText text="New" /></span><span className="hidden sm:inline"><WorkspaceText text="New service" /></span>
            </button>
          </div>
        ) : null}
        {!embedded && <ContextualSupport />}
        </WorkspaceToolbar>
          <p className="text-xs leading-5 text-zinc-500">
            <WorkspaceText text={category !== "all" || status !== "all" ? `${visibleServices.length} matching · ` : ""} />{summary.active} <WorkspaceText text="active ·" /> {summary.online} <WorkspaceText text="online ·" /> {categories.length}{" "}
            <WorkspaceText text={categories.length === 1 ? "category" : "categories"} />
          </p>

        {data.services.length === 0 ? (
          <section className="services-page__empty">
            <h2><WorkspaceText text="No services yet" /></h2>
            <p><WorkspaceText text="Create the first service when the salon catalog is ready." /></p>
          </section>
        ) : visibleServices.length === 0 ? (
          <section className="services-page__empty">
            <h2><WorkspaceText text="No matching services" /></h2>
            <p><WorkspaceText text="Try a different search, category, or status." /></p>
          </section>
        ) : (
          <section className="services-list" aria-label={__vt("Salon services")}>
            <div className="services-list__header" aria-hidden="true">
              <span><WorkspaceText text="Service" /></span>
              <span><WorkspaceText text="Price" /></span>
              <span><WorkspaceText text="Duration" /></span>
              <span><WorkspaceText text="Active" /></span>
              <span><WorkspaceText text="Online booking" /></span>
              <span><WorkspaceText text="Booking staff" /></span>
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
                        <strong><WorkspaceText text={config.name || "Untitled service"} /></strong>
                        <span><WorkspaceText text={config.category || "Uncategorized"} /></span>
                        {dirty ? <em><WorkspaceText text="Unsaved" /></em> : null}
                      </div>
                      <div className="service-row__value" data-label="Price">
                        {money(config.basePrice)}
                      </div>
                      <div className="service-row__value" data-label="Duration">
                        {config.durationMinutes} <WorkspaceText text="min" />
                      </div>
                      <div className="service-row__state" data-label="Active">
                        {data.canManage ? (
                          <Toggle
                            checked={config.isActive}
                            disabled={isPending}
                            label={__vt(`Set ${config.name} active state`)}
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
                            {config.isActive ? <WorkspaceText text="Active" /> : <WorkspaceText text="Inactive" />}
                          </span>
                        )}
                      </div>
                      <div className="service-row__state" data-label="Online booking">
                        {data.canManage ? (
                          <div className="service-row__toggle-with-label">
                            <Toggle
                              checked={config.onlineBookingEnabled}
                              disabled={isPending || !config.isActive}
                              label={__vt(`Enable online booking for ${config.name}`)}
                              onChange={(checked) =>
                                updateService(service, {
                                  onlineBookingEnabled: checked,
                                })
                              }
                            />
                            <span data-state={readiness.needsSetup ? "warning" : undefined}>
                              <WorkspaceText text={readiness.label} />
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
                            <WorkspaceText text={readiness.label} />
                          </span>
                        )}
                      </div>
                      <div className="service-row__staff" data-label="Booking staff">
                        <WorkspaceText text={config.bookingStaffIds.length > 0
                          ? `${config.bookingStaffIds.length} staff`
                          : "—"} />
                      </div>
                      <button
                        aria-expanded={expanded}
                        aria-label={__vt(`${expanded ? "Close" : data.canManage ? "Edit" : "View"} ${config.name}`)}
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
                        <WorkspaceText text={serviceErrors[service.id]} />
                      </p>
                    ) : null}

                    {expanded ? (
                      <>
                        <ServiceEditor
                          canManage={data.canManage && !isPending}
                          config={config}
                          data={data}
                          onChange={(patch) => updateService(service, patch)}
                        />
                        {data.canManage ? <div className="service-editor__actions">
                          <span aria-live="polite"><WorkspaceText text={dirty ? "Unsaved changes" : "All changes saved"}/></span>
                          <div><button className="services-button services-button--secondary" type="button" disabled={isPending || !dirty} onClick={() => {
                            setDrafts(current => {const next={...current};delete next[service.id];return next;});
                            setServiceErrors(current => {const next={...current};delete next[service.id];return next;});setMessage(null);
                          }}><WorkspaceText text="Cancel"/></button>
                          <button className="services-button services-button--primary" type="button" disabled={isPending || !dirty} onClick={() => saveAll(service.id)}><WorkspaceText text={isPending ? "Saving..." : "Save changes"}/></button></div>
                        </div> : null}
                        {data.canManage ? <DeleteUnusedButton expectedSalonId={expectedSalonId} kind="services" id={service.id} name={config.name} onDeleted={async () => { await invalidateCatalogMutation(); await refreshAfterSave(); }} disabled={dirty || isPending} /> : null}
                      </>
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
              <strong>{dirtyIds.length}</strong> <WorkspaceText text="service" />
              <WorkspaceText text={dirtyIds.length === 1 ? " has" : "s have"} /> <WorkspaceText text="unsaved changes" />
            </p>
            <div>
              <button
                className="services-button services-button--secondary"
                disabled={isPending}
                onClick={discardAll}
                type="button"
              >
                <WorkspaceText text="Cancel" />
              </button>
              <button
                className="services-button services-button--primary"
                disabled={isPending}
                onClick={() => saveAll()}
                type="button"
              >
                <WorkspaceText text={isPending ? "Saving..." : "Save all changes"} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreate ? (
        <CreateServiceDrawer
          embedded={embedded}
          expectedSalonId={expectedSalonId}
          canManage={data.canManage}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      ) : null}
    </main>
  );
}
