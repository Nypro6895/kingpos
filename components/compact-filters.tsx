import type { ReactNode } from "react";

/** Keeps filter controls mounted so forms retain their values while collapsed. */
export function CompactFilters({
  children,
  label = "Filters",
  active = false,
}: {
  children: ReactNode;
  label?: string;
  active?: boolean;
}) {
  return (
    <details className="group min-w-0 max-w-full">
      <summary
        aria-label={active ? `${label}: filters applied` : label}
        title={label}
        className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 [&::-webkit-details-marker]:hidden"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 7h16M7 12h10M10 17h4" />
        </svg>
        <span className="sr-only">{label}</span>
        {active ? <span aria-hidden="true" className="h-2 w-2 rounded-full bg-teal-600" /> : null}
      </summary>
      <div className="mt-2 min-w-0 rounded-lg border border-zinc-200 bg-white p-3 [&_input]:max-w-full [&_select]:max-w-full">
        <p className="mb-3 text-sm font-semibold text-zinc-900">{label}</p>
        {children}
      </div>
    </details>
  );
}
