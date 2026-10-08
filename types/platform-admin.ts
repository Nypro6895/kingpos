export const PLATFORM_ADMIN_ROLE_SLUGS = [
  "platform_owner",
  "operations_admin",
  "support_agent",
  "moderator",
  "auditor",
] as const;

export type PlatformAdminRoleSlug = (typeof PLATFORM_ADMIN_ROLE_SLUGS)[number];

export const PLATFORM_ADMIN_MEMBERSHIP_STATUSES = [
  "active",
  "suspended",
  "revoked",
] as const;

export type PlatformAdminMembershipStatus =
  (typeof PLATFORM_ADMIN_MEMBERSHIP_STATUSES)[number];

export const PLATFORM_ADMIN_PERMISSIONS = {
  access: "admin.access",
  auditRead: "admin.audit.read",
  businessesRead: "admin.businesses.read",
  businessesUpdate: "admin.businesses.update",
  businessesUpdateStatus: "admin.businesses.update_status",
  dashboardRead: "admin.dashboard.read",
  locationsRead: "admin.locations.read",
  locationsUpdate: "admin.locations.update",
  locationsUpdateStatus: "admin.locations.update_status",
  notesRead: "admin.notes.read",
  notesCreate: "admin.notes.create",
  recoveryRead: "admin.recovery.read",
  recoveryManage: "admin.recovery.manage",
  reportsAssign: "admin.reports.assign",
  reportsCreate: "admin.reports.create",
  reportsRead: "admin.reports.read",
  reportsResolve: "admin.reports.resolve",
  reportsUpdate: "admin.reports.update",
  teamRead: "admin.team.read",
  teamManage: "admin.team.manage",
  usersRead: "admin.users.read",
  usersReadSensitive: "admin.users.read_sensitive",
  usersUpdate: "admin.users.update",
  usersRestore: "admin.users.restore",
  usersSuspend: "admin.users.suspend",
  usersDelete: "admin.users.delete",
  usersMembershipsManage: "admin.users.memberships.manage",
  notificationsRead: "admin.notifications.read",
  notificationsSend: "admin.notifications.send",
  inboxRead: "admin.inbox.read",
  inboxManage: "admin.inbox.manage",
  inboxReply: "admin.inbox.reply",
  advertisingManage: "admin.advertising.manage",
} as const;

export type PlatformAdminPermission =
  (typeof PLATFORM_ADMIN_PERMISSIONS)[keyof typeof PLATFORM_ADMIN_PERMISSIONS];

export type PlatformAdminContext = {
  membershipId: string;
  permissions: PlatformAdminPermission[];
  roleId: string;
  roleName: string;
  roleSlug: PlatformAdminRoleSlug;
  userId: string;
};

export type PlatformAdminAuditTargetType =
  | "support_inbox"
  | "platform_admin_business"
  | "platform_admin_location"
  | "platform_admin_membership"
  | "platform_admin_note"
  | "platform_admin_permission"
  | "platform_admin_report"
  | "platform_admin_role"
  | "platform_admin_test"
  | "platform_admin_user"
  | "system";

export const PLATFORM_REPORT_STATUSES = [
  "new",
  "under_review",
  "action_required",
  "resolved",
  "closed",
] as const;

export type PlatformReportStatus = (typeof PLATFORM_REPORT_STATUSES)[number];

export const PLATFORM_REPORT_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;

export type PlatformReportPriority = (typeof PLATFORM_REPORT_PRIORITIES)[number];

export type PlatformAdminPageResult<TItem> = {
  items: TItem[];
  page: number;
  page_size: number;
  total: number;
};

export type PlatformAdminUserListItem = {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  organization_count: number;
  last_login_at?: string | null;
  roles?: string[];
  businesses?: Array<{ id: string; name: string }>;
};

export type PlatformAdminBusinessListItem = {
  id: string;
  name: string;
  legal_name: string | null;
  owner_user_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  owner: {
    id: string | null;
    display_name: string | null;
    email: string | null;
    status: string | null;
  } | null;
  location_count: number;
  member_count: number;
};

export type PlatformAdminLocationListItem = {
  id: string;
  organization_id: string;
  organization_name: string;
  name: string;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type PlatformAdminReportSubject = {
  id: string;
  label: string;
  status?: string | null;
  type: "business" | "location" | "user";
};

export type PlatformAdminReportAssignee = {
  membership_id: string;
  user_id: string;
  display_name: string | null;
  role_slug: PlatformAdminRoleSlug;
  role_name?: string | null;
  status: PlatformAdminMembershipStatus;
};

export type PlatformAdminReportListItem = {
  id: string;
  report_number: string;
  category: string;
  priority: PlatformReportPriority;
  status: PlatformReportStatus;
  summary: string;
  source: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  subject: PlatformAdminReportSubject | null;
  assignee: PlatformAdminReportAssignee | null;
};

export type PlatformAdminNoteItem = {
  id: string;
  body: string;
  target_type?: string;
  created_at: string;
  author: {
    id: string | null;
    display_name: string | null;
  } | null;
};

export type PlatformAdminAuditLogItem = {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_type: PlatformAdminAuditTargetType | string;
  target_id: string | null;
  reason: string | null;
  before_data: unknown;
  after_data: unknown;
  metadata: unknown;
  request_id: string | null;
  created_at: string;
  actor: {
    id: string | null;
    display_name: string | null;
  } | null;
};

export type PlatformAdminTeamItem = {
  id: string;
  user_id: string;
  user_display_name: string | null;
  user_email: string | null;
  user_status: string;
  role_id: string;
  role_slug: PlatformAdminRoleSlug;
  role_name: string;
  status: PlatformAdminMembershipStatus;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PlatformAdminDashboard = {
  businesses: {
    by_status: Record<string, number>;
    total: number;
  };
  locations: {
    by_status: Record<string, number>;
    total: number;
  };
  recent_audit: Array<{
    id: string;
    action: string;
    target_type: string;
    target_id: string | null;
    reason: string | null;
    created_at: string;
    actor: {
      id: string | null;
      display_name: string | null;
    } | null;
  }>;
  reports: {
    assigned_to_me: number;
    open: number;
    urgent_or_high: number;
  };
  users: {
    active: number;
    new_30d: number;
    suspended: number;
    total: number;
  };
};
