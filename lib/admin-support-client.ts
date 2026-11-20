"use client";
export const ADMIN_SUPPORT_OPEN = "kingpos:admin-support-open";
export function openAdminSupport(reportId: string) {
  if (/^[0-9a-f-]{36}$/i.test(reportId)) window.dispatchEvent(new CustomEvent(ADMIN_SUPPORT_OPEN, { detail: reportId }));
}
