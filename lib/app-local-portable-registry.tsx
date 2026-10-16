"use client";
import { AppLocalPortableWorkspace } from "@/components/app-local-portable-workspace";
import { APP_LOCAL_PORTABLE_ROUTES } from "./app-local-portable-metadata";
import type { AppLocalPage } from "./app-local-page-registry";
export function getAppLocalPortablePage(path: string): AppLocalPage | null {
  try {
    if (!path.startsWith("/") || path.startsWith("//") || /\\|%2f|%5c|%00/i.test(path) || path.length > 4096) return null;
    const url = new URL(path, "https://reylumi.com");
    if (!(APP_LOCAL_PORTABLE_ROUTES as readonly string[]).includes(url.pathname)) return null;
    if ([...url.searchParams].some(([key, value]) => !["date", "q", "error"].includes(key) || value.length > 512 || url.searchParams.getAll(key).length !== 1)) return null;
    return { id: "portable", title: "Portable POS", requiresContext: true, Component: AppLocalPortableWorkspace, features: ["original-device-session-authority", "original-pos-checkin-book-ticket-report", "retained-panels", "original-outbox-and-revision-checks", "original-capability-gates"] };
  } catch { return null; }
}
