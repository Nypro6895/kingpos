/** Descriptive named reads. Every server adapter independently checks authority. */
export const APP_LOCAL_READ_RESOURCES = {
  "customer.activity": { endpoint: "/api/experience/customer", kind: "activity", domain: "customer-activity", scope: "viewer", params: [] },
  "customer.history": { endpoint: "/api/experience/customer", kind: "history", domain: "customer-history", scope: "viewer", params: ["bookingId", "ticketId"] },
  "customer.bookings": { endpoint: null, kind: "bookings", domain: "customer-bookings", scope: "viewer", params: ["tab", "details"] },
  "customer.saved-posts": { endpoint: null, kind: "saved-posts", domain: "customer-saved-posts", scope: "viewer", params: ["filter", "page", "q"] },
  "customer.following": { endpoint: null, kind: "following", domain: "customer-following", scope: "viewer", params: ["filter", "page", "q"] },
  "customer.favorites": { endpoint: null, kind: "favorites", domain: "customer-favorites", scope: "viewer", params: ["salons", "after"] },
  "staff.schedule": { endpoint: "/api/experience/staff", kind: "schedule", domain: "staff-schedule", scope: "staff-binding", params: ["staffId", "range", "status", "bookingId", "date", "quickId", "view"] },
  "staff.workday": { endpoint: "/api/experience/staff", kind: "workday", domain: "staff-workday", scope: "staff-binding", params: ["staffId"] },
  "staff.my-work": { endpoint: "/api/experience/my-work", kind: "my-work", domain: "staff-my-work", scope: "staff-binding", params: ["staffId", "tab", "payPeriodStart"] },
  "owner.today": { endpoint: "/api/experience/today", kind: "today", domain: "owner-today", scope: "workspace", params: ["date", "phase"] },
  "market.catalog": { endpoint: "/api/experience/market", kind: "market", domain: "market-catalog", scope: "viewer", params: [] },
} as const;
export type AppLocalRoleResourceName = keyof typeof APP_LOCAL_READ_RESOURCES;
export function isAppLocalRoleResourceName(name: string): name is AppLocalRoleResourceName { return Object.hasOwn(APP_LOCAL_READ_RESOURCES, name); }
