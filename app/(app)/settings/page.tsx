import {
  getCurrentBusinessContext,
  type CurrentWorkspaceOption,
} from "@/lib/current-context";
import { routes } from "@/lib/routes";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

type SettingsPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    scope?: string | string[];
  }>;
};

type SettingScope = "account" | "business" | "salon" | "staff";
type SettingTone = "danger" | "neutral" | "success" | "warning";

type IconName =
  | "bell"
  | "building"
  | "calendar"
  | "cash"
  | "chevron"
  | "clock"
  | "danger"
  | "key"
  | "link"
  | "lock"
  | "receipt"
  | "scissors"
  | "search"
  | "shield"
  | "store"
  | "trash"
  | "user"
  | "users";

type SettingRow = {
  action: string;
  description: string;
  href?: string;
  icon: IconName;
  keywords: string[];
  label: string;
  scope: SettingScope;
  status: string;
  tone?: SettingTone;
};

type SettingSection = {
  description: string;
  id: string;
  label: string;
  rows: SettingRow[];
};

type ScopeFilter = SettingScope | "all";

const SCOPE_FILTERS: Array<{
  description: string;
  label: string;
  value: ScopeFilter;
}> = [
  {
    description: "Everything grouped by owner.",
    label: "All",
    value: "all",
  },
  {
    description: "Personal identity and login.",
    label: "Account",
    value: "account",
  },
  {
    description: "Salon list and account roles.",
    label: "Business",
    value: "business",
  },
  {
    description: "Settings for the selected salon.",
    label: "Salon",
    value: "salon",
  },
  {
    description: "Self-managed staff tools.",
    label: "Staff",
    value: "staff",
  },
];

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeScope(value: string | string[] | undefined): ScopeFilter {
  const scope = firstParam(value);

  if (
    scope === "account" ||
    scope === "business" ||
    scope === "salon" ||
    scope === "staff"
  ) {
    return scope;
  }

  return "all";
}

function settingsHref(input: { q?: string; scope: ScopeFilter }) {
  const params = new URLSearchParams();

  if (input.scope !== "all") {
    params.set("scope", input.scope);
  }

  if (input.q) {
    params.set("q", input.q);
  }

  const query = params.toString();
  return query ? `/settings?${query}` : "/settings";
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

function iconPath(name: IconName): ReactNode {
  switch (name) {
    case "bell":
      return (
        <>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </>
      );
    case "building":
      return (
        <>
          <path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16" />
          <path d="M8 7h1M12 7h1M8 11h1M12 11h1M8 15h1M12 15h1M3 21h18" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect height="18" rx="2" width="18" x="3" y="4" />
          <path d="M8 2v4M16 2v4M3 10h18" />
        </>
      );
    case "cash":
      return (
        <>
          <rect height="12" rx="2" width="18" x="3" y="6" />
          <path d="M8 12h.01M16 12h.01M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4" />
        </>
      );
    case "chevron":
      return <path d="m9 18 6-6-6-6" />;
    case "clock":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      );
    case "danger":
      return (
        <>
          <path d="m12 3 10 18H2z" />
          <path d="M12 9v4M12 17h.01" />
        </>
      );
    case "key":
      return (
        <>
          <circle cx="7.5" cy="15.5" r="3.5" />
          <path d="m10 13 8-8 3 3-2 2-2-2-2 2 2 2-2 2" />
        </>
      );
    case "link":
      return (
        <>
          <path d="M10 13a5 5 0 0 0 7.1 0l2.8-2.8a5 5 0 0 0-7.1-7.1L11 4.8" />
          <path d="M14 11a5 5 0 0 0-7.1 0l-2.8 2.8a5 5 0 0 0 7.1 7.1L13 19.2" />
        </>
      );
    case "lock":
      return (
        <>
          <rect height="11" rx="2" width="18" x="3" y="11" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </>
      );
    case "receipt":
      return (
        <>
          <path d="M4 2v20l3-2 3 2 3-2 3 2 4-2V2z" />
          <path d="M8 7h8M8 12h8M8 17h5" />
        </>
      );
    case "scissors":
      return (
        <>
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M20 4 8.1 15.9M8.1 8.1 20 20" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </>
      );
    case "shield":
      return (
        <>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
          <path d="m9 12 2 2 4-4" />
        </>
      );
    case "store":
      return (
        <>
          <path d="M4 10h16l-1-6H5z" />
          <path d="M5 10v10h14V10M9 20v-6h6v6" />
        </>
      );
    case "trash":
      return (
        <>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
        </>
      );
    case "users":
      return (
        <>
          <path d="M16 21v-2a4 4 0 0 0-8 0v2" />
          <circle cx="12" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      );
    case "user":
    default:
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 22a8 8 0 0 1 16 0" />
        </>
      );
  }
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      {iconPath(name)}
    </svg>
  );
}

