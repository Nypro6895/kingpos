import { RecoveryBackOfficePanel } from "@/app/settings/recovery-back-office/recovery-back-office-panel";
import {
  AdminPageHeader,
  AdminSection,
  SecondaryLink,
} from "@/app/(app)/admin/_components/admin-ui";
import { loginHrefForReturnPath } from "@/lib/auth-routing";
import { loadRecoveryBackOfficeOverview } from "@/lib/account-security-backoffice";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { notFound, redirect } from "next/navigation";

export default async function AdminRecoveryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.recoveryRead, {
    loginNextPath: "/admin/recovery",
  });

  const params = await searchParams;
  const requestId = typeof params.case === "string" ? params.case : undefined;
  if (requestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) notFound();
  const overview = await loadRecoveryBackOfficeOverview(requestId);

  if (!overview) {
    redirect(loginHrefForReturnPath("/admin/recovery"));
  }

  if (!overview.authorized) {
    return (
      <>
        <AdminPageHeader eyebrow="Recovery" title="Recovery Back Office">
          Account recovery queue and emergency account security review.
        </AdminPageHeader>
        <AdminSection title="Access Restricted">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm leading-6 text-zinc-600">
            {overview.reason}
          </div>
        </AdminSection>
      </>
    );
  }

  return (
    <>
      <AdminPageHeader
        actions={
          requestId ? <SecondaryLink href="/admin/recovery">View all recovery cases</SecondaryLink> : <SecondaryLink href="/settings/recovery-back-office">Settings view</SecondaryLink>
        }
        eyebrow="Recovery"
        title="Recovery Back Office"
      >
        Review account recovery cases, inspect login security context, secure
        sessions, and record support decisions.
      </AdminPageHeader>
      <div className="mt-6">
        <RecoveryBackOfficePanel overview={overview} />
      </div>
    </>
  );
}
