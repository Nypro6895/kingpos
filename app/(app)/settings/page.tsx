import {
  AllSettingsClient,
  type AllSettingsScope,
  type AllSettingsSection,
  type SettingSummaryItem,
  type SettingTone,
} from "@/app/settings/all-settings-client";
import {
  analyzeAccountDeletionImpact,
  type AccountDeletionImpact,
} from "@/lib/account-deletion";
import { loadLoginSecurityOverview } from "@/lib/account-security";
import { currentUserCanAccessRecoveryBackOffice } from "@/lib/account-security-backoffice";
import {
  getCurrentBusinessContext,
  isOwnerMembership,
  type CurrentBusinessContext,
  type CurrentWorkspaceOption,
} from "@/lib/current-context";
import { routes } from "@/lib/routes";
import { redirect } from "next/navigation";

type SettingsPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    scope?: string | string[];
  }>;
};

type PermissionCode =
  | "booking.view"
  | "customers.view"
  | "payroll.manage"
  | "payroll.view"
  | "reports.view"
  | "salon_profile.view"
  | "salon_settings.view"
  | "services.view"
  | "staff.view"
  | "tickets.manage"
  | "tickets.view";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeScope(value: string | string[] | undefined): AllSettingsScope {
  const scope = firstParam(value);

  if (
    scope === "account" ||
    scope === "business" ||
    scope === "salon" ||
    scope === "staff" ||
    scope === "danger"
  ) {
    return scope;
  }

  return "all";
}

function workspaceOpenHref(
  workspace: CurrentWorkspaceOption | null | undefined,
  destination: string,
) {
  if (!workspace) {
    return destination;
  }

  const params = new URLSearchParams({
    destination,
    workspace_id: workspace.id,
  });

  return `/workspace/open?${params.toString()}`;
}