function statusClass(tone: SettingTone = "neutral") {
  return {
    danger: "bg-red-50 text-red-700 ring-red-200",
    neutral: "bg-zinc-100 text-zinc-600 ring-zinc-200",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warning: "bg-amber-50 text-amber-700 ring-amber-200",
  }[tone];
}

function scopeClass(scope: SettingScope) {
  return {
    account: "bg-sky-50 text-sky-700 ring-sky-200",
    business: "bg-violet-50 text-violet-700 ring-violet-200",
    salon: "bg-brand-orange-soft text-brand-orange ring-orange-200",
    staff: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  }[scope];
}

function rowClass(tone: SettingTone = "neutral") {
  if (tone === "danger") {
    return "text-red-950 hover:bg-red-50";
  }

  return "text-zinc-950 hover:bg-zinc-50";
}

function SettingRowView({ row }: { row: SettingRow }) {
  const content = (
    <>
      <span
        className={[
          "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
          row.tone === "danger"
            ? "bg-red-50 text-red-700"
            : row.scope === "salon"
              ? "bg-brand-orange-soft text-brand-orange"
              : "bg-zinc-100 text-zinc-700",
        ].join(" ")}
      >
        <Icon name={row.icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{row.label}</span>
          <span
            className={[
              "inline-flex min-h-5 items-center rounded-full px-2 text-[11px] font-semibold capitalize ring-1 ring-inset",
              scopeClass(row.scope),
            ].join(" ")}
          >
            {row.scope}
          </span>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-zinc-500 sm:line-clamp-1">
          {row.description}
        </span>
      </span>
      <span className="hidden min-w-0 text-right md:block">
        <span
          className={[
            "inline-flex min-h-7 max-w-44 items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset",
            statusClass(row.tone),
          ].join(" ")}
        >
          <span className="truncate">{row.status}</span>
        </span>
        <span className="mt-1 block text-xs text-zinc-500">{row.action}</span>
      </span>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-zinc-400">
        <Icon name="chevron" />
      </span>
    </>
  );

  if (!row.href) {
    return (
      <div className="flex min-h-16 items-center gap-3 border-b border-zinc-100 px-4 py-3 opacity-60 last:border-b-0">
        {content}
      </div>
    );
  }

  return (
    <Link
      className={[
        "flex min-h-16 items-center gap-3 border-b border-zinc-100 px-4 py-3 transition last:border-b-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950",
        rowClass(row.tone),
      ].join(" ")}
      href={row.href}
    >
      {content}
    </Link>
  );
}

function SettingSectionView({ section }: { section: SettingSection }) {
  return (
    <section className="scroll-mt-6" id={section.id}>
      <div className="mb-2">
        <h2 className="text-base font-semibold text-zinc-950">{section.label}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-500">
          {section.description}
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {section.rows.map((row) => (
          <SettingRowView key={`${section.id}-${row.label}`} row={row} />
        ))}
      </div>
    </section>
  );
}

function searchText(row: SettingRow) {
  return [
    row.label,
    row.description,
    row.status,
    row.action,
    row.scope,
    ...row.keywords,
  ]
    .join(" ")
    .toLowerCase();
}

function filterSections(input: {
  query: string;
  scope: ScopeFilter;
  sections: SettingSection[];
}) {
  const normalizedQuery = input.query.trim().toLowerCase();

  return input.sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => {
        const scopeMatches =
          input.scope === "all" || row.scope === input.scope;
        const queryMatches =
          !normalizedQuery || searchText(row).includes(normalizedQuery);

        return scopeMatches && queryMatches;
      }),
    }))
    .filter((section) => section.rows.length > 0);
}

