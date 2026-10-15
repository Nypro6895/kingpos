import type { AdminFollowup } from "@/lib/platform-admin/attention";
import type { PlatformAdminPermission, PlatformAdminNoteItem } from "./platform-admin";
export type DashboardRecord = {
  kind: "user" | "location" | "business"; id: string; name: string; status: string; createdAt: string; href: string;
  facts: Array<{ label: string; value: string | null }>;
  links: Array<{ label: string; href: string }>;
  followup: AdminFollowup | null; assignees: Array<{ id: string; name: string }>;
  activity: Array<{ id: string; title: string; reason: string | null; createdAt: string; actor: string | null }>;
  notes: PlatformAdminNoteItem[]; permissions: PlatformAdminPermission[];
  errors: string[]; ownAccount: boolean;
  deletion: { blocked: boolean; salons: Array<{ id: string; name: string; last_owner: boolean; status: string }> } | null;
};
