export function DashboardIcon({ name, size = 16 }: { name: "users" | "business" | "salon" | "reports" | "lock" | "mail" | "trash" | "logout"; size?: number }) {
 const paths = {
 users: "M5 21v-3a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v3ZM16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
 business: "M4 21V3h12v18M16 8h4v13M8 7h4M8 11h4M8 15h4M2 21h20",
 salon: "M4 3l16 18M4 21 20 3M8 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M8 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
 reports: "M5 2h10l4 4v16H5ZM14 2v5h5M9 11h6M9 15h6M9 19h4",
 lock: "M5 10h14v11H5ZM8 10V6a4 4 0 0 1 8 0v4M12 14v3",
 mail: "M3 5h18v14H3ZM3 5l9 7 9-7",
 trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
 logout: "M10 3H4v18h6M8 12h13M16 7l5 5-5 5",
 };
 return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}