function ScopeLink({
  active,
  filter,
  query,
}: {
  active: boolean;
  filter: (typeof SCOPE_FILTERS)[number];
  query: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={[
        "inline-flex min-h-9 items-center rounded-full px-3 text-sm font-semibold ring-1 ring-inset transition",
        active
          ? "bg-zinc-950 text-white ring-zinc-950"
          : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-950",
      ].join(" ")}
      href={settingsHref({ q: query, scope: filter.value })}
      title={filter.description}
    >
      {filter.label}
    </Link>
  );
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const [params, context] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect("/login?next=/settings");
  }

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
  const accountWorkspace =
    context.currentWorkspace?.type === "account"
      ? context.currentWorkspace
      : (context.currentWorkspace?.accountId
          ? (accountWorkspaces.find(
              (workspace) =>
                workspace.accountId === context.currentWorkspace?.accountId,
            ) ?? null)
          : null) ?? (accountWorkspaces[0] ?? null);
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
  const ownerSalonLabel = workspaceLabel(ownerWorkspace);
  const staffSalonLabel = workspaceLabel(staffWorkspace);
  const salonCount = ownerWorkspaces.length;
  const staffCount = staffWorkspaces.length;
  const currentWorkspaceLabel =
    context.currentWorkspace?.label ?? "Personal account";
  const accountName =
    accountWorkspace?.accountName ??
    context.accountName ??
    context.currentAccount?.name ??
    "Business account";
  const accountRolesHref = accountWorkspace
    ? workspaceOpenHref(accountWorkspace, "/roles")
    : "/roles";
  const accountPermissionsHref = accountWorkspace
    ? workspaceOpenHref(accountWorkspace, "/permissions")
    : "/permissions";
  const salonHref = (destination: string) =>
    ownerWorkspace ? workspaceOpenHref(ownerWorkspace, destination) : undefined;
  const staffHref = (destination: string) =>
    staffWorkspace ? workspaceOpenHref(staffWorkspace, destination) : undefined;

  const sections: SettingSection[] = [
    {
      description:
        "Personal identity and preferences that follow the user across every salon.",
      id: "account",
      label: "Account",
      rows: [
        {
          action: "Edit once",
          description: "Name, avatar, email, phone, language, and timezone.",
          href: "/account#profile-contact",
          icon: "user",
          keywords: ["personal", "profile", "contact", "phone", "email"],
          label: "Profile & contact",
          scope: "account",
          status: accountStatus,
          tone: accountStatusTone,
        },
        {
          action: "Reset flow",
          description: "Password reset and secure account access.",
          href: "/forgot-password",
          icon: "lock",
          keywords: ["login", "security", "password", "2fa", "passkey"],
          label: "Login & security",
          scope: "account",
          status: "Password",
          tone: "success",
        },
        {
          action: "Review list",
          description: "Salon invitations, staff applications, and connections.",
          href: "/staff/connections",
          icon: "link",
          keywords: ["invite", "application", "connection", "staff"],
          label: "Connections",
          scope: "account",
          status: "Personal",
        },
        {
          action: "Inbox",
          description: "Account notifications and pending activity.",
          href: "/notifications",
          icon: "bell",
          keywords: ["notification", "message", "alert"],
          label: "Notifications",
          scope: "account",
          status: "Live",
        },
      ],
    },
    {
      description:
        "The owner account layer: choose salons, manage account roles, then open one salon.",
      id: "business-salons",
      label: "Business & Salons",
      rows: [
        {
          action: "Open list",
          description: "All salons attached to this owner account.",
          href: routes.salons.list(),
          icon: "building",
          keywords: ["business", "salon", "location", "multi location"],
          label: "Salon list",
          scope: "business",
          status: plural(salonCount, "salon"),
          tone: salonCount > 0 ? "success" : "warning",
        },
        {
          action: "Create",
          description: "Add a new salon before editing salon-specific settings.",
          href: routes.salons.create(),
          icon: "store",
          keywords: ["new salon", "create", "location"],
          label: "Create salon",
          scope: "business",
          status: "Setup",
        },
        {
          action: "Account roles",
          description: "Role records for the business account behind the salons.",
          href: accountWorkspace ? accountRolesHref : undefined,
          icon: "users",
          keywords: ["roles", "owner", "admin", "manager", "account"],
          label: "Roles",
          scope: "business",
          status: accountWorkspace ? accountName : "No owner account",
          tone: accountWorkspace ? "neutral" : "warning",
        },
        {
          action: "Catalog",
          description: "Permission categories for staff, booking, POS, payroll, and reports.",
          href: accountWorkspace ? accountPermissionsHref : undefined,
          icon: "shield",
          keywords: ["permission", "access", "role", "security"],
          label: "Permissions",
          scope: "business",
          status: accountWorkspace ? "Role based" : "No owner account",
          tone: accountWorkspace ? "neutral" : "warning",
        },
      ],
    },
    {
      description: ownerWorkspace
        ? `Settings for ${ownerSalonLabel}. Other salons stay hidden until selected.`
        : "Choose or create a salon before opening owner settings.",
      id: "current-salon",
      label: "Current Salon",
      rows: ownerWorkspace
        ? [
            {
              action: "Edit form",
              description: "Salon name, contact, website, address, and description.",
              href: salonHref("/salon-settings#business-information"),
              icon: "store",
              keywords: ["salon profile", "business info", "address", "website"],
              label: "Salon profile",
              scope: "salon",
              status: ownerSalonLabel,
              tone: "success",
            },
            {
              action: "Visibility",
              description: "Explore visibility, map readiness, and staff applications.",
              href: salonHref("/salon-settings#public-profile-discovery"),
              icon: "search",
              keywords: ["public profile", "discovery", "map", "explore"],
              label: "Public profile & discovery",
              scope: "salon",
              status: "Public",
            },
            {
              action: "Open module",
              description: "Service catalog, pricing, duration, categories, and online booking.",
              href: salonHref("/services"),
              icon: "scissors",
              keywords: ["services", "price", "duration", "catalog"],
              label: "Services",
              scope: "salon",
              status: "Module",
            },
            {
              action: "Open module",
              description: "Online booking rules, lead time, staff mode, and calendar setup.",
              href: salonHref("/bookings?tab=settings"),
              icon: "calendar",
              keywords: ["booking", "appointment", "availability", "schedule"],
              label: "Booking",
              scope: "salon",
              status: "Module",
            },
            {
              action: "Open module",
              description: "Staff directory, invites, status, profiles, and role access.",
              href: salonHref("/staff"),
              icon: "users",
              keywords: ["staff", "team", "invite", "employee"],
              label: "Staff & team",
              scope: "salon",
              status: "Module",
            },
            {
              action: "Open module",
              description: "Payroll cycle, commission, fixed pay, tax, tips, and payouts.",
              href: salonHref("/payroll?tab=settings"),
              icon: "cash",
              keywords: ["payroll", "tax", "commission", "tips", "payout"],
              label: "Payroll & tax",
              scope: "salon",
              status: "Module",
            },
            {
              action: "Open module",
              description: "POS access, passcodes, customer display, tips, and check-in.",
              href: salonHref("/pos/settings"),
              icon: "receipt",
              keywords: ["pos", "display", "passcode", "device", "tip"],
              label: "POS & display",
              scope: "salon",
              status: "Module",
            },
            {
              action: "Protected",
              description: "Co-owner invites, transfer ownership, roles, and permission links.",
              href: salonHref("/salon-settings#ownership-admins"),
              icon: "key",
              keywords: ["ownership", "owner", "admin", "transfer"],
              label: "Ownership & admins",
              scope: "salon",
              status: "Owner only",
              tone: "warning",
            },
          ]
        : [
            {
              action: "Open list",
              description: "Pick a salon first, then open salon-specific settings.",
              href: routes.salons.list(),
              icon: "building",
              keywords: ["salon", "location", "select"],
              label: "Choose salon",
              scope: "salon",
              status: "Required",
              tone: "warning",
            },
          ],
    },
    {
      description: staffWorkspace
        ? `Self-managed staff settings for ${staffSalonLabel}.`
        : "Staff settings appear after the account connects to a salon as staff.",
      id: "staff-workspace",
      label: "Staff Workspace",
      rows: [
        {
          action: "Review list",
          description: "Find salons, accept invites, and manage staff connections.",
          href: "/staff/connections",
          icon: "link",
          keywords: ["staff connection", "invite", "application"],
          label: "Staff connections",
          scope: "staff",
          status: plural(staffCount, "salon"),
          tone: staffCount > 0 ? "success" : "neutral",
        },
        {
          action: staffWorkspace ? "Open workspace" : "Unavailable",
          description: "Today, profile drawer, payroll view, and personal staff tools.",
          href: staffHref("/staff/my-work"),
          icon: "clock",
          keywords: ["my work", "staff profile", "payroll", "today"],
          label: "My staff workspace",
          scope: "staff",
          status: staffWorkspace ? staffSalonLabel : "No staff salon",
          tone: staffWorkspace ? "success" : "warning",
        },
        {
          action: staffWorkspace ? "Open schedule" : "Unavailable",
          description: "Staff appointments and booking availability for the selected salon.",
          href: staffHref("/staff/appointments"),
          icon: "calendar",
          keywords: ["staff schedule", "availability", "appointments"],
          label: "Staff schedule",
          scope: "staff",
          status: staffWorkspace ? "Staff module" : "No staff salon",
          tone: staffWorkspace ? "neutral" : "warning",
        },
      ],
    },
    {
      description:
        "High-impact actions stay separated from everyday profile and module settings.",
      id: "danger-zone",
      label: "Danger Zone",
      rows: [
        {
          action: "Confirm flow",
          description: "Backup, ownership review, grace period, and account deletion.",
          href: "/account#delete-account",
          icon: "trash",
          keywords: ["delete account", "personal", "backup", "danger"],
          label: "Delete personal account",
          scope: "account",
          status:
            context.user.status === "pending_deletion"
              ? `Scheduled ${formatDate(context.user.deletion_scheduled_for)}`
              : "Protected",
          tone: "danger",
        },
        {
          action: ownerWorkspace ? "Confirm flow" : "Unavailable",
          description: "Disable, backup, reactivate, or permanently close the selected salon.",
          href: salonHref("/salon-settings#salon-status"),
          icon: "danger",
          keywords: ["disable salon", "close salon", "backup", "danger"],
          label: "Disable or close salon",
          scope: "salon",
          status: ownerWorkspace ? ownerSalonLabel : "No salon",
          tone: "danger",
        },
      ],
    },
  ];

  const filteredSections = filterSections({
    query,
    scope: activeScope,
    sections,
  });
  const resultCount = filteredSections.reduce(
    (total, section) => total + section.rows.length,
    0,
  );

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="h-fit rounded-lg border border-border-subtle bg-white p-3 lg:sticky lg:top-5">
          <div className="border-b border-zinc-100 px-2 pb-3">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Settings Home
            </p>
            <h1 className="mt-1 truncate text-lg font-semibold text-zinc-950">
              {context.user.display_name ?? context.user.email ?? "Reylumi"}
            </h1>
            <p className="mt-1 truncate text-sm text-zinc-500">
              {currentWorkspaceLabel}
            </p>
          </div>
          <nav aria-label="Settings sections" className="mt-3 grid gap-1">
            {filteredSections.map((section) => (
              <a
                className={[
                  "flex min-h-10 items-center justify-between rounded-md px-2.5 py-2 text-sm font-semibold transition hover:bg-zinc-100",
                  section.id === "danger-zone" ? "text-red-700" : "text-zinc-700",
                ].join(" ")}
                href={`#${section.id}`}
                key={section.id}
              >
                <span>{section.label}</span>
                <span className="text-xs text-zinc-400">{section.rows.length}</span>
              </a>
            ))}
          </nav>
        </aside>

        <div className="grid gap-5">
          <header className="rounded-lg border border-border-subtle bg-white px-5 py-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-500">
                    Account, business, salon
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-normal text-zinc-950">
                    All settings
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                    Settings are grouped by what they belong to. Salon-specific
                    rows open the selected salon or the right module.
                  </p>
                </div>
                <span
                  className={[
                    "inline-flex min-h-8 w-fit items-center rounded-full px-3 text-xs font-semibold ring-1 ring-inset",
                    statusClass(accountStatusTone),
                  ].join(" ")}
                >
                  {accountStatus}
                </span>
              </div>

              <form action="/settings" className="grid gap-3">
                {activeScope !== "all" ? (
                  <input name="scope" type="hidden" value={activeScope} />
                ) : null}
                <label className="relative block">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                    <Icon name="search" />
                  </span>
                  <input
                    className="min-h-11 w-full rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                    defaultValue={query}
                    name="q"
                    placeholder="Search account, salon, booking, staff, POS..."
                    type="search"
                  />
                </label>
              </form>

              <div className="flex flex-wrap gap-2">
                {SCOPE_FILTERS.map((filter) => (
                  <ScopeLink
                    active={filter.value === activeScope}
                    filter={filter}
                    key={filter.value}
                    query={query}
                  />
                ))}
              </div>
            </div>
          </header>

          {filteredSections.length > 0 ? (
            <>
              {(query || activeScope !== "all") && (
                <p className="text-sm font-medium text-zinc-500">
                  {resultCount} setting{resultCount === 1 ? "" : "s"} found
                  {query ? ` for "${query}"` : ""}.
                </p>
              )}
              {filteredSections.map((section) => (
                <SettingSectionView key={section.id} section={section} />
              ))}
            </>
          ) : (
            <section className="rounded-lg border border-dashed border-zinc-300 bg-white px-5 py-8">
              <h2 className="text-base font-semibold text-zinc-950">
                No settings found
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Try a different search or clear the filter.
              </p>
              <Link
                className="mt-4 inline-flex min-h-10 items-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white"
                href="/settings"
              >
                Clear search
              </Link>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
