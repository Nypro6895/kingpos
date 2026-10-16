export const APP_LOCAL_PORTABLE_HTTP_READS = {
  "portable.http.workspace": { path: "/api/pos/portable/workspace", argumentKeys: ["resource", "ids", "date"] },
  "portable.http.staff": { path: "/api/pos/portable/staff", argumentKeys: ["ids"] },
  "portable.http.tickets": { path: "/api/pos/portable/tickets", argumentKeys: ["date"] },
  "portable.http.connection": { path: "/api/pos/connection", argumentKeys: [] },
} as const;
export const APP_LOCAL_PORTABLE_HTTP_COMMANDS = {
  "portable.http.operations": { path: "/api/pos/portable/operations", argumentKeys: ["input"], replay: "original-idempotent-outbox-only" },
  "portable.http.draft": { path: "/api/pos/portable/draft", argumentKeys: ["input"], replay: "original-versioned-draft-outbox-only" },
  "portable.http.prepare-device": { path: "/api/pos/portable/device", argumentKeys: ["input"], replay: "never" },
} as const;
