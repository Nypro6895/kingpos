"use client";

import { useEffect, useState } from "react";
import { searchCustomerMatches } from "./actions";

export function CustomerIdentityFields() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof searchCustomerMatches>>>([]);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const next = name.trim().length >= 2 || phone.replace(/\D/g, "").length >= 3
          ? await searchCustomerMatches({ name, phone, email }) : [];
        if (!active) return;
        setMatches(next); setError("");
        const automatic = next.filter(item => item.match.automatic);
        setChoice(automatic.length === 1 ? automatic[0].id : "");
      } catch { if (active) setError("Could not check matching customers. Retry before saving."); }
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [name, phone, email]);
  return <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
    <label className="sm:col-span-2">Customer name<input className="mt-1 w-full rounded-md border p-2" name="name" autoComplete="name" required value={name} onChange={e => { setName(e.target.value); setChoice(""); }} /></label>
    <label>Phone<input className="mt-1 w-full rounded-md border p-2" name="phone" type="tel" autoComplete="tel" value={phone} onChange={e => { setPhone(e.target.value); setChoice(""); }} /></label>
    <label>Email<input className="mt-1 w-full rounded-md border p-2" name="email" type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setChoice(""); }} /></label>
    <input type="hidden" name="existing_customer_id" value={choice === "new" ? "" : choice} />
    <input type="hidden" name="create_separate" value={choice === "new" ? "1" : ""} />
    {matches.length > 0 && <fieldset className="grid gap-2 border-y py-3 sm:col-span-2"><legend>Matching customers</legend>
      <p className="text-sm text-zinc-600">Use an existing profile to keep their history together.</p>
      {matches.map(item => <label className="flex items-start gap-2 text-sm" key={item.id}>
        <input type="radio" name="identity_choice" value={item.id} checked={choice === item.id} onChange={() => setChoice(item.id)} />
        <span>{item.name} · {item.phone}<span className="block text-xs text-zinc-500">{item.match.reason}{item.match.automatic ? " · Matched automatically" : ""}</span></span>
      </label>)}
      <label className="flex gap-2 text-sm"><input type="radio" name="identity_choice" value="new" checked={choice === "new"} onChange={() => setChoice("new")} />Create a separate customer</label>
    </fieldset>}
    {error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
  </div>;
}
