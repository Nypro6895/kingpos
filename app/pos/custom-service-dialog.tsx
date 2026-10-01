"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";

export function CustomServiceDialog({ onCancel, onDone }: { onCancel: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  const [shift, setShift] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const keyClass = "min-h-11 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white text-base font-medium shadow-sm transition hover:bg-orange-50 active:scale-95 focus-visible:outline-2 focus-visible:outline-orange-500";
  function type(text: string) {
    const start = input.current?.selectionStart ?? name.length;
    const end = input.current?.selectionEnd ?? start;
    const next = text === "Backspace" ? name.slice(0, start === end ? Math.max(0, start - 1) : start) + name.slice(end) : name.slice(0, start) + text + name.slice(end);
    setName(next.slice(0, 100));
    const caret = text === "Backspace" ? Math.max(0, start === end ? start - 1 : start) : Math.min(100, start + text.length);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(caret, caret); });
  }
  return createPortal(<div className="fixed inset-0 z-[95] grid place-items-center bg-black/40 p-4">
    <section role="dialog" aria-modal="true" aria-label="Custom service" className="w-full max-w-2xl rounded-2xl bg-zinc-50 p-5 shadow-2xl" onKeyDown={event => { if (event.key === "Escape") onCancel(); if (event.key === "Enter" && name.trim()) onDone(name.trim()); }}>
      <h2 className="text-lg font-semibold">Custom service</h2>
      <label className="mt-4 block text-sm font-medium" htmlFor="pos-custom-service-name">Service name</label>
      <input ref={input} id="pos-custom-service-name" autoFocus autoComplete="off" inputMode="none" maxLength={100} value={name} onChange={event => setName(event.target.value)} className="mb-4 mt-2 h-14 w-full rounded-xl border border-zinc-300 bg-white px-4 text-lg outline-orange-500" placeholder="Enter service name" />
      <div className="space-y-2" aria-label="Service keyboard">
        {["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"].map(row => <div key={row} className="flex justify-center gap-1.5">{[...row].map(char => <button key={char} type="button" className={keyClass} onPointerDown={event => event.preventDefault()} onClick={() => { type(shift ? char.toUpperCase() : char); if (/^[a-z]$/.test(char)) setShift(false); }}>{shift ? char.toUpperCase() : char}</button>)}</div>)}
        <div className="flex gap-1.5">
          <button type="button" aria-pressed={shift} className={keyClass} onPointerDown={event => event.preventDefault()} onClick={() => setShift(!shift)}>Shift</button>
          <button type="button" className={keyClass + " !flex-[3]"} onPointerDown={event => event.preventDefault()} onClick={() => type(" ")}>Space</button>
          {["-", "&", "."].map(char => <button key={char} type="button" className={keyClass} onPointerDown={event => event.preventDefault()} onClick={() => type(char)}>{char}</button>)}
          <button type="button" aria-label="Backspace" className={keyClass} onPointerDown={event => event.preventDefault()} onClick={() => type("Backspace")}>⌫</button>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" className="min-h-12 rounded-xl border bg-white px-6 font-semibold shadow-sm hover:bg-zinc-100 active:scale-95" onClick={onCancel}>Cancel</button>
        <button type="button" disabled={!name.trim()} className="min-h-12 rounded-xl bg-orange-600 px-6 font-semibold text-white shadow-sm hover:bg-orange-700 active:scale-95 disabled:opacity-40" onClick={() => { if (name.trim()) onDone(name.trim()); }}>Done</button>
      </div>
    </section>
  </div>, document.body);
}
