import Link from "next/link";
import { withExperiencePage } from "@/components/experience-page";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";

async function AdminForumPage() {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.forumModerate);
  return <section className="mx-auto max-w-2xl space-y-5 py-8"><h1 className="text-2xl font-semibold">Owner forum</h1><p>Moderate discussions, review reports and restrict forum participation directly in the forum. Forum restrictions do not suspend salon, POS or account access.</p><Link className="inline-flex rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white" href="/forum?view=manage">Open forum moderation</Link><p>Moderators are assigned and revoked through the existing Platform Admin Team. Active Moderators can moderate content and restrict participation; Platform Owners and Operations Admins can also manage sections.</p><Link className="text-blue-600 underline" href="/admin/team">Manage platform team</Link></section>;
}
export default withExperiencePage(AdminForumPage, { admin: true });
