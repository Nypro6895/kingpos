"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PublicSalonProfileService } from "@/types/salon-profile";
import { preloadQuickBooking } from "@/lib/quick-booking-client";
import styles from "./service-menu.module.css";

export function ServiceMenu({services, canBook, bookingHref}: {
  services: PublicSalonProfileService[];
  canBook: boolean;
  bookingHref: (serviceId: string) => string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      const row = root.current?.querySelector('[data-selected="true"]');
      // Let a different row handle its own selection without shifting the tap target.
      if ((event.target as Element).closest('[data-service-row]')) return;
      if (row && !row.contains(event.target as Node)) setSelected(null);
    }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") setSelected(null); }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {document.removeEventListener("pointerdown", dismiss);document.removeEventListener("keydown", escape);};
  }, []);
  const groups = new Map<string, PublicSalonProfileService[]>();
  services.forEach(service => {
    const category = service.category?.trim() || "Services";
    groups.set(category, [...(groups.get(category) ?? []), service]);
  });
  return <div ref={root} className={styles.menu}>
    {[...groups].map(([category, items]) => <section key={category}>
      <h2 className={styles.category}>{category}</h2>
      <ul className={styles.list}>{items.map(service => {
        const open = selected === service.id;
        const panelId = `${id}-${service.id}`;
        return <li key={service.id} className={styles.item} data-service-row data-selected={open}>
          <button type="button" className={styles.row} aria-expanded={open} aria-controls={panelId} onClick={() => {
            setSelected(open ? null : service.id);
            if (!open && canBook) preloadQuickBooking(bookingHref(service.id));
          }}>
            <span className={styles.title}>{service.name}</span><span className={styles.leader} aria-hidden="true"/>
            <span className={styles.price}>{new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",minimumFractionDigits:Number.isInteger(service.basePrice)?0:2,maximumFractionDigits:2}).format(service.basePrice)}</span>
            <span className={styles.duration}>{service.durationMinutes} min</span>
          </button>
          {open ? <div id={panelId} className={styles.confirmation}>
            {service.description ? <p>{service.description}</p> : null}
            {canBook ? <div className={styles.prompt}><span>Book this service?</span>
              <a href={bookingHref(service.id)} className={styles.book} aria-label={`Book ${service.name}`}>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16m-12 5 3 3 5-5"/></svg>
                <span>Book</span>
              </a>
            </div> : <p>Online booking is not available in this view.</p>}
          </div> : null}
        </li>;
      })}</ul>
    </section>)}
  </div>;
}
