import type { ReactNode } from "react";
import type { Metadata } from "next";
import { AdminShell } from "@/app/(app)/admin/_components/admin-ui";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { loadAdminNavigationCounts } from "@/lib/platform-admin/dashboard-workspace";
import "./admin.css";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getAdminExperienceContext, getExperienceContext } from "@/lib/experience-context";
import { ExperienceScopeProvider } from "@/components/experience-scope";

export const metadata: Metadata = {
  icons: {
    icon: [{ url: "/brand/reylumi-admin-favicon.svg", type: "image/svg+xml", sizes: "any" }],
    shortcut: [{ url: "/brand/reylumi-admin-favicon.svg", type: "image/svg+xml", sizes: "any" }],
  },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const context = await requirePlatformAdmin(undefined, { loginNextPath: "/admin" });

  const counts = await loadAdminNavigationCounts();
  const experience = getAdminExperienceContext(getExperienceContext(await getRequestBusinessContext()), context);
  return <ExperienceScopeProvider key={experience.scope} context={experience}><AdminShell context={context} counts={counts}>{children}</AdminShell></ExperienceScopeProvider>;
}
