import Link from "next/link";
import { withExperiencePage } from "@/components/experience-page";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { loadMembershipWorkspace } from "@/lib/platform-admin/membership";
import { MembershipAdmin } from "./workspace";
import styles from "./membership.module.css";
async function MembershipAdminPage() {
  const actor = await requirePlatformAdmin(P.membershipRead, { loginNextPath: "/admin/membership" });
  let data;
  try { data = await loadMembershipWorkspace(); }
  catch { return <section className={styles.workspace}><h1>Reylumi Membership</h1><p role="alert">Membership data is unavailable. Apply the membership migration and check your permissions before making changes.</p><Link href="/admin/membership">Retry</Link></section>; }
  return <MembershipAdmin initial={data} canConfigure={actor.permissions.includes(P.membershipConfigure)} canManage={actor.permissions.includes(P.membershipManage)} />;
}
export default withExperiencePage(MembershipAdminPage, { admin: true });
