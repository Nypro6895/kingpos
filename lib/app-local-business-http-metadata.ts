export const APP_LOCAL_BUSINESS_HTTP_READS = {
  "http.business-claims.matches": { path: "/api/business-claims/matches", method: "GET", argumentKeys: ["name", "phone", "address", "unit", "city", "state"], access: "scoped", retention: "none" },
} as const;
