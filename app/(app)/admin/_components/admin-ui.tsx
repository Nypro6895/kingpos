import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import type {
  PlatformAdminContext,
  PlatformAdminPermission,
} from "@/types/platform-admin";

type AdminShellProps = {
  children: ReactNode;
  context: PlatformAdminContext;
};

type AdminNavItem = {
  href: string;
  label: string;
  permission: PlatformAdminPermission;
};

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    href: "/admin",
    label: "Dashboard",
    permission: PLATFORM_ADMIN_PERMISSIONS.dashboardRead,
  },
  {
    href: "/admin/users",
    label: "Users",
    permission: PLATFORM_ADMIN_PERMISSIONS.usersRead,
  },
  {
    href: "/admin/businesses",
    label: "Businesses",
    permission: PLATFORM_ADMIN_PERMISSIONS.businessesRead,
  },
  {
    href: "/admin/locations",
    label: "Locations",
    permission: PLATFORM_ADMIN_PERMISSIONS.locationsRead,
  },
  {
    href: "/admin/reports",
    label: "Reports",
    permission: PLATFORM_ADMIN_PERMISSIONS.reportsRead,
  },
  {
    href: "/admin/recovery",
    label: "Recovery",
    permission: PLATFORM_ADMIN_PERMISSIONS.recoveryRead,
  },
  {
    href: "/admin/audit",
    label: "Audit",
    permission: PLATFORM_ADMIN_PERMISSIONS.auditRead,
  },
  {
    href: "/admin/team",
    label: "Team",
    permission: PLATFORM_ADMIN_PERMISSIONS.teamRead,
  },
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

export function AdminShell({ children, context }: AdminShellProps) {
  const navItems = ADMIN_NAV_ITEMS.filter((item) =>
    hasAdminPermission(context, item.permission),
  );

  return (
    <div className="min-h-screen bg-[#f7f4ef] text-zinc-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-zinc-200 bg-white/95 px-4 py-5 shadow-sm lg:block">
        <Link
          aria-label="Reylumi Admin Control Center"
          className="flex min-h-14 flex-col items-start justify-center rounded-lg px-2 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          href="/admin"
        >
          <AdminBrandLogo className="w-36 max-w-full" />
          <span className="mt-1 block text-xs font-semibold text-zinc-500">
            Admin Control Center
          </span>
        </Link>
        <nav aria-label="Admin" className="mt-7 grid gap-1">
          {navItems.map((item) => (
            <Link
              className="rounded-md px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-orange-50 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="absolute inset-x-4 bottom-5 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Role
          </p>
          <p className="mt-1 text-sm font-bold text-zinc-950">{context.roleName}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {context.permissions.length} permissions
          </p>
        </div>
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
          <nav
            aria-label="Admin mobile"
            className="mt-3 flex gap-2 overflow-x-auto pb-1"
          >
            {navItems.map((item) => (
              <Link
                className="shrink-0 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
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
    label === "active" || label === "resolved"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : label === "suspended" ||
          label === "urgent" ||
          label === "action_required"
        ? "border-red-200 bg-red-50 text-red-800"
        : label === "closed" || label === "archived" || label === "revoked"
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
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="border-b border-zinc-200 py-3 last:border-b-0 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-semibold text-zinc-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-zinc-950 sm:col-span-2 sm:mt-0">
        {value || "-"}
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
    <button
      className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
      type="submit"
    >
      {children}
    </button>
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
}: {
  actionLabel?: string;
  children?: ReactNode;
  defaultQuery?: string | null;
  filters?: ReactNode;
}) {
  const filterContent = children ?? filters;

  return (
    <form className="mt-5 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <label className="block">
          <span className="text-sm font-semibold text-zinc-700">Search</span>
          <input
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-950"
            defaultValue={defaultQuery ?? ""}
            name="q"
            placeholder="Search by name, ID, status, or keyword"
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
      {filterContent ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {filterContent}
        </div>
      ) : null}
    </form>
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
        Page {page} - {total} total
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
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