function workspaceLabel(workspace: CurrentWorkspaceOption | null | undefined) {
  if (!workspace) {
    return "No salon selected";
  }

  return (
    workspace.salonName ??
    workspace.businessName ??
    workspace.accountName ??
    workspace.label
  );
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`) {
  return value === 1 ? `1 ${singular}` : `${value} ${pluralLabel}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDateTime(value: string | null | undefined, timezone: string | null) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || "America/Chicago",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function hasScopedPermission(
  context: CurrentBusinessContext,
  permissionCode: PermissionCode,
) {
  if (isOwnerMembership(context.currentMembership)) {
    return true;
  }

  return (
    context.permissionCodes.includes("*") ||
    context.permissionCodes.includes(permissionCode)
  );
}

function hasAnyScopedPermission(
  context: CurrentBusinessContext,
  permissionCodes: PermissionCode[],
) {
  return permissionCodes.some((permissionCode) =>
    hasScopedPermission(context, permissionCode),
  );
}

function summaryItem(
  label: string,
  value: string,
  tone: SettingTone = "neutral",
): SettingSummaryItem {
  return { label, tone, value };
}

async function loadAccountDeletionImpact() {
  try {
    return {
      impact: await analyzeAccountDeletionImpact(),
      loadError: undefined,
    };
  } catch (error) {
    return {
      impact: null,
      loadError:
        error instanceof Error
          ? error.message
          : "Account deletion status could not be loaded.",
    };
  }
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const [params, context, canAccessRecoveryBackOffice] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
    currentUserCanAccessRecoveryBackOffice(),
  ]);

  if (!context.user) {
    redirect("/login?next=/settings");
  }

  const [loginSecurityOverview, deletionImpactResult] = await Promise.all([
    loadLoginSecurityOverview(),
    loadAccountDeletionImpact(),
  ]);
  const query = firstParam(params.q)?.trim() ?? "";
  const activeScope = normalizeScope(params.scope);
  const ownerWorkspaces = context.workspaceOptions.filter(
    (workspace) => workspace.salonMode === "manage",
  );
  const staffWorkspaces = context.workspaceOptions.filter(
    (workspace) => workspace.salonMode === "staff",
  );
  const accountWorkspaces = context.workspaceOptions.filter(
    (workspace) => workspace.type === "account",
  );
  const ownerAccountMembership =
    context.accountMemberships.find(
      (membership) =>
        membership.account?.status === "active" &&
        isOwnerMembership(membership),
    ) ?? null;
  const ownerAccountWorkspace =
    ownerAccountMembership?.account_id
      ? (accountWorkspaces.find(
          (workspace) =>
            workspace.accountId === ownerAccountMembership.account_id,
        ) ?? null)
      : null;
  const accountWorkspace =
    context.currentWorkspace?.type === "account"
      ? context.currentWorkspace
      : (ownerAccountWorkspace ?? accountWorkspaces[0] ?? null);
  const ownerWorkspace =
    context.currentWorkspace?.salonMode === "manage"
      ? context.currentWorkspace
      : null;
  const staffWorkspace =
    context.currentWorkspace?.salonMode === "staff"
      ? context.currentWorkspace
      : null;
  const accountStatus =
    context.user.status === "pending_deletion"
      ? "Pending deletion"
      : context.user.status === "active"
        ? "Active"
        : context.user.status;
  const accountStatusTone: SettingTone =
    context.user.status === "pending_deletion" ? "warning" : "success";
  const currentWorkspaceLabel =
    context.currentWorkspace?.label ?? "Personal account";
  const accountName =
    accountWorkspace?.accountName ??
    context.accountName ??
    context.currentAccount?.name ??
    "Business account";
  const ownerSalonLabel = workspaceLabel(ownerWorkspace);
  const staffSalonLabel = workspaceLabel(staffWorkspace);
  const ownerIsActive = Boolean(ownerWorkspace);
  const ownerCanViewSalonSettings =
    ownerIsActive && hasScopedPermission(context, "salon_settings.view");
  const ownerCanViewSalonProfile =
    ownerIsActive && hasScopedPermission(context, "salon_profile.view");
  const ownerCanViewServices =
    ownerIsActive && hasScopedPermission(context, "services.view");
  const ownerCanViewBooking =
    ownerIsActive && hasScopedPermission(context, "booking.view");
  const ownerCanViewStaff =
    ownerIsActive && hasScopedPermission(context, "staff.view");
  const ownerCanViewPayroll =
    ownerIsActive &&
    hasAnyScopedPermission(context, ["payroll.view", "payroll.manage"]);
  const ownerCanOpenPos =
    ownerIsActive &&
    hasAnyScopedPermission(context, ["tickets.manage", "tickets.view"]);
  const ownerCanViewReports =
    ownerIsActive && hasScopedPermission(context, "reports.view");
  const ownerCanViewCustomers =
    ownerIsActive && hasScopedPermission(context, "customers.view");
  const currentUserIsOwner = Boolean(
    ownerWorkspace && isOwnerMembership(context.currentMembership),
  );
  const salonHref = (destination: string) =>
    ownerWorkspace ? workspaceOpenHref(ownerWorkspace, destination) : undefined;
  const staffHref = (destination: string) =>
    staffWorkspace ? workspaceOpenHref(staffWorkspace, destination) : undefined;
  const accountHref = (destination: string) =>
    accountWorkspace ? workspaceOpenHref(accountWorkspace, destination) : destination;
  const salonSummary = [
    summaryItem(
      "Selected salon",
      ownerSalonLabel,
      ownerWorkspace ? "success" : "warning",
    ),
    summaryItem("Reports", ownerCanViewReports ? "Available" : "Hidden by role"),
    summaryItem("Customers", ownerCanViewCustomers ? "Available" : "Hidden by role"),
  ];
  const sections = ([
    {
      description:
        "Personal identity and security settings that follow the user across every salon.",
      id: "account",
      label: "Account",
      scope: "account",
      rows: [
        {
          action: "Save profile",
          description: "Name, avatar, email, phone, language, and timezone.",
          detailKind: "profile",
          icon: "user",
          id: "account-profile-contact",
          keywords: ["personal", "profile", "contact", "phone", "email"],
          label: "Profile & Contact",
          scope: "account",
          status: accountStatus,
          summaryItems: [
            summaryItem(
              "Display name",
              context.user.display_name ?? context.user.email ?? "Reylumi account",
              accountStatusTone,
            ),
            summaryItem("Email", context.user.email ?? "-"),
            summaryItem("Phone", context.user.phone ?? "-"),
          ],
          tone: accountStatusTone,
        },
        {
          action: "Open security center",
          description:
            "Password, sessions, trusted devices, 2FA, alerts, and recovery.",
          detailKind: "login-security",
          href: "/settings/login-security",
          icon: "lock",
          id: "account-login-security",
          keywords: [
            "login",
            "security",
            "password",
            "2fa",
            "session",
            "trusted device",
            "recovery",
          ],
          label: "Login & Security",
          scope: "account",
          status: "Security center",
          summaryItems: [
            summaryItem(
              "Login alerts",
              loginSecurityOverview?.preferences.loginAlertsEnabled ? "On" : "Off",
              loginSecurityOverview?.preferences.loginAlertsEnabled
                ? "success"
                : "warning",
            ),
            summaryItem(
              "SMS alerts",
              loginSecurityOverview?.preferences.smsLoginAlertsEnabled ? "On" : "Off",
              loginSecurityOverview?.preferences.smsLoginAlertsEnabled
                ? "success"
                : "warning",
            ),
          ],
          tone: "success",
        },
        {
          action: "Review connections",
          description: "Salon invitations, staff applications, and connections.",
          detailKind: "connections",
          href: "/staff/connections",
          icon: "link",
          id: "account-connections",
          keywords: ["invite", "application", "connection", "staff"],
          label: "Connections",
          scope: "account",
          status: "Personal",
          summaryItems: [
            summaryItem("Staff salons", plural(staffWorkspaces.length, "salon")),
            summaryItem("Owner salons", plural(ownerWorkspaces.length, "salon")),
          ],
        },
        {
          action: "Open inbox",
          description: "Account notifications and pending activity.",
          detailKind: "notifications",
          href: "/notifications",
          icon: "bell",
          id: "account-notifications",
          keywords: ["notification", "message", "alert"],
          label: "Notifications",
          scope: "account",
          status: "Live",
        },
      ],
    },
    ...(canAccessRecoveryBackOffice
      ? [
          {
            description:
              "Support-only account recovery queue and security review tools.",
            id: "support",
            label: "Support",
            scope: "account",
            rows: [
              {
                action: "Review recovery queue",
                description:
                  "Recovery cases, login context, support notes, and account lock actions.",
                detailKind: "recovery-back-office",
                href: "/settings/recovery-back-office",
                icon: "shield",
                id: "support-recovery-back-office",
                keywords: [
                  "admin",
                  "back office",
                  "recovery",
                  "support",
                  "secure account",
                ],
                label: "Recovery Back Office",
                scope: "account",
                status: "Support only",
                tone: "warning",
              },
            ],
          } satisfies AllSettingsSection,
        ]
      : []),
    {
      description:
        "The owner account layer: salon list, business roles, and account permission catalog.",
      id: "business-salons",
      label: "Business & Salons",
      scope: "business",
      rows: [
        ...(accountWorkspace
          ? [
              {
                action: "Open salon list",
                description: "All salons attached to this business account.",
                detailKind: "salon-list",
                href: accountHref(routes.salons.list()),
                icon: "building",
                id: "business-salon-list",
                keywords: ["business", "salon", "location", "multi location"],
                label: "Salon List",
                scope: "business",
                status: plural(ownerWorkspaces.length, "salon"),
                summaryItems: [
                  summaryItem("Business account", accountName),
                  summaryItem("Owner salons", plural(ownerWorkspaces.length, "salon")),
                  summaryItem("Staff salons", plural(staffWorkspaces.length, "salon")),
                ],
                tone: ownerWorkspaces.length > 0 ? "success" : "warning",
              } satisfies AllSettingsSection["rows"][number],
            ]
          : []),
        ...(ownerAccountWorkspace
          ? [
              {
                action: "Create salon",
                description:
                  "Add a new salon before editing salon-specific settings.",
                detailKind: "create-salon",
                href: workspaceOpenHref(ownerAccountWorkspace, routes.salons.create()),
                icon: "store",
                id: "business-create-salon",
                keywords: ["new salon", "create", "location"],
                label: "Create Salon",
                scope: "business",
                status: "Setup",
                summaryItems: [summaryItem("Business account", accountName)],
              },
              {
                action: "Open roles",
                description:
                  "Role records for the business account behind the salons.",
                detailKind: "roles",
                href: workspaceOpenHref(ownerAccountWorkspace, "/roles"),
                icon: "users",
                id: "business-roles",
                keywords: ["roles", "owner", "admin", "manager", "account"],
                label: "Roles",
                scope: "business",
                status: accountName,
                summaryItems: [
                  summaryItem("Business account", accountName),
                  summaryItem("Access", "Owner only", "warning"),
                ],
              },
              {
                action: "Open permissions",
                description:
                  "Permission categories for staff, booking, POS, payroll, and reports.",
                detailKind: "permissions",
                href: workspaceOpenHref(ownerAccountWorkspace, "/permissions"),
                icon: "shield",
                id: "business-permissions",
                keywords: ["permission", "access", "role", "security"],
                label: "Permissions",
                scope: "business",
                status: "Role based",
                summaryItems: [
                  summaryItem("Business account", accountName),
                  summaryItem("Access", "Owner only", "warning"),
                ],
              },
            ]
          : []),
      ],
    },
    {
      description: ownerWorkspace
        ? `Settings for ${ownerSalonLabel}. Other salons stay hidden until selected.`
        : "Select an owner salon before opening salon-specific settings.",
      id: "current-salon",
      label: "Current Salon",
      scope: "salon",
      rows: ownerWorkspace
        ? [
            ...(ownerCanViewSalonProfile || ownerCanViewSalonSettings
              ? [
                  {
                    action: "Open salon settings",
                    description:
                      "Salon name, contact, website, address, and description.",
                    detailKind: "salon-profile",
                    href: salonHref("/salon-settings#business-information"),
                    icon: "store",
                    id: "salon-profile",
                    keywords: [
                      "salon profile",
                      "business info",
                      "address",
                      "website",
                    ],
                    label: "Salon Profile",
                    scope: "salon",
                    status: ownerSalonLabel,
                    summaryItems: salonSummary,
                    tone: "success",
                  },
                  {
                    action: "Open discovery settings",
                    description:
                      "Explore visibility, map readiness, and staff applications.",
                    detailKind: "public-profile",
                    href: salonHref("/salon-settings#public-profile-discovery"),
                    icon: "search",
                    id: "salon-public-profile-discovery",
                    keywords: ["public profile", "discovery", "map", "explore"],
                    label: "Public Profile & Discovery",
                    scope: "salon",
                    status: "Public",
                    summaryItems: salonSummary,
                  },
                ]
              : []),
            ...(ownerCanViewServices
              ? [
                  {
                    action: "Open services",
                    description:
                      "Service catalog, pricing, duration, categories, and online booking.",
                    detailKind: "services",
                    href: salonHref("/services"),
                    icon: "scissors",
                    id: "salon-services",
                    keywords: ["services", "price", "duration", "catalog"],
                    label: "Services",
                    scope: "salon",
                    status: "Module",
                    summaryItems: salonSummary,
                  },
                ]
              : []),
            ...(ownerCanViewBooking
              ? [
                  {
                    action: "Open booking",
                    description:
                      "Online booking rules, lead time, staff mode, and calendar setup.",
                    detailKind: "booking",
                    href: salonHref("/bookings?tab=settings"),
                    icon: "calendar",
                    id: "salon-booking",
                    keywords: ["booking", "appointment", "availability", "schedule"],
                    label: "Booking",
                    scope: "salon",
                    status: "Module",
                    summaryItems: salonSummary,
                  },
                ]
              : []),
            ...(ownerCanViewStaff
              ? [
                  {
                    action: "Open staff",
                    description:
                      "Staff directory, invites, status, profiles, and role access.",
                    detailKind: "staff-team",
                    href: salonHref("/staff"),
                    icon: "users",
                    id: "salon-staff-team",
                    keywords: ["staff", "team", "invite", "employee"],
                    label: "Staff & Team",
                    scope: "salon",
                    status: "Module",
                    summaryItems: salonSummary,
                  },
                ]
              : []),
            ...(ownerCanViewPayroll
              ? [
                  {
                    action: "Open payroll",
                    description:
                      "Payroll cycle, commission, fixed pay, tax, tips, and payouts.",
                    detailKind: "payroll",
                    href: salonHref("/payroll?tab=settings"),
                    icon: "cash",
                    id: "salon-payroll-tax",
                    keywords: ["payroll", "tax", "commission", "tips", "payout"],
                    label: "Payroll & Tax",
                    scope: "salon",
                    status: "Module",
                    summaryItems: salonSummary,
                  },
                ]
              : []),
            ...(ownerCanOpenPos
              ? [
                  {
                    action: "Open POS settings",
                    description:
                      "POS access, passcodes, customer display, tips, and check-in.",
                    detailKind: "pos-display",
                    href: salonHref("/pos/settings"),
                    icon: "receipt",
                    id: "salon-pos-display",
                    keywords: ["pos", "display", "passcode", "device", "tip"],
                    label: "POS & Display",
                    scope: "salon",
                    status: "Module",
                    summaryItems: salonSummary,
                  },
                ]
              : []),
            ...(currentUserIsOwner
              ? [
                  {
                    action: "Open ownership",
                    description:
                      "Co-owner invites, transfer ownership, roles, and permission links.",
                    detailKind: "ownership",
                    href: salonHref("/salon-settings#ownership-admins"),
                    icon: "key",
                    id: "salon-ownership-admins",
                    keywords: ["ownership", "owner", "admin", "transfer"],
                    label: "Ownership & Admins",
                    scope: "salon",
                    status: "Owner only",
                    summaryItems: [
                      summaryItem("Selected salon", ownerSalonLabel, "success"),
                      summaryItem("Access", "Owner only", "warning"),
                    ],
                    tone: "warning",
                  },
                ]
              : []),
          ]
        : ownerWorkspaces.length > 0
          ? [
              {
                action: "Choose salon",
                description:
                  "Switch to an owner salon first, then open its settings here.",
                detailKind: "salon-list",
                href: accountHref(routes.salons.list()),
                icon: "building",
                id: "salon-choose-owner-salon",
                keywords: ["salon", "location", "select", "workspace"],
                label: "Choose Owner Salon",
                scope: "salon",
                status: "Required",
                summaryItems: [
                  summaryItem("Owner salons", plural(ownerWorkspaces.length, "salon")),
                ],
                tone: "warning",
              },
            ]
          : [],
    },
    {
      description: staffWorkspace
        ? `Self-managed staff settings for ${staffSalonLabel}.`
        : "Staff settings appear after the account connects to a salon as staff.",
      id: "staff-workspace",
      label: "Staff Workspace",
      scope: "staff",
      rows: [
        {
          action: "Review connections",
          description: "Find salons, accept invites, and manage staff connections.",
          detailKind: "staff-connections",
          href: "/staff/connections",
          icon: "link",
          id: "staff-connections",
          keywords: ["staff connection", "invite", "application"],
          label: "Staff Connections",
          scope: "staff",
          status: plural(staffWorkspaces.length, "salon"),
          summaryItems: [
            summaryItem("Staff salons", plural(staffWorkspaces.length, "salon")),
          ],
          tone: staffWorkspaces.length > 0 ? "success" : "neutral",
        },
        ...(staffWorkspace
          ? [
              {
                action: "Open staff workspace",
                description:
                  "Today, profile drawer, payroll view, and personal staff tools.",
                detailKind: "staff-workspace",
                href: staffHref("/staff/my-work"),
                icon: "clock",
                id: "staff-my-workspace",
                keywords: ["my work", "staff profile", "payroll", "today"],
                label: "My Staff Workspace",
                scope: "staff",
                status: staffSalonLabel,
                summaryItems: [
                  summaryItem("Selected salon", staffSalonLabel, "success"),
                  summaryItem("Role", staffWorkspace.roleLabel),
                ],
                tone: "success",
              },
              {
                action: "Open schedule",
                description:
                  "Staff appointments and booking availability for the selected salon.",
                detailKind: "staff-schedule",
                href: staffHref("/staff/appointments"),
                icon: "calendar",
                id: "staff-schedule",
                keywords: ["staff schedule", "availability", "appointments"],
                label: "Staff Schedule",
                scope: "staff",
                status: "Staff module",
                summaryItems: [
                  summaryItem("Selected salon", staffSalonLabel, "success"),
                ],
              },
            ]
          : []),
      ],
    },
    {
      description:
        "High-impact actions stay separated from everyday profile and module settings.",
      id: "danger-zone",
      label: "Danger Zone",
      scope: "danger",
      rows: [
        {
          action: "Confirm deletion flow",
          description:
            "Backup, ownership review, grace period, and account deletion.",
          detailKind: "delete-account",
          icon: "trash",
          id: "danger-delete-account",
          keywords: ["delete account", "personal", "backup", "danger"],
          label: "Delete account",
          scope: "danger",
          status:
            context.user.status === "pending_deletion"
              ? "Account deletion scheduled"
              : "Protected",
          summaryItems: [
            summaryItem("Account status", accountStatus, accountStatusTone),
            summaryItem(
              "Scheduled",
              formatDate(context.user.deletion_scheduled_for),
              context.user.deletion_scheduled_for ? "warning" : "neutral",
            ),
          ],
          tone: "danger",
        },
        ...(ownerWorkspace && currentUserIsOwner
          ? [
              {
                action: "Open salon closure",
                description:
                  "Disable, backup, reactivate, or permanently close the selected salon.",
                detailKind: "close-salon",
                href: salonHref("/salon-settings#salon-status"),
                icon: "danger",
                id: "danger-close-salon",
                keywords: ["disable salon", "close salon", "backup", "danger"],
                label: "Disable or Close Salon",
                scope: "danger",
                status: ownerSalonLabel,
                summaryItems: [
                  summaryItem("Selected salon", ownerSalonLabel, "success"),
                  summaryItem("Access", "Owner only", "warning"),
                ],
                tone: "danger",
              },
            ]
          : []),
      ],
    },
  ] as AllSettingsSection[]).filter((section) => section.rows.length > 0);

  return (
    <AllSettingsClient
      accountDeletionImpact={
        deletionImpactResult.impact as AccountDeletionImpact | null
      }
      accountDeletionLoadError={deletionImpactResult.loadError}
      accountStatus={accountStatus}
      accountStatusTone={accountStatusTone}
      activeScope={activeScope}
      createdAtLabel={formatDateTime(context.user.created_at, context.user.timezone)}
      currentWorkspaceLabel={currentWorkspaceLabel}
      initialQuery={query}
      loginSecurityOverview={loginSecurityOverview}
      sections={sections}
      user={context.user}
    />
  );
}
