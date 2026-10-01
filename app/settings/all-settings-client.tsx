"use client";

import { AccountDeletionPanel } from "@/app/account/account-deletion-panel";
import { AccountProfileEditor } from "@/app/account/account-profile-editor";
import { LoginSecurityQuickEditor } from "@/app/settings/login-security/login-security-quick-editor";
import type { LoginSecurityOverview } from "@/lib/account-security";
import type { AccountDeletionImpact } from "@/lib/account-deletion";
import type { KingUser } from "@/types/user";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type AllSettingsScope =
  | "account"
  | "all"
  | "business"
  | "danger"
  | "salon"
  | "staff";

export type SettingRowScope = Exclude<AllSettingsScope, "all">;
export type SettingTone = "danger" | "neutral" | "success" | "warning";

export type SettingIconName =
  | "bell"
  | "building"
  | "calendar"
  | "cash"
  | "chevron"
  | "clock"
  | "danger"
  | "external"
  | "key"
  | "link"
  | "lock"
  | "receipt"
  | "save"
  | "scissors"
  | "search"
  | "shield"
  | "store"
  | "trash"
  | "user"
  | "users"
  | "x";

export type SettingDetailKind =
  | "booking"
  | "close-salon"
  | "connections"
  | "create-salon"
  | "delete-account"
  | "login-security"
  | "notifications"
  | "ownership"
  | "payroll"
  | "permissions"
  | "pos-display"
  | "profile"
  | "public-profile"
  | "recovery-back-office"
  | "roles"
  | "salon-list"
  | "salon-profile"
  | "services"
  | "staff-connections"
  | "staff-schedule"
  | "staff-team"
  | "staff-workspace";

export type SettingSummaryItem = {
  label: string;
  tone?: SettingTone;
  value: string;
};

type SettingQuickItem = {
  actionLabel?: string;
  description: string;
  href?: string;
  label: string;
  status?: string;
  tone?: SettingTone;
};

export type AllSettingsRow = {
  action: string;
  description: string;
  detailKind: SettingDetailKind;
  href?: string;
  icon: SettingIconName;
  id: string;
  keywords: string[];
  label: string;
  scope: SettingRowScope;
  status: string;
  summaryItems?: SettingSummaryItem[];
  tone?: SettingTone;
  unavailableReason?: string;
};

export type AllSettingsSection = {
  description: string;
  id: string;
  label: string;
  rows: AllSettingsRow[];
  scope: SettingRowScope;
};

type AllSettingsClientProps = {
  accountDeletionImpact: AccountDeletionImpact | null;
  accountDeletionLoadError?: string;
  accountStatus: string;
  accountStatusTone: SettingTone;
  activeScope: AllSettingsScope;
  createdAtLabel: string;
  currentWorkspaceLabel: string;
  initialQuery: string;
  loginSecurityOverview: LoginSecurityOverview | null;
  sections: AllSettingsSection[];
  user: KingUser;
};

const SCOPE_TABS: Array<{
  description: string;
  label: string;
  value: AllSettingsScope;
}> = [
  {
    description: "Every allowed setting in one compact list.",
    label: "All Settings",
    value: "all",
  },
  {
    description: "Personal identity, profile, login, and notifications.",
    label: "Account",
    value: "account",
  },
  {
    description: "Account-level salon list, roles, and permissions.",
    label: "Business & Salons",
    value: "business",
  },
  {
    description: "Settings for the selected owner salon.",
    label: "Current Salon",
    value: "salon",
  },
  {
    description: "Self-managed staff settings for the selected staff salon.",
    label: "Staff Workspace",
    value: "staff",
  },
  {
    description: "High-impact account and salon actions.",
    label: "Danger Zone",
    value: "danger",
  },
];

