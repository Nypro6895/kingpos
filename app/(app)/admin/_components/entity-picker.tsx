"use client";
import { useEffect, useId, useState } from "react";

export function EntityPicker({ kind, name, label, required = false, defaultValue = "", defaultLabel = "" }: { kind: "user" | "business" | "location"; name: string; label: string; required?: boolean; defaultValue?: string; defaultLabel?: string }) {
  const listId = useId();
  const [query, setQuery] = useState(defaultLabel);
  const [selected, setSelected] = useState(defaultValue);
  const [items, setItems] = useState<Array<{ id: string; label: string }>>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (query.trim().length < 2 || selected) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch(`/admin/lookup?kind=${kind}&q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Search unavailable. Check your access or retry.");
        setItems((await response.json()).items);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Search unavailable."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, kind, selected]);
  return <div className="relative">
    <label className="grid gap-1 text-sm font-medium">{label}<input role="combobox" aria-autocomplete="list" aria-expanded={items.length > 0} aria-controls={listId} autoComplete="off" placeholder="Search by name…" value={query} required={required} pattern={required && !selected ? "(?!)" : undefined} title="Select a matching record from the search results." onChange={e => { setQuery(e.target.value); setSelected(""); setItems([]); setLoading(false); }} className="rounded-lg border border-zinc-300 px-3 py-2" /></label>
    <input name={name} type="hidden" value={selected} />
    {items.length > 0 && <ul id={listId} role="listbox" className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-white p-1 shadow-lg">{items.map(item => <li key={item.id} role="option" aria-selected={selected === item.id}><button type="button" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-orange-50 focus:bg-orange-50" onClick={() => { setSelected(item.id); setQuery(item.label); setItems([]); }}>{item.label}</button></li>)}</ul>}
    {loading && <p role="status" className="mt-1 text-xs text-zinc-500">Searching…</p>}
    {selected && <p className="mt-1 text-xs text-emerald-700">Selected <button type="button" className="ml-2 underline" onClick={() => { setSelected(""); setQuery(""); }}>Clear</button></p>}
    {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
  </div>;
}
