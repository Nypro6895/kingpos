"use client";
import "./staff-appointments.css";
import { useEffect, useId, useState } from "react";

type Customer = { id: string; name: string; phone: string | null };

export function StaffCustomerFields({ salonId, disabled }: { salonId: string; disabled: boolean }) {
  const listId = useId();
  const [name, setName] = useState(""), [phone, setPhone] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState(""), [focused, setFocused] = useState<"name" | "phone" | null>(null);
  const [results, setResults] = useState<Customer[]>([]), [active, setActive] = useState(-1);
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!focused || query.trim().length < 2) return;
    const controller = new AbortController();
    let current = true;
    const timer = setTimeout(async () => {
      setStatus("Searching customers…");
      try {
        const response = await fetch("/api/staff/create-appointment", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ action: "customers", salonId, query }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error("Search unavailable");
        if (current) { setResults(data); setStatus(data.length ? "" : "No matching customer. You can enter a new customer."); }
      } catch {
        if (current) setStatus("Customer search unavailable. You can still enter name and phone.");
      }
    }, 250);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [salonId, query, focused]);
  function choose(customer: Customer) {
    setName(customer.name); setPhone(customer.phone ?? ""); setSelectedId(customer.id);
    setQuery(""); setResults([]); setStatus(""); setActive(-1);
  }
  return <div className="staff-customer-fields" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setFocused(null); setResults([]); setStatus(""); }
  }}>
    <input type="hidden" name="customerId" value={selectedId}/>
    {(["name", "phone"] as const).map(field => <label key={field}>{field === "name" ? "Customer name" : "Phone"}
      <input name={field} type={field === "phone" ? "tel" : "text"} required maxLength={field === "name" ? 150 : 40}
        value={field === "name" ? name : phone} disabled={disabled} autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={focused === field && results.length > 0}
        aria-controls={listId} aria-activedescendant={focused === field && active >= 0 ? `${listId}-${active}` : undefined}
        onFocus={() => setFocused(field)} onChange={event => {
          (field === "name" ? setName : setPhone)(event.target.value); setSelectedId(""); setQuery(event.target.value);
          setResults([]); setActive(-1); setStatus(""); setFocused(field);
        }} onKeyDown={event => {
          if (event.key === "Escape" && (results.length || status)) { event.preventDefault(); event.stopPropagation(); setResults([]); setStatus(""); setQuery(""); }
          if (results.length && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setActive(i => (i + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length); }
          if (event.key === "Enter" && active >= 0 && results[active]) { event.preventDefault(); choose(results[active]); }
        }}/>
    </label>)}
    {results.length > 0 ? <div id={listId} role="listbox" aria-label="Salon customers" className="staff-customer-suggestions">
      {results.map((customer, index) => <button key={customer.id} id={`${listId}-${index}`} type="button" role="option" aria-selected={active === index}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(customer)} disabled={disabled}>
        <span>{customer.name}</span><small>{customer.phone || "No phone on file"}</small>
      </button>)}
    </div> : null}
    {status ? <p role="status">{status}</p> : null}
  </div>;
}
