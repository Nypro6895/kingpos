"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PosDeskCustomer } from "@/types/pos-desk";
import styles from "./booking.module.css";
import { dismissPortableKeyboard } from "@/lib/portable-touch-input";

export type BookingCustomerSearch = (query: string) => Promise<PosDeskCustomer[]>;

export function CustomerLookup({ value, onChange, onSelect, search, label, placeholder, phone = false, className }: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (customer: PosDeskCustomer) => void;
  search: BookingCustomerSearch;
  label: string;
  placeholder?: string;
  phone?: boolean;
  className?: string;
}) {
  const id = useId();
  const sequence = useRef(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [result, setResult] = useState<{ query: string; rows: PosDeskCustomer[]; message: string } | null>(null);
  const query = value.trim();
  const ready = query.length >= 2;
  const current = result?.query === query ? result : null;
  const rows = current?.rows ?? [];
  const expanded = open && ready;

  useEffect(() => {
    const request = ++sequence.current;
    if (!open || !ready) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        if (!navigator.onLine) throw new Error("offline");
        const found = await search(query);
        if (cancelled || request !== sequence.current) return;
        setResult({ query, rows: found.slice(0, 10), message: found.length ? "" : "No matching customers in this salon. You can enter a new customer." });
      } catch {
        if (cancelled || request !== sequence.current) return;
        setResult({ query, rows: [], message: navigator.onLine ? "Unable to search customers. Please try again." : "Customer search needs an internet connection. You can enter customer details manually." });
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, query, ready, search]);

  function choose(customer: PosDeskCustomer) {
    dismissPortableKeyboard();
    ++sequence.current;
    setOpen(false);
    setResult(null);
    setActive(-1);
    onSelect(customer);
  }

  return <div className={`${styles.lookup} ${className ?? ""}`} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { ++sequence.current; setOpen(false); }
  }}>
    <input
      role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={expanded ? id : undefined}
      aria-activedescendant={expanded && rows[active] ? `${id}-${active}` : undefined}
      type={phone ? "tel" : "text"} autoComplete="off" placeholder={placeholder} value={value}
      onFocus={() => setOpen(true)}
      onChange={event => { ++sequence.current; setActive(-1); setResult(null); setOpen(true); onChange(event.target.value); }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); ++sequence.current; setOpen(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          if (rows.length) setActive(index => event.key === "ArrowDown" ? (index + 1) % rows.length : (index <= 0 ? rows.length - 1 : index - 1));
        }
        if (event.key === "Enter" && expanded && rows[active]) { event.preventDefault(); choose(rows[active]); }
      }}
    />
    {expanded && <div className={styles.customerPopover}>
      <div className={styles.customerPopoverHeading}>Customers in this salon</div>
      <ul id={id} role="listbox" aria-label="Matching customers">
        {rows.map((customer, index) => <li key={customer.id} id={`${id}-${index}`} role="option" aria-selected={index === active}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(customer)}>
          <strong>{customer.name || "Unnamed customer"}</strong>
          <span>{[customer.phone, customer.email].filter(Boolean).join(" · ") || "No contact details"}</span>
        </li>)}
      </ul>
      {!rows.length && <p role="status">{current?.message || "Searching customers…"}</p>}
    </div>}
  </div>;
}
