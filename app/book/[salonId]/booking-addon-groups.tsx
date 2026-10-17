"use client";

import type { PublicBookingAddOnSelection, PublicBookingService } from "@/lib/public-booking";
import compact from "./booking-wizard.module.css";

export function BookingAddOnGroups({parentServiceId, options, selected, onChange}: {
  parentServiceId: string;
  options: PublicBookingService[];
  selected: PublicBookingAddOnSelection[];
  onChange: (selected: PublicBookingAddOnSelection[]) => void;
}) {
  const singleIds = new Set(options.filter(item => item.addOnGroup === "one").map(item => item.id));
  const hasSingle = selected.some(item => item.parentServiceId === parentServiceId && singleIds.has(item.serviceId));
  const withoutSingle = () => selected.filter(item => item.parentServiceId !== parentServiceId || !singleIds.has(item.serviceId));
  function toggle(service: PublicBookingService, add: boolean) {
    const remaining = service.addOnGroup === "one" && add ? withoutSingle() : selected;
    const next = remaining.filter(item => item.parentServiceId !== parentServiceId || item.serviceId !== service.id);
    onChange(add ? [...next, {parentServiceId, serviceId: service.id}] : next);
  }
  return <>
    {(["one", "many"] as const).map(group => {
      const items = options.filter(item => (item.addOnGroup ?? "many") === group);
      if (!items.length) return null;
      return <fieldset className={compact.staffGroup} key={group}>
        <legend>{group === "one" ? "Choose one" : "Choose multiple"} <span className={compact.muted}>&middot; Optional</span></legend>
        {group === "one" ? <div className={compact.service}><label><span>No add-on from this group</span>
          <input type="radio" name={`single-addon-${parentServiceId}`} className={compact.check} checked={!hasSingle} onChange={() => onChange(withoutSingle())}/>
        </label></div> : null}
        {items.map(service => {
          const checked = selected.some(item => item.parentServiceId === parentServiceId && item.serviceId === service.id);
          return <div className={compact.service} key={service.id}><label>
            <span><strong>{service.name}</strong><small className={compact.muted}>Adds {service.durationMinutes} min</small></span>
            <span>+{new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(service.basePrice)}</span>
            <input type={group === "one" ? "radio" : "checkbox"} name={group === "one" ? `single-addon-${parentServiceId}` : undefined}
              className={compact.check} checked={checked} disabled={!checked && selected.length >= 6 && !(group === "one" && hasSingle)}
              aria-label={service.name} onChange={event => toggle(service,event.target.checked)}/>
          </label></div>;
        })}
      </fieldset>;
    })}
    {selected.length >= 6 ? <p className={compact.muted}>Up to 6 extras per booking.</p> : null}
  </>;
}
