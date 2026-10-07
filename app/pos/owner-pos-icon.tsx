import type { ReactNode } from "react";

export type OwnerPosIconName = "more" | "checkin" | "pos" | "ticket" | "report" | "booking" | "settings" | "services" | "employees" | "tip" | "discount";

export function OwnerPosIcon({ name }: { name: OwnerPosIconName }) {
  const paths: Record<OwnerPosIconName, ReactNode> = {
    more: <path d="M4 6h16M4 12h16M4 18h16" />,
    checkin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    pos: <><rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8m-4-4v4M7 8h10M7 12h6" /></>,
    ticket: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z" /><path d="M9 8h6m-6 4h6" /></>,
    report: <path d="M4 21V12h3v9m4 0V4h3v17m4 0V8h3v13" />,
    booking: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 2v6m10-6v6M3 10h18M7 14h2m4 0h2m2 3h-2m-6 0H7" /></>,
    settings: <><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z" /><circle cx="12" cy="12" r="3" /></>,
    services: <><circle cx="6" cy="18" r="3" /><circle cx="18" cy="18" r="3" /><path d="m8 16 11-13M16 16 5 3m6 7 2 2" /></>,
    employees: <><circle cx="12" cy="7" r="3" /><circle cx="4" cy="9" r="2" /><circle cx="20" cy="9" r="2" /><path d="M6 21v-4a6 6 0 0 1 12 0v4M1 20v-4a4 4 0 0 1 4-4m18 8v-4a4 4 0 0 0-4-4" /></>,
    tip: <><circle cx="15" cy="6" r="4" /><path d="M15 3v6m2-5h-3a1 1 0 0 0 0 2h2a1 1 0 0 1 0 2h-3M2 14h4v8H2m4-2h9l7-6c-1-2-3-1-5 1h-5m-6-1 4-3 5 2c2 1 1 3-1 3h-4" /></>,
    discount: <><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M4 20 20 4" /></>,
  };
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
