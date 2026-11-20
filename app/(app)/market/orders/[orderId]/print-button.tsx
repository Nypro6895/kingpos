"use client";
export function PrintOrderButton() {
  return <button type="button" onClick={() => window.print()} className="min-h-11 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-semibold text-white print:hidden">Print / save PDF</button>;
}
