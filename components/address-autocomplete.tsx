"use client";

import { useEffect, useId, useRef, useState } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import type { AddressSuggestion } from "@/lib/location/address-suggestions-data";

export function AddressAutocomplete({ defaultValue = "", label = "Address", name = "address_line1", id: suppliedId,
  className, required, mode = "address", onValueChange }: {
  defaultValue?: string | null; label?: string; name?: string; id?: string; className?: string; required?: boolean;
  mode?: "address" | "area"; onValueChange?: (value: string) => void;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const listId = `${id}-suggestions`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue ?? "");
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [result, setResult] = useState<{ query: string; suggestions: AddressSuggestion[]; available: boolean }>({ query: "", suggestions: [], available: true });
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const sequence = useRef(0);
  const query = value.trim();
  const options = result.query === query && focused && !dismissed && !composing ? result.suggestions : [];

  useEffect(() => {
    const form = inputRef.current?.form;
    const reset = () => {
      ++sequence.current; setValue(defaultValue ?? ""); setDismissed(true); setActive(-1);
      onValueChange?.(defaultValue ?? "");
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue, onValueChange]);

  useEffect(() => {
    const current = ++sequence.current;
    if (!focused || composing || dismissed || query.length < 3) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const deadline = setTimeout(() => {
        abort.abort();
        if (current === sequence.current) setResult({ query, suggestions: [], available: false });
      }, 5000);
      try {
        const countryInput = inputRef.current?.form?.elements.namedItem("country");
        const country = countryInput instanceof HTMLInputElement ? countryInput.value.trim() : "";
        const response = await fetch("/api/location/suggestions", { method: "POST", signal: abort.signal,
          cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, mode, country }) });
        if (!response.ok) throw new Error("Unavailable");
        const data = await response.json();
        if (current !== sequence.current || abort.signal.aborted) return;
        const suggestions = Array.isArray(data.suggestions) ? data.suggestions.filter((row: AddressSuggestion) => row
          && ["id", "label", "addressLine1", "city", "state", "postalCode", "country"].every(key => typeof row[key as keyof AddressSuggestion] === "string" && row[key as keyof AddressSuggestion].length <= 240)).slice(0, 6) : [];
        setResult({ query, suggestions, available: data.available === true });
      } catch {
        if (current === sequence.current && !abort.signal.aborted) setResult({ query, suggestions: [], available: false });
      } finally { clearTimeout(deadline); }
    }, 300);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, mode, focused, composing, dismissed]);

  function select(option: AddressSuggestion) {
    ++sequence.current;
    // Explore's area contract is city/state or ZIP; the provider's country suffix
    // and street label must not become a fictitious city filter.
    const next = mode === "area" ? [option.city, option.state].filter(Boolean).join(", ") || option.postalCode || option.label : option.addressLine1;
    setValue(next); onValueChange?.(next); setDismissed(true); setActive(-1);
    if (mode === "address") {
      const form = inputRef.current?.form;
      for (const [field, content] of Object.entries({ city: option.city, state: option.state, postal_code: option.postalCode, country: option.country })) {
        const input = form?.elements.namedItem(field);
        if (!(input instanceof HTMLInputElement) || input.disabled || input.readOnly || input.type === "hidden") continue;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, content);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    inputRef.current?.focus();
  }

  return <div className="relative min-w-0">
    <label htmlFor={id} className="mb-1 block text-sm font-medium"><WorkspaceText text={label} /></label>
    <input ref={inputRef} id={id} name={name} value={value} required={required} maxLength={200}
      autoComplete={mode === "address" ? "address-line1" : "off"} role="combobox" aria-autocomplete="list"
      aria-expanded={options.length > 0} aria-controls={listId} aria-activedescendant={active >= 0 && options[active] ? `${listId}-${active}` : undefined}
      className={className ?? "min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-950 outline-none focus:border-zinc-950"}
      onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setActive(-1); }}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
      onChange={event => { setValue(event.target.value); onValueChange?.(event.target.value); setDismissed(false); setActive(-1); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape" && options.length) { event.preventDefault(); event.stopPropagation(); setDismissed(true); setActive(-1); }
        else if (event.key === "ArrowDown" && options.length) { event.preventDefault(); setActive(index => (index + 1) % options.length); }
        else if (event.key === "ArrowUp" && options.length) { event.preventDefault(); setActive(index => (index <= 0 ? options.length : index) - 1); }
        else if (event.key === "Enter" && active >= 0 && options[active]) { event.preventDefault(); select(options[active]); }
      }} />
    <ul id={listId} role="listbox" aria-label={label} hidden={!options.length}
      className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
      {options.map((option, index) => <li key={option.id} id={`${listId}-${index}`} role="option" aria-selected={active === index}
        className={`cursor-pointer rounded-lg px-3 py-3 text-sm text-zinc-900 ${active === index ? "bg-emerald-50" : "hover:bg-zinc-50"}`}
        onPointerDown={event => event.preventDefault()} onClick={() => select(option)}>{option.label}</li>)}
      {options.length ? <li role="presentation" className="px-3 py-1 text-[10px] text-zinc-500">© MapTiler © OpenStreetMap contributors</li> : null}
    </ul>
    {focused && !dismissed && result.query === query && !result.available ? <p role="status" className="mt-1 text-xs text-zinc-500"><WorkspaceText text="Address suggestions are unavailable. You can still enter your address manually." /></p> : null}
  </div>;
}