const DRAWER_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function normalizeSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function rowSearchText(row: AllSettingsRow) {
  return normalizeSearch(
    [
      row.action,
      row.description,
      row.label,
      row.scope,
      row.status,
      row.unavailableReason,
      ...(row.keywords ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function rowMatchesQuery(row: AllSettingsRow, query: string) {
  const normalizedQuery = normalizeSearch(query);

  if (!normalizedQuery) {
    return true;
  }

  const haystack = rowSearchText(row);
  return normalizedQuery
    .split(" ")
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function rowMatchesScope(row: AllSettingsRow, scope: AllSettingsScope) {
  return scope === "all" || row.scope === scope;
}

function statusClass(tone: SettingTone = "neutral") {
  return {
    danger: "bg-red-50 text-red-700 ring-red-200",
    neutral: "bg-zinc-100 text-zinc-600 ring-zinc-200",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warning: "bg-amber-50 text-amber-700 ring-amber-200",
  }[tone];
}

function scopeClass(scope: SettingRowScope) {
  return {
    account: "bg-sky-50 text-sky-700 ring-sky-200",
    business: "bg-violet-50 text-violet-700 ring-violet-200",
    danger: "bg-red-50 text-red-700 ring-red-200",
    salon: "bg-brand-orange-soft text-brand-orange ring-orange-200",
    staff: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  }[scope];
}

function iconPath(name: SettingIconName): ReactNode {
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
    case "external":
      return (
        <>
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
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
    case "save":
      return (
        <>
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
          <path d="M17 21v-8H7v8M7 3v5h8" />
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
    case "x":
      return <path d="M18 6 6 18M6 6l12 12" />;
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

function Icon({ name }: { name: SettingIconName }) {
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

function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: string;
  tone?: SettingTone;
}) {
  return (
    <span
      className={[
        "inline-flex min-h-7 max-w-full items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset",
        statusClass(tone),
      ].join(" ")}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

function countRowsForScope(rows: AllSettingsRow[], scope: AllSettingsScope) {
  return scope === "all"
    ? rows.length
    : rows.filter((row) => row.scope === scope).length;
}

function tabClass(active: boolean) {
  return [
    "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-4 text-sm font-semibold ring-1 ring-inset transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
    active
      ? "bg-zinc-950 text-white ring-zinc-950"
      : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-950",
  ].join(" ");
}

function SettingRowButton({
  onOpen,
  row,
}: {
  onOpen: (row: AllSettingsRow) => void;
  row: AllSettingsRow;
}) {
  return (
    <button
      className={[
        "grid min-h-[68px] w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-100 px-3 py-3 text-left transition last:border-b-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950 sm:px-4",
        row.tone === "danger"
          ? "text-red-950 hover:bg-red-50"
          : "text-zinc-950 hover:bg-zinc-50",
      ].join(" ")}
      onClick={() => onOpen(row)}
      type="button"
    >
      <span
        className={[
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
          row.tone === "danger"
            ? "bg-red-50 text-red-700"
            : row.scope === "salon"
              ? "bg-brand-orange-soft text-brand-orange"
              : "bg-zinc-100 text-zinc-700",
        ].join(" ")}
      >
        <Icon name={row.icon} />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 text-sm font-semibold">{row.label}</span>
          <span
            className={[
              "inline-flex min-h-5 items-center rounded-full px-2 text-[11px] font-semibold capitalize ring-1 ring-inset",
              scopeClass(row.scope),
            ].join(" ")}
          >
            {row.scope === "business"
              ? "business"
              : row.scope === "danger"
                ? "danger"
                : row.scope}
          </span>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-zinc-500 sm:line-clamp-1">
          {row.description}
        </span>
      </span>
      <span className="grid justify-items-end gap-1">
        <span className="hidden md:block">
          <StatusBadge tone={row.tone}>{row.status}</StatusBadge>
        </span>
        <span className="grid h-9 w-9 place-items-center rounded-md text-zinc-400">
          <Icon name="chevron" />
        </span>
      </span>
    </button>
  );
}

function SettingSectionView({
  onOpen,
  section,
}: {
  onOpen: (row: AllSettingsRow) => void;
  section: AllSettingsSection;
}) {
  return (
    <section className="scroll-mt-24" id={`settings-section-${section.id}`}>
      <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-950">
            {section.label}
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            {section.description}
          </p>
        </div>
        <span className="text-xs font-semibold uppercase text-zinc-400">
          {section.rows.length} {section.rows.length === 1 ? "item" : "items"}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {section.rows.map((row) => (
          <SettingRowButton key={row.id} onOpen={onOpen} row={row} />
        ))}
      </div>
    </section>
  );
}

function SummaryList({ items }: { items: SettingSummaryItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <dl className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {items.map((item) => (
        <div
          className="grid gap-1 border-b border-zinc-100 px-4 py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center"
          key={`${item.label}-${item.value}`}
        >
          <dt className="text-xs font-semibold uppercase text-zinc-500">
            {item.label}
          </dt>
          <dd className="min-w-0">
            <StatusBadge tone={item.tone}>{item.value}</StatusBadge>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function summaryValue(row: AllSettingsRow, label: string) {
  return row.summaryItems?.find((item) => item.label === label)?.value;
}

function settingQuickItems(row: AllSettingsRow): SettingQuickItem[] {
  const setupItem = (
    label: string,
    description: string,
    actionLabel = "Open",
    tone: SettingTone = "neutral",
  ): SettingQuickItem => ({
    actionLabel,
    description,
    href: row.href,
    label,
    status: row.status,
    tone,
  });

  switch (row.detailKind) {
    case "connections":
    case "staff-connections":
      return [
        setupItem(
          "Invites and applications",
          "Review salon invites, staff applications, and connection status.",
        ),
        setupItem(
          "Connected salons",
          "Check which salons this account owns or works with.",
          "Manage",
          row.tone ?? "neutral",
        ),
      ];
    case "notifications":
      return [
        setupItem(
          "Notification inbox",
          "Read account alerts and pending activity.",
        ),
        setupItem(
          "Unread activity",
          "Open the inbox when there is anything that needs attention.",
          "View",
          row.tone ?? "success",
        ),
      ];
    case "recovery-back-office":
      return [
        setupItem(
          "Recovery queue",
          "Review recent access recovery requests.",
          "Review",
          "warning",
        ),
        setupItem(
          "Security actions",
          "Lock accounts, add support notes, and complete recovery reviews.",
          "Open",
          "warning",
        ),
      ];
    case "salon-list":
      return [
        setupItem(
          "Salon list",
          "Manage all salons attached to this business account.",
          "Open",
          row.tone ?? "neutral",
        ),
        {
          description: "Owner workspaces available to this account.",
          label: "Owner salons",
          status: summaryValue(row, "Owner salons") ?? row.status,
          tone: row.tone ?? "neutral",
        },
        {
          description: "Staff workspaces connected to this account.",
          label: "Staff salons",
          status: summaryValue(row, "Staff salons") ?? "-",
        },
      ];
    case "create-salon":
      return [
        setupItem(
          "Create salon",
          "Add a salon, then return here for its profile, booking, staff, and POS settings.",
          "Create",
        ),
      ];
    case "roles":
      return [
        setupItem(
          "Role members",
          "Manage owner, admin, manager, and staff role records.",
          "Open",
          "warning",
        ),
        setupItem(
          "Role access",
          "Use role-level access when a setting should not be visible to everyone.",
          "Manage",
          "warning",
        ),
      ];
    case "permissions":
      return [
        setupItem(
          "Permission catalog",
          "Review access for staff, booking, POS, payroll, reports, and customers.",
          "Open",
        ),
        setupItem(
          "Staff rules",
          "Adjust which settings each role can see and edit.",
          "Manage",
        ),
      ];
    case "salon-profile":
      return [
        setupItem(
          "Business information",
          "Edit salon name, phone, website, and short description.",
          "Edit",
          "success",
        ),
        setupItem(
          "Address and map",
          "Update the location details customers see.",
          "Edit",
        ),
      ];
    case "public-profile":
      return [
        setupItem(
          "Explore visibility",
          "Control public discovery and customer-facing profile readiness.",
          "Edit",
        ),
        setupItem(
          "Staff applications",
          "Manage whether new staff can apply from the public profile.",
          "Manage",
        ),
      ];
    case "services":
      return [
        setupItem("Service catalog", "Edit services, categories, and descriptions.", "Open"),
        setupItem("Pricing and duration", "Adjust price, time, and booking availability.", "Edit"),
      ];
    case "booking":
      return [
        setupItem("Booking rules", "Edit lead time, cancellation rules, and booking mode.", "Edit"),
        setupItem("Calendar setup", "Tune availability and staff booking behavior.", "Open"),
      ];
    case "staff-team":
      return [
        setupItem("Staff directory", "Manage staff profiles and connection status.", "Open"),
        setupItem("Invites and roles", "Invite staff and review role access.", "Manage"),
      ];
    case "payroll":
      return [
        setupItem("Pay cycle", "Review payroll schedule and payout settings.", "Open"),
        setupItem("Commission and tax", "Edit commission, fixed pay, tax, tips, and adjustments.", "Manage"),
      ];
    case "pos-display":
      return [
        setupItem("POS access", "Manage passcodes and device-facing settings.", "Open"),
        setupItem("Display and tips", "Tune customer display, tips, and check-in behavior.", "Edit"),
      ];
    case "ownership":
      return [
        setupItem("Admins and co-owners", "Review owner-only access and admin links.", "Open", "warning"),
        setupItem("Ownership transfer", "Start transfer only when the salon owner is changing.", "Manage", "warning"),
      ];
    case "staff-workspace":
      return [
        setupItem("My staff tools", "Open today, profile, payroll view, and staff actions.", "Open", "success"),
        setupItem("Selected salon", "Stay scoped to the current staff salon.", "View", "success"),
      ];
    case "staff-schedule":
      return [
        setupItem("Appointments", "Review personal staff appointments.", "Open"),
        setupItem("Availability", "Tune booking availability for this staff workspace.", "Manage"),
      ];
    case "close-salon":
      return [
        setupItem("Salon status", "Disable or reactivate the selected salon.", "Open", "danger"),
        setupItem("Backup and closure", "Review impact before permanent closure.", "Review", "danger"),
      ];
    default:
      return row.href
        ? [
            setupItem(
              row.action,
              row.description,
              row.action.startsWith("Open") ? "Open" : "Manage",
              row.tone ?? "neutral",
            ),
          ]
        : [];
  }
}

function SettingQuickList({ items }: { items: SettingQuickItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {items.map((item) => {
        const content = (
          <>
            <span className="min-w-0">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-zinc-950">
                  {item.label}
                </span>
                {item.status ? (
                  <StatusBadge tone={item.tone}>{item.status}</StatusBadge>
                ) : null}
              </span>
              <span className="mt-1 block text-sm leading-6 text-zinc-500">
                {item.description}
              </span>
            </span>
            {item.href ? (
              <span className="inline-flex min-h-9 items-center rounded-md px-2 text-sm font-semibold text-brand-orange transition group-hover:bg-brand-orange-soft">
                {item.actionLabel ?? "Open"}
              </span>
            ) : null}
          </>
        );

        if (item.href) {
          return (
            <Link
              className="group grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-100 px-4 py-3 text-left transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950 last:border-b-0"
              href={item.href}
              key={`${item.label}-${item.description}`}
            >
              {content}
            </Link>
          );
        }

        return (
          <div
            className="grid min-h-14 gap-1 border-b border-zinc-100 px-4 py-3 last:border-b-0"
            key={`${item.label}-${item.description}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

function SettingOverviewDetail({ row }: { row: AllSettingsRow }) {
  const quickItems = settingQuickItems(row);

  return (
    <div className="grid gap-4">
      <SummaryList items={row.summaryItems ?? []} />
      {row.unavailableReason ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
          {row.unavailableReason}
        </p>
      ) : null}
      <SettingQuickList items={quickItems} />
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="grid min-h-14 gap-1 border-b border-zinc-100 px-4 py-3 last:border-b-0">
          <p className="text-sm font-semibold text-zinc-950">About</p>
          <p className="text-sm leading-6 text-zinc-500">{row.description}</p>
        </div>
        {row.href ? (
          <Link
            className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950"
            href={row.href}
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-zinc-950">
                Open full setup
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-zinc-500">
                {row.action}
              </span>
            </span>
            <span className="grid h-9 w-9 place-items-center rounded-md text-zinc-400">
              <Icon name="external" />
            </span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function LoginSecurityQuickPanel({
  overview,
}: {
  overview: LoginSecurityOverview | null;
}) {
  return (
    <LoginSecurityQuickEditor
      detailHref="/settings/login-security"
      overview={overview}
      variant="drawer"
    />
  );
}

function DetailContent({
  accountDeletionImpact,
  accountDeletionLoadError,
  createdAtLabel,
  loginSecurityOverview,
  row,
  user,
}: {
  accountDeletionImpact: AccountDeletionImpact | null;
  accountDeletionLoadError?: string;
  createdAtLabel: string;
  loginSecurityOverview: LoginSecurityOverview | null;
  row: AllSettingsRow;
  user: KingUser;
}) {
  if (row.detailKind === "profile") {
    return <AccountProfileEditor createdAtLabel={createdAtLabel} user={user} />;
  }

  if (row.detailKind === "login-security") {
    return <LoginSecurityQuickPanel overview={loginSecurityOverview} />;
  }

  if (row.detailKind === "delete-account") {
    return (
      <AccountDeletionPanel
        impact={accountDeletionImpact}
        loadError={accountDeletionLoadError}
      />
    );
  }

  return <SettingOverviewDetail row={row} />;
}

function SettingsDetailDrawer({
  accountDeletionImpact,
  accountDeletionLoadError,
  createdAtLabel,
  loginSecurityOverview,
  onClose,
  row,
  user,
}: {
  accountDeletionImpact: AccountDeletionImpact | null;
  accountDeletionLoadError?: string;
  createdAtLabel: string;
  loginSecurityOverview: LoginSecurityOverview | null;
  onClose: () => void;
  row: AllSettingsRow | null;
  user: KingUser;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!row) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    }, 0);

    document.body.style.overflow = "hidden";

    function focusableElements() {
      return Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE) ?? [],
      ).filter((element) => !element.hasAttribute("disabled"));
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = focusableElements();

      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, row]);

  if (!row) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[90] bg-zinc-950/30 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        aria-describedby="settings-detail-description"
        aria-labelledby="settings-detail-title"
        aria-modal="true"
        className="fixed inset-0 flex h-[100dvh] w-full flex-col overflow-hidden bg-surface text-zinc-950 shadow-2xl outline-none md:inset-y-0 md:left-auto md:right-0 md:w-[min(48rem,calc(100vw-2rem))] md:rounded-l-2xl"
        ref={drawerRef}
        role="dialog"
      >
        <header className="shrink-0 border-b border-zinc-200 bg-white px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={[
                "mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-lg",
                row.tone === "danger"
                  ? "bg-red-50 text-red-700"
                  : row.scope === "salon"
                    ? "bg-brand-orange-soft text-brand-orange"
                    : "bg-zinc-100 text-zinc-700",
              ].join(" ")}
            >
              <Icon name={row.icon} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  className="min-w-0 text-xl font-semibold tracking-normal text-zinc-950"
                  id="settings-detail-title"
                >
                  {row.label}
                </h2>
                <StatusBadge tone={row.tone}>{row.status}</StatusBadge>
              </div>
              <p
                className="mt-1 text-sm leading-6 text-zinc-500"
                id="settings-detail-description"
              >
                {row.description}
              </p>
            </div>
            <button
              aria-label="Close settings detail"
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
            >
              <Icon name="x" />
              <span>Close</span>
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain bg-surface-muted px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5">
          <DetailContent
            accountDeletionImpact={accountDeletionImpact}
            accountDeletionLoadError={accountDeletionLoadError}
            createdAtLabel={createdAtLabel}
            loginSecurityOverview={loginSecurityOverview}
            row={row}
            user={user}
          />
        </div>
      </aside>
    </div>
  );
}

export function AllSettingsClient({
  accountDeletionImpact,
  accountDeletionLoadError,
  accountStatus,
  accountStatusTone,
  activeScope: initialScope,
  createdAtLabel,
  currentWorkspaceLabel,
  initialQuery,
  loginSecurityOverview,
  sections,
  user,
}: AllSettingsClientProps) {
  const router = useRouter();
  const [activeScope, setActiveScope] = useState<AllSettingsScope>(initialScope);
  const [query, setQuery] = useState(initialQuery);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const preloadedScopeValues = useMemo<ReadonlySet<AllSettingsScope>>(
    () => new Set(SCOPE_TABS.map((tab) => tab.value)),
    [],
  );
  const allRows = useMemo(
    () => sections.flatMap((section) => section.rows),
    [sections],
  );
  const openRow =
    allRows.find((row) => row.id === openRowId) ?? null;
  const filteredSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          rows: section.rows.filter(
            (row) =>
              rowMatchesScope(row, activeScope) && rowMatchesQuery(row, query),
          ),
        }))
        .filter((section) => section.rows.length > 0),
    [activeScope, query, sections],
  );
  const resultCount = filteredSections.reduce(
    (total, section) => total + section.rows.length,
    0,
  );

  useEffect(() => {
    const hrefs = new Set(
      allRows.map((row) => row.href).filter((href): href is string => Boolean(href)),
    );

    for (const href of hrefs) {
      router.prefetch(href);
    }
  }, [allRows, router]);

  const closeDrawer = useCallback(() => {
    setOpenRowId(null);
    window.setTimeout(() => {
      lastFocusRef.current?.focus({ preventScroll: true });
      lastFocusRef.current = null;
    }, 0);
  }, []);

  function openDrawer(row: AllSettingsRow) {
    const activeElement = document.activeElement;

    lastFocusRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
    setOpenRowId(row.id);
  }

  function selectScope(scope: AllSettingsScope) {
    setActiveScope(scope);
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-5">
        <header className="rounded-lg border border-border-subtle bg-white px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-zinc-500">
                  Account, business, salon
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-normal text-zinc-950">
                  All Settings
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                  Settings stay grouped by scope, while each row opens a focused
                  detail view inside Settings.
                </p>
              </div>
              <div className="grid gap-2 sm:justify-items-end">
                <StatusBadge tone={accountStatusTone}>{accountStatus}</StatusBadge>
                <p className="max-w-56 truncate text-sm font-semibold text-zinc-500">
                  {currentWorkspaceLabel}
                </p>
              </div>
            </div>

            <label className="relative block">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                <Icon name="search" />
              </span>
              <input
                className="min-h-11 w-full rounded-md border border-zinc-300 bg-white pl-10 pr-3 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search account, salon, booking, staff, POS..."
                type="search"
                value={query}
              />
            </label>

            <nav
              aria-label="Settings scopes"
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
            >
              {SCOPE_TABS.map((tab) => {
                const active = activeScope === tab.value;
                const count = countRowsForScope(allRows, tab.value);

                return (
                  <button
                    aria-current={active ? "page" : undefined}
                    className={tabClass(active)}
                    data-preloaded={preloadedScopeValues.has(tab.value)}
                    key={tab.value}
                    onClick={() => selectScope(tab.value)}
                    title={tab.description}
                    type="button"
                  >
                    <span>{tab.label}</span>
                    <span
                      className={[
                        "ml-2 grid min-h-5 min-w-5 place-items-center rounded-full px-1 text-[11px]",
                        active
                          ? "bg-white/15 text-white"
                          : "bg-zinc-100 text-zinc-500",
                      ].join(" ")}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </nav>
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
            <div className="grid gap-5">
              {filteredSections.map((section) => (
                <SettingSectionView
                  key={section.id}
                  onOpen={openDrawer}
                  section={section}
                />
              ))}
            </div>
          </>
        ) : (
          <section className="rounded-lg border border-dashed border-zinc-300 bg-white px-5 py-8">
            <h2 className="text-base font-semibold text-zinc-950">
              No settings found
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              Try a different search or scope.
            </p>
            <button
              className="mt-4 inline-flex min-h-10 items-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white"
              onClick={() => {
                setQuery("");
                setActiveScope("all");
              }}
              type="button"
            >
              Clear search
            </button>
          </section>
        )}
      </div>

      <SettingsDetailDrawer
        accountDeletionImpact={accountDeletionImpact}
        accountDeletionLoadError={accountDeletionLoadError}
        createdAtLabel={createdAtLabel}
        loginSecurityOverview={loginSecurityOverview}
        onClose={closeDrawer}
        row={openRow}
        user={user}
      />
    </main>
  );
}
