import type { MarketApp } from "./sample-apps";
import styles from "./market.module.css";

// Original vector marks for fictional publishers; kept crisp at every UI size.
export function AppLogo({ app }: { app: MarketApp }) {
  const marks: Record<string, React.ReactNode> = {
    "salon-chat": <><path d="M4 5h17v14H11l-5 5v-5H4zM10 24h10l5 4V12h-4" /><path d="M8 10h9M8 14h6" /></>,
    "sms-connect": <><rect x="8" y="3" width="15" height="26" rx="3" /><path d="M12 6h7M14 25h3M3 10h15v9h-7l-4 3v-3H3z" /></>,
    "merchant-rate": <><rect x="3" y="6" width="24" height="18" rx="4" /><path d="M3 12h24M8 19h4m5-3 4 4 4-4M21 14v6" /></>,
    "auto-backup": <><path d="m15 3 10 4v9c0 6-5 10-10 13C10 26 5 22 5 16V7z" /><path d="M10 15a5 5 0 1 1 0 6M8 12v5h5m2-6v5l3 2" /></>,
    "tax-company": <><path d="M7 3h12l5 5v21H7zM19 3v6h5M11 13h9M11 17h9M11 21h4" /><path d="M4 11v16M18 25l2 2 4-5" /></>,
    "custom-payroll": <><path d="M5 7h20M5 16h20M5 25h20" /><circle cx="10" cy="7" r="3" fill="currentColor" stroke="none" /><circle cx="20" cy="16" r="3" fill="currentColor" stroke="none" /><circle cx="12" cy="25" r="3" fill="currentColor" stroke="none" /></>,
    "facebook-connect": <><circle cx="7" cy="9" r="4" /><circle cx="23" cy="9" r="4" /><circle cx="15" cy="25" r="4" /><path d="M11 9h8M9 13l4 8M21 13l-4 8" /></>,
    "ai-marketing": <><path d="m4 14 15-6v17L4 19zM19 12l6-4M21 17h6M21 22l5 4M7 20l3 8h4l-3-7" /><path d="m10 2 1 3 3 1-3 1-1 3-1-3-3-1 3-1z" /></>,
    "qr-ticket": <><rect x="3" y="3" width="9" height="9" rx="1" /><rect x="18" y="3" width="9" height="9" rx="1" /><rect x="3" y="20" width="9" height="9" rx="1" /><path d="M7 7h1M22 7h1M7 24h1M18 18h4v4h5v7h-9v-3M15 15h-4M3 16h3M16 4v8M16 23v-5" /></>,
    "customer-import": <><circle cx="11" cy="10" r="5" /><path d="M3 27v-4a8 8 0 0 1 16 0v4M20 9h8m-4-4 4 4-4 4M22 18h5M22 23h5" /></>,
    "gift-card": <><rect x="3" y="10" width="24" height="18" rx="3" /><path d="M3 17h24M15 10v18M15 10c-12 0-9-11-3-6l3 6c12 0 9-11 3-6z" /></>,
    "membership": <><rect x="3" y="7" width="24" height="20" rx="4" /><path d="m9 14 3 3 3-5 3 5 3-3-2 7H11zM8 3h14" /></>,
    "rewards": <><circle cx="15" cy="16" r="12" /><path d="m15 8 2.4 5 5.6.8-4 4 .9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-4 5.6-.8z" /></>,
    "website-layout": <><rect x="3" y="4" width="24" height="24" rx="3" /><path d="M3 10h24M8 7h1M12 7h1M7 14h8v10H7zM19 14h4M19 19h4M19 24h4" /></>,
    "online-store": <><path d="M5 13h20l-2-8H7zM6 13v15h18V13M11 28v-9h8v9M6 13c0 4 5 4 5 0 0 4 8 4 8 0 0 4 5 4 5 0" /><path d="M11 5v8M19 5v8" /></>,
    "promotion": <><path d="m3 17 13-13h11v11L14 28z" /><circle cx="22" cy="9" r="1.5" /><path d="m11 15 7 7" /><circle cx="16" cy="14" r="1.5" /><circle cx="11" cy="21" r="1.5" /></>,
    "print-check": <><path d="M8 7h12v6H8zM7 21h14V11H7z" /><path d="m10 16 3 3 5-6M10 4h8" /></>,
    "inventory-sync": <><path d="m5 11 9-5 9 5v10l-9 5-9-5zM5 11l9 5 9-5M14 16v10" /><path d="M17 4c5-3 7 0 5 3-2 2-4 1-5-3Z" /></>,
    "return-visit": <><path d="M8 10a8 8 0 1 1-2 8M5 7v6h6" /><path d="M14 18c-6-3-6-7-3-7 2 0 3 2 3 2s1-2 3-2c3 0 3 4-3 7Z" /></>,
    "salon-insights": <><path d="M6 23V14M13 23V9M20 23V5M4 26h20" /><path d="m5 9 7-5 5 1 6-4" /></>,
    "team-calendar": <><rect x="5" y="7" width="20" height="19" rx="4" /><path d="M5 13h20M10 4v6M20 4v6m-9 10 3 3 5-6" /></>,
    "review-studio": <><path d="M24 17c0 5-4 8-10 8l-7 3 1-5c-4-2-5-5-5-8 0-6 5-10 11-10 4 0 7 1 9 4" /><path d="m21 3 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5zM8 15h10M8 19h6" /></>,
  };
  return <span className={`${styles.icon} ${styles[app.color]} ${styles.logo}`} aria-hidden="true"><svg viewBox="0 0 30 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{marks[app.id]}</svg></span>;
}
