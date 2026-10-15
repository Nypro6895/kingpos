"use client";
import { openAdminSupport } from "@/lib/admin-support-client";
export function AdminConversationButton({ reportId, children }: { reportId: string; children: React.ReactNode }) {
  return <button type="button" className="text-sm text-orange-700 underline" onClick={() => openAdminSupport(reportId)}>{children}</button>;
}
