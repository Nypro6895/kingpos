import type { MouseEventHandler } from "react";

export function PortableCustomerAction({ action, name, onClick }: {
  action: "edit" | "left" | "remove"; name: string; onClick: MouseEventHandler<HTMLButtonElement>;
}) {
  const label = { edit: "Edit", left: "Left salon", remove: "Remove" }[action];
  const accessible = { edit: `Edit ${name}`, left: `${name} left`, remove: `Remove ${name}` }[action];
  return <button type="button" aria-label={accessible} title={label} onClick={onClick}
    className={`flex min-h-16 min-w-16 flex-col items-center justify-center gap-1 rounded-xl border border-zinc-200 bg-white px-2 py-2 text-xs font-semibold shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${action === "remove" ? "text-red-700 hover:bg-red-50" : "text-zinc-700 hover:bg-teal-50"}`}>
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {action === "edit" ? <path d="m15 4 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14v6Z" /> : action === "left" ? <><path d="M10 4H4v16h6M9 12h12m-4-4 4 4-4 4" /></> : <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></>}
    </svg>
    {label}
  </button>;
}
