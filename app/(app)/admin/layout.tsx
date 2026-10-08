import type { ReactNode } from "react";
import { AdminShell } from "@/app/(app)/admin/_components/admin-ui";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { loadAdminNavigationCounts } from "@/lib/platform-admin/dashboard-workspace";
import "./admin.css";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const context = await requirePlatformAdmin(undefined, { loginNextPath: "/admin" });

  const counts = await loadAdminNavigationCounts();
  return <AdminShell context={context} counts={counts}>{children}</AdminShell>;
}
