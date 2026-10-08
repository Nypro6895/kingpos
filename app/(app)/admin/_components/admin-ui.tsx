import { LogoutButton } from "@/app/account/logout-button";
import { DashboardIcon } from "../dashboard/dashboard-icons";
import { CompactFilters } from "@/components/compact-filters";

import Form from "next/form";
import { SubmitButton as PendingSubmitButton } from "@/components/submit-button";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminNavigation } from "./admin-navigation";
import { AdminTopbar } from "./admin-topbar";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import type {
  PlatformAdminContext,
  PlatformAdminPermission,
} from "@/types/platform-admin";

type AdminShellProps = {
  children: ReactNode;
  context: PlatformAdminContext;
  counts?: Record<string, number>;
};

type AdminNavItem = {
  href: string;
  label: string;
  permission: PlatformAdminPermission;
  group: string;
  icon: string;
};

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin/attention", label: "Attention list", permission: PLATFORM_ADMIN_PERMISSIONS.usersRead, group: "Review & support", icon: "△" },
  {
    href: "/admin",
    label: "Dashboard",
    permission: PLATFORM_ADMIN_PERMISSIONS.dashboardRead,
    group: "Platform management", icon: "⌂",
  },
  {
    href: "/admin/users",
    label: "Users",
    permission: PLATFORM_ADMIN_PERMISSIONS.usersRead,
    group: "Platform management", icon: "♙",
  },
  {
    href: "/admin/businesses",
    label: "Businesses",
    permission: PLATFORM_ADMIN_PERMISSIONS.businessesRead,
    group: "Platform management", icon: "▦",
  },
  {
    href: "/admin/locations",
    label: "Salons",
    permission: PLATFORM_ADMIN_PERMISSIONS.locationsRead,
    group: "Platform management", icon: "⌖",
  },
  { href: "/admin/post-safety", label: "Post safety", permission: PLATFORM_ADMIN_PERMISSIONS.reportsRead, group: "Review & support", icon: "☷" },
  {
    href: "/admin/reports",
    label: "Support cases",
    permission: PLATFORM_ADMIN_PERMISSIONS.reportsRead,
    group: "Review & support", icon: "☷",
  },
  {
    href: "/admin/recovery",
    label: "Recovery",
    permission: PLATFORM_ADMIN_PERMISSIONS.recoveryRead,
    group: "Review & support", icon: "↺",
  },
  {href: "/admin/claims", label: "Ownership claims", permission: PLATFORM_ADMIN_PERMISSIONS.locationsRead, group: "Review & support", icon: "◇"},
  {href: "/admin/verification", label: "Salon verification", permission: PLATFORM_ADMIN_PERMISSIONS.locationsRead, group: "Review & support", icon: "✓"},
  {href: "/admin/notifications", label: "Notifications", permission: PLATFORM_ADMIN_PERMISSIONS.notificationsRead, group: "Communication", icon: "♧"},
  {href: "/admin/inbox", label: "Support inbox", permission: PLATFORM_ADMIN_PERMISSIONS.inboxRead, group: "Review & support", icon: "✉"},
  {href: "/admin/advertising", label: "Advertising", permission: PLATFORM_ADMIN_PERMISSIONS.advertisingManage, group: "Communication", icon: "◈"},
  {
    href: "/admin/audit",
    label: "Audit log",
    permission: PLATFORM_ADMIN_PERMISSIONS.auditRead,
    group: "System", icon: "◷",
  },
  {
    href: "/admin/team",
    label: "Admin team",
    permission: PLATFORM_ADMIN_PERMISSIONS.teamRead,
    group: "System", icon: "♙",
  },
  {href: "/admin/settings", label: "Settings", permission: PLATFORM_ADMIN_PERMISSIONS.access, group: "System", icon: "⚙"},
];

function AdminBrandLogo({ className }: { className: string }) {
  return (
    <Image
      aria-hidden="true"
      alt=""
      className={["h-auto object-contain", className].join(" ")}
      height={419}
      src="/brand/reylumi-logo-horizontal.png"
      width={1527}
    />
  );
}

