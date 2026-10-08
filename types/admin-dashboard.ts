import type { BusinessClaimRequest } from "@/lib/business-claims";
import type { SalonVerificationRequest } from "@/lib/salon-identity";
import type { SupportThreadDetail } from "@/lib/platform-admin/inbox";
import type { PlatformAdminReportDetail } from "@/lib/platform-admin/reports";
import type { PlatformAdminUserDetail } from "@/lib/platform-admin/users";
import type { PlatformAdminNoteItem } from "./platform-admin";

export type DashboardSafetyCase = {
  id: string; reason: string; source_type: string; source_id: string; origin: "automatic" | "user";
  created_at: string; author_user_id: string | null; platform_report_id: string | null;
  matched_keywords: string[]; content_snapshot: { title?: string; caption?: string; media_path?: string };
  status: string; media?: Array<{ bucket: string; path: string }>;
};
export type DashboardRecoveryCase = {
  id: string; user_id: string; request_type: string; status: string; priority: string; risk_level: string;
  assigned_to_user_id: string | null; details: string | null; resolution_summary: string | null;
  contact_email: string | null; contact_phone: string | null; created_at: string;
};
export type DashboardDetail = (
  | { kind: "claims"; request: BusinessClaimRequest; canApprove: boolean; notes: PlatformAdminNoteItem[] }
  | { kind: "verification"; request: SalonVerificationRequest; latest: boolean; notes: PlatformAdminNoteItem[] }
  | { kind: "inbox"; detail: SupportThreadDetail; emailReady: boolean; emailFrom: string }
  | { kind: "cases"; detail: PlatformAdminReportDetail; assignees: Array<{ id: string; name: string; role: string }> }
  | { kind: "post_safety"; detail: DashboardSafetyCase; mediaUrls: string[] }
  | { kind: "pending_deletion"; detail: PlatformAdminUserDetail }
  | { kind: "recovery"; detail: DashboardRecoveryCase; events: Array<{ id: string; event_type: string; note: string | null; created_at: string }> }
) & { permissions: string[] };
