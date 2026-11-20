"use client";

import { useEffect, useId, useRef, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { serviceCategoryColor, serviceCatalogParent, type CatalogService } from "@/lib/pos-service-catalog";
import { searchTextMatches } from "@/lib/search-normalization";
import { usePortableServiceAddOns } from "@/lib/portable-service-preference";
import type { PosWorkspacePreferences } from "@/lib/pos-workspace-preferences";
import "./adaptive-pos-workspace.css";
import { LegacyServiceCatalog } from "./service-catalog-legacy";

type ServiceCatalogProps = {
  services: CatalogService[];
  preferences: Pick<PosWorkspacePreferences, "serviceCategoriesEnabled" | "serviceCategoryColors">;
  selectedId?: string | null;
  disabled?: boolean;
  customServiceDisabled?: boolean;
  onSelect: (id: string) => void;
  onSelectAddOn?: (id: string) => void;
  onCustomService?: () => void;
  compact?: boolean;
};

export function ServiceCatalog(props: ServiceCatalogProps) {
  return props.compact ? <CompactServiceCatalog {...props} /> : <LegacyServiceCatalog {...props} />;
}

function CompactServiceCatalog({ services, preferences, selectedId, disabled, customServiceDisabled, onSelect, onSelectAddOn, onCustomService }: ServiceCatalogProps) {
  const t = useWorkspaceTranslation();
  const showAddOns = usePortableServiceAddOns();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  useEffect(() => { if (searchOpen) search.current?.focus(); }, [searchOpen]);

  const main = services.filter(service => !service.booking_parent_service_id);
  const categories = [...new Set(main.map(service => service.category?.trim()).filter((name): name is string => Boolean(name)))];
  const activeCategory = category && categories.includes(category) ? category : null;
  const filtered = main.filter(service => (!activeCategory || service.category?.trim() === activeCategory) && searchTextMatches([service.name, service.category], query));
  const groups = new Map<string, CatalogService[]>();
  for (const service of filtered) {
    const key = service.category?.trim() || "";
    groups.set(key, [...(groups.get(key) ?? []), service]);
  }
  const ordered = preferences.serviceCategoriesEnabled
    ? [...[...groups].filter(([name]) => name).flatMap(([, items]) => items), ...(groups.get("") ?? [])]
    : filtered;
  const parent = serviceCatalogParent(services, selectedId);
  const addOns = parent && showAddOns ? services.filter(service => service.booking_parent_service_id === parent.id) : [];

  function closeSearch() {
    setQuery("");
    setSearchOpen(false);
    requestAnimationFrame(() => searchButton.current?.focus());
  }

  function tile(service: CatalogService, addOn = false) {
    const category = service.category?.trim() || "";
    const color = preferences.serviceCategoriesEnabled && category ? serviceCategoryColor(category, preferences.serviceCategoryColors) : null;
    return <button key={service.id} type="button" disabled={disabled} aria-pressed={addOn ? selectedId === service.id : parent?.id === service.id}
      data-pos-service-tile data-pos-service-id={service.id} data-pos-service-category={category || undefined} data-pos-requested-service={service.requested || undefined}
      title={category ? `${service.name} · ${category}` : service.name}
      onClick={() => addOn ? (onSelectAddOn ?? onSelect)(service.id) : onSelect(service.id)}
      style={color && !addOn ? { backgroundColor: color + "30", borderTop: "3px solid " + color } : undefined}>
      <span>{addOn && <span aria-hidden="true">+ </span>}{service.name}</span>
      {service.base_price != null && <small className="tabular-nums">{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(service.base_price) || 0)}</small>}
    </button>;
  }

  return <div data-pos-service-catalog data-pos-compact-catalog>
    <div className="pos-catalog-toolbar">
      {!searchOpen && <><h2><WorkspaceText text="Services" /></h2><div className="pos-catalog-categories" aria-label={t("Service categories")}>
        <button type="button" disabled={disabled} aria-pressed={!activeCategory} onClick={() => setCategory(null)}><WorkspaceText text="All" /></button>
        {categories.map(name => <button key={name} type="button" disabled={disabled} aria-pressed={activeCategory === name} onClick={() => setCategory(name)}>{name}</button>)}
      </div></>}
      {searchOpen && <><input id={searchId} ref={search} type="search" disabled={disabled} autoComplete="off" aria-label={t("Search services")} placeholder={t("Search services")}
        value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeSearch(); } }} />
        <button type="button" className="pos-catalog-icon" aria-label={t("Close search")} onClick={closeSearch}>×</button></>}
      <button ref={searchButton} type="button" className="pos-catalog-icon" hidden={searchOpen} disabled={disabled}
        aria-label={t("Search services")} title={t("Search services")} aria-expanded={searchOpen} aria-controls={searchOpen ? searchId : undefined} onClick={() => setSearchOpen(true)}>
        <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
      </button>
    </div>
    <div className="pos-catalog-scroll">
      <div data-pos-service-tiles>
        {ordered.map(service => tile(service))}
        {onCustomService && <button type="button" data-pos-custom-service disabled={disabled || customServiceDisabled} onClick={onCustomService}><span aria-hidden="true">+ </span><WorkspaceText text="Custom service" /></button>}
      </div>
      {!ordered.length && <p className="pos-catalog-empty"><WorkspaceText text={query || activeCategory ? "No matching services." : "Service catalog empty. Custom price entry stays available."} /></p>}
    </div>
      {parent && addOns.length > 0 && <section className="pos-catalog-addons" aria-label={`${t("Add-ons for")} ${parent.name}`}>
        <h3><WorkspaceText text="Add-ons for" /> <strong>{parent.name}</strong><small><WorkspaceText text="Optional" /></small></h3>
        <div data-pos-service-tiles>{addOns.map(service => tile(service, true))}</div>
      </section>}
  </div>;
}
