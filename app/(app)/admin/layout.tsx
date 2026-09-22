import type { ReactNode } from "react";
import { AdminShell } from "@/app/(app)/admin/_components/admin-ui";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const context = await requirePlatformAdmin(undefined, { loginNextPath: "/admin" });

  return <AdminShell context={context}>{children}</AdminShell>;
}