export function hasAdminPermission(
  context: PlatformAdminContext,
  permission: PlatformAdminPermission,
) {
  return context.permissions.includes(permission);
}

export function AdminShell({ children, context, counts = {} }: AdminShellProps) {
  const navItems = ADMIN_NAV_ITEMS.filter((item) =>
    hasAdminPermission(context, item.permission) && (item.href!=="/admin/settings/twilio" || context.roleSlug==="platform_owner"),
  ).map(item => ({ ...item, count: counts[item.href] })).sort((a, b) => {
    const order = ["/admin", "/admin/users", "/admin/businesses", "/admin/locations", "/admin/attention", "/admin/inbox", "/admin/claims", "/admin/verification", "/admin/reports", "/admin/post-safety", "/admin/recovery", "/admin/notifications", "/admin/advertising", "/admin/audit", "/admin/team", "/admin/settings"];
    return order.indexOf(a.href) - order.indexOf(b.href);
  });

  return (
    <div className="admin-workspace min-h-screen bg-white text-zinc-950">
      <aside className="admin-sidebar fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-zinc-200 bg-white px-4 py-5 lg:block">
        <Link
          aria-label="Reylumi Admin Control Center"
          className="flex min-h-14 flex-col items-start justify-center rounded-lg px-2 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          href="/admin"
        >
          <span className="admin-brand-wordmark">REYLUMI</span>
          <span className="mt-1 block text-xs font-semibold text-zinc-500">
            Admin Control Center
          </span>
        </Link>
        <AdminNavigation items={navItems} />
        <Link href="/account" className="admin-sidebar-account"><span className="admin-avatar" aria-hidden="true">{context.roleName.split(" ").map(word => word[0]).slice(0, 2).join("")}</span><span><strong>{context.roleName}</strong><small>Platform administration</small></span></Link>
        <LogoutButton className="admin-sidebar-logout"><DashboardIcon name="logout"/>Sign out</LogoutButton>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-3">
            <Link
              aria-label="Reylumi Admin Control Center"
              className="inline-flex min-h-10 shrink-0 items-center rounded-md px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              href="/admin"
            >
              <AdminBrandLogo className="w-28 max-w-[42vw]" />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-black uppercase tracking-[0.16em]">
                Admin
              </p>
              <p className="truncate text-xs text-zinc-500">{context.roleName}</p>
            </div>
          </div>
          <AdminNavigation items={navItems} mobile />
        </header>
        <AdminTopbar roleName={context.roleName} canNotifications={hasAdminPermission(context, PLATFORM_ADMIN_PERMISSIONS.notificationsRead)} />
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

export function AdminPageHeader({
  actions,
  eyebrow,
  title,
  children,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-zinc-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-zinc-950">
          {title}
        </h1>
        {children ? (
          <div className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            {children}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function AdminSection({
  children,
  title,
  action,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-zinc-950">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AdminMetric({
  label,
  value,
  detail,
}: {
  detail?: string;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <dt className="text-xs font-bold uppercase tracking-[0.12em] text-zinc-500">
        {label}
      </dt>
      <dd className="mt-2 text-3xl font-black text-zinc-950">{value}</dd>
      {detail ? <p className="mt-2 text-xs text-zinc-500">{detail}</p> : null}
    </div>
  );
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  const label = value ?? "unknown";
  const color =
    label === "active" || label === "resolved" || label === "approved" || label === "delivered" || label === "read"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : label === "suspended" ||
          label === "urgent" ||
          label === "action_required"
        ? "border-red-200 bg-red-50 text-red-800"
        : label === "closed" || label === "archived" || label === "revoked" || label === "deleted" || label === "inactive"
          ? "border-zinc-200 bg-zinc-100 text-zinc-700"
          : "border-orange-200 bg-orange-50 text-orange-800";

  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold",
        color,
      ].join(" ")}
    >
      {label.replaceAll("_", " ")}
    </span>
  );
}

export function AdminTable({
  children,
  columns,
}: {
  children: ReactNode;
  columns: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="hidden border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-bold uppercase tracking-[0.08em] text-zinc-500 md:grid">
        {columns}
      </div>
      <div className="divide-y divide-zinc-200">{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
}: {
  children?: ReactNode;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center">
      <h3 className="text-base font-black text-zinc-950">{title}</h3>
      {children ? <div className="mt-2 text-sm text-zinc-600">{children}</div> : null}
    </div>
  );
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="rounded-lg border border-zinc-200 bg-white px-4 shadow-sm">
      {children}
    </dl>
  );
}

export function Field({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="border-b border-zinc-200 py-3 last:border-b-0 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-semibold text-zinc-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-zinc-950 sm:col-span-2 sm:mt-0">
        {value ?? "—"}
      </dd>
    </div>
  );
}

export function TextInput({
  defaultValue,
  label,
  name,
  required = false,
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-zinc-700">{label}</span>
      <input
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950"
        defaultValue={defaultValue ?? ""}
        name={name}
        required={required}
        type="text"
      />
    </label>
  );
}

export function TextArea({
  defaultValue,
  label,
  name,
  required = false,
  rows = 4,
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
  required?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-zinc-700">{label}</span>
      <textarea
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950"
        defaultValue={defaultValue ?? ""}
        name={name}
        required={required}
        rows={rows}
      />
    </label>
  );
}

export function SelectInput({
  defaultValue,
  label,
  name,
  options,
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-zinc-700">{label}</span>
      <select
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950"
        defaultValue={defaultValue ?? ""}
        name={name}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SubmitButton({ children }: { children: ReactNode }) {
  return (
    <PendingSubmitButton pendingLabel="Processing…"
      className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
      type="submit"
    >
      {children}
    </PendingSubmitButton>
  );
}

export function SecondaryLink({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) {
  return (
    <Link
      className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-bold text-zinc-800 shadow-sm transition hover:border-zinc-400"
      href={href}
    >
      {children}
    </Link>
  );
}

export function SearchForm({
  actionLabel = "Search",
  children,
  defaultQuery,
  filters,
  placeholder = "Search by name or keyword",
}: {
  actionLabel?: string;
  children?: ReactNode;
  defaultQuery?: string | null;
  filters?: ReactNode;
  placeholder?: string;
}) {
  const filterContent = children ?? filters;

  return (
    <Form action="" className="mt-5 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <label className="block">
          <span className="text-sm font-semibold text-zinc-700">Search</span>
          <input
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950"
            defaultValue={defaultQuery ?? ""}
            name="q"
            placeholder={placeholder}
            type="search"
          />
        </label>
        <button
          className="rounded-md bg-orange-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-orange-700"
          type="submit"
        >
          {actionLabel}
        </button>
      </div>
      <div className="mt-2">
        <CompactFilters label="Search filters">
          {filterContent ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{filterContent}</div> : null}
          <button type="submit" className="mt-3 min-h-11 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white">Apply filters</button>
        </CompactFilters>
      </div>
    </Form>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  query,
}: {
  basePath: string;
  page: number;
  pageSize: number;
  query?: Record<string, string | null | undefined>;
  total: number;
}) {
  const hasPrevious = page > 1;
  const hasNext = page * pageSize < total;
  const buildHref = (nextPage: number) => {
    const params = new URLSearchParams();
    params.set("page", String(nextPage));
    params.set("pageSize", String(pageSize));

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value) {
        params.set(key, value);
      }
    }

    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600">
      <p>
        {total === 0 ? "0 results" : `${(page-1)*pageSize+1}–${Math.min(page*pageSize,total)} of ${total}`} · Page {page}
      </p>
      <div className="flex gap-2">
        {hasPrevious ? (
          <Link
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 font-bold text-zinc-800"
            href={buildHref(page - 1)}
          >
            Previous
          </Link>
        ) : null}
        {hasNext ? (
          <Link
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 font-bold text-zinc-800"
            href={buildHref(page + 1)}
          >
            Next
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function formatAdminDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Chicago",
    }).format(new Date(value)) + " CT";
  } catch {
    return value;
  }
}
