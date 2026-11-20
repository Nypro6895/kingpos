export const ADMIN_ICON_PATHS = {
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  business: "M3 9h18l-2-6H5ZM5 9v12h14V9M9 21v-7h6v7",
  salon: "M4 3l16 18M4 21 20 3M8 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M8 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  dashboard: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  reports: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H3l2-5a8.5 8.5 0 1 1 16-3.5ZM8 10h8M8 14h5",
  lock: "M5 10h14v11H5ZM8 10V6a4 4 0 0 1 8 0v4M12 14v3",
  mail: "M3 5h18v14H3ZM3 5l9 7 9-7",
  trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
  logout: "M10 3H4v18h6M8 12h13M16 7l5 5-5 5",
  edit: "M12 5 19 12M3 21l5-1L21 7l-5-5L3 15v6Z",
  flag: "M5 21V3M5 4h15l-3 5 3 5H5",
  history: "M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2",
  next: "m9 5 7 7-7 7", previous: "m15 5-7 7 7 7",
  calendar: "M3 5h18v16H3ZM7 3v4M17 3v4M3 10h18",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  refresh: "M20 7a9 9 0 1 0 1 10M21 2v6h-6",
  close: "m5 5 14 14M19 5 5 19",
  claims: "M8 3H5v18h14V3h-3M8 3v4h8V3ZM8 12h8M8 16h5",
  verification: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7ZM8 12l3 3 5-6",
  notifications: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  advertising: "M3 10v4h4l12 5V5L7 10ZM7 14l2 7h3l-2-6M22 9v6",
  audit: "M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1",
  attention: "M12 3 2 21h20ZM12 9v5M12 17v1",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M16 11h6",
  download: "M12 3v12M7 10l5 5 5-5M4 16v5h16v-5",
  more: "M4 12h1M11 12h1M18 12h1", plus: "M12 5v14M5 12h14",
} as const;
export type AdminIconName = keyof typeof ADMIN_ICON_PATHS;
export function AdminIcon({ name, size = 16, className }: { name: AdminIconName; size?: number; className?: string }) {
  return <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={ADMIN_ICON_PATHS[name]} /></svg>;
}
