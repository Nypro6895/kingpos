import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";

/** Compose beside the current Market & System workspace, without replacing it. */
export async function MembershipSettingsLinks() {
  const actor = await requirePlatformAdmin();
  if (!actor.permissions.includes(P.membershipRead)) return null;
  return <section className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3" aria-label="Membership settings links">
    <strong className="mr-auto text-sm font-medium">Reylumi Membership</strong>
    <Link className="text-sm underline" href="/admin/membership">Manage membership →</Link>
    <a className="text-sm underline" href="/membership" target="_blank" rel="noopener">View membership website ↗</a>
  </section>;
}
