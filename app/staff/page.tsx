import {
  createSalonStaffInviteFormAction,
  createStaff,
  resendSalonStaffInviteFormAction,
  reviewStaffSalonApplicationFormAction,
  revokeSalonStaffInviteFormAction,
} from "@/app/staff/actions";
import { StaffServicesBookingEditor } from "@/app/booking-setup/booking-setup-editors";
import {
  getCurrentSalonBookingSetup,
  type BookingSetupData,
  type StaffBookingReadiness,
} from "@/lib/booking-setup";
import { CopyInviteLinkButton } from "@/app/staff/copy-invite-link-button";
import { StaffPublicProfileEditor } from "@/app/staff/staff-public-profile-editor";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import {
  getCurrentSalonStaffDirectory,
  STAFF_PERMISSIONS,
  type StaffDirectoryMember,
} from "@/lib/staff";
import {
  getSalonStaffConnectionRequests,
  searchStaffAccountExact,
} from "@/lib/staff-salon-connections";
import Link from "next/link";
import type { ReactNode } from "react";
import type {
  SalonStaffConnectionRequestWithDetails,
  StaffAccountExactSearchResult,
} from "@/types/staff-salon-connection";

type StaffPageSearchParams = {
  add?: string | string[];
  connection_error?: string | string[];
  connection_notice?: string | string[];
  error?: string | string[];
  filter?: string | string[];
  invite_email?: string | string[];
  invite_phone?: string | string[];
  invite_request?: string | string[];
  invite_token?: string | string[];
  q?: string | string[];
  setup?: string | string[];
  staff?: string | string[];
};

type StaffPageProps = {
  searchParams: Promise<StaffPageSearchParams>;
};

const STAFF_FILTERS = [
  { id: "active", label: "Active" },
  { id: "need_contact", label: "Need Contact" },
  { id: "ready_invite", label: "Ready to Invite" },
  { id: "connected", label: "Connected" },
  { id: "missing_setup", label: "Missing Setup" },
  { id: "inactive", label: "Inactive" },
] as const;

type StaffFilter = (typeof STAFF_FILTERS)[number]["id"];
type BadgeTone = "danger" | "dark" | "neutral" | "success" | "warning";
type AccountStatusKind =
  | "connected"
  | "disconnected"
  | "invite_sent"
  | "need_contact"
  | "not_connected"
  | "ready_to_invite";
type BookingStatusKind =
  | "disabled"
  | "enabled"
  | "missing_schedule"
  | "missing_services"
  | "ready";
type PosStatusKind = "disabled" | "enabled" | "limited_access" | "pin_missing";

const DEFAULT_FILTER: StaffFilter = "active";

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isStaffFilter(value: string | undefined): value is StaffFilter {
  return STAFF_FILTERS.some((filter) => filter.id === value);
}

function getStaffFilter(value: string | undefined) {
  return isStaffFilter(value) ? value : DEFAULT_FILTER;
}

function getStaffHref(input: {
  add?: boolean;
  filter?: StaffFilter;
  query?: string;
  staffId?: string | null;
}) {
  const params = new URLSearchParams({
    filter: input.filter ?? DEFAULT_FILTER,
  });
  const query = input.query?.trim();

  if (query) {
    params.set("q", query);
  }

  if (input.add) {
    params.set("add", "1");
  }

  if (input.staffId) {
    params.set("staff", input.staffId);
  }

  return `/staff?${params.toString()}`;
}

function isEmploymentActive(member: StaffDirectoryMember) {
  return member.is_active;
}

function cleanValue(value: string | null | undefined) {
  return value?.trim() || "";
}

function hasUsableEmail(member: StaffDirectoryMember) {
  return cleanValue(member.email).length > 0;
}

function hasUsablePhone(member: StaffDirectoryMember) {
  return cleanValue(member.phone).length > 0;
}

function hasUsableContact(member: StaffDirectoryMember) {
  return hasUsableEmail(member) || hasUsablePhone(member);
}

function bestContact(member: StaffDirectoryMember) {
  return cleanValue(member.email) || cleanValue(member.phone) || "No contact";
}

function isConnected(member: StaffDirectoryMember) {
  return Boolean(member.user_id || member.connected_user);
}

function hasPendingInvite(
  member: StaffDirectoryMember,
  requests: SalonStaffConnectionRequestWithDetails[] = [],
) {
  return requests.some(
    (request) =>
      request.direction === "salon_invite" &&
      request.status === "pending" &&
      request.staff_id === member.id,
  );
}

function getAccountStatus(
  member: StaffDirectoryMember,
  requests: SalonStaffConnectionRequestWithDetails[] = [],
): {
  kind: AccountStatusKind;
  label: string;
  tone: BadgeTone;
} {
  if (isConnected(member)) {
    return { kind: "connected", label: "Connected", tone: "success" };
  }

  if (hasPendingInvite(member, requests)) {
    return { kind: "invite_sent", label: "Invite Sent", tone: "warning" };
  }

  if (!hasUsableContact(member)) {
    return { kind: "need_contact", label: "Need Contact", tone: "danger" };
  }

  if (isEmploymentActive(member)) {
    return { kind: "ready_to_invite", label: "Ready to Invite", tone: "warning" };
  }

  return { kind: "not_connected", label: "Not Connected", tone: "neutral" };
}

function isReadyToInvite(
  member: StaffDirectoryMember,
  requests: SalonStaffConnectionRequestWithDetails[] = [],
) {
  return getAccountStatus(member, requests).kind === "ready_to_invite";
}

function needsContact(member: StaffDirectoryMember) {
  return isEmploymentActive(member) && !hasUsableContact(member);
}

function getBookingStatus(
  member: StaffDirectoryMember,
  readiness?: StaffBookingReadiness | null,
): {
  kind: BookingStatusKind;
  label: string;
  tone: BadgeTone;
} {
  if (!isEmploymentActive(member)) {
    return { kind: "disabled", label: "Disabled", tone: "neutral" };
  }

  if (!readiness) {
    return { kind: "ready", label: "Ready", tone: "success" };
  }

  if (readiness.ready) {
    return { kind: "ready", label: "Ready", tone: "success" };
  }

  if (readiness.reasons.some((reason) => reason.code === "no_assigned_services")) {
    return { kind: "missing_services", label: "Needs Services", tone: "warning" };
  }

  if (readiness.reasons.some((reason) => reason.code === "no_working_hours")) {
    return { kind: "missing_schedule", label: "Needs Hours", tone: "warning" };
  }

  return {
    kind: "disabled",
    label: readiness.reasons[0]?.label ?? "Needs Setup",
    tone: "warning",
  };
}

function getPosStatus(member: StaffDirectoryMember): {
  kind: PosStatusKind;
  label: string;
  tone: BadgeTone;
} {
  if (!isEmploymentActive(member)) {
    return { kind: "disabled", label: "Disabled", tone: "neutral" };
  }

  // TODO: When staff POS flags, POS PIN, and access-level fields exist,
  // evaluate pos_enabled, pin presence, and access limits here.
  return { kind: "enabled", label: "Enabled", tone: "success" };
}

function hasMissingRole(member: StaffDirectoryMember) {
  return !cleanValue(member.job_title);
}

function hasMissingPayrollSetup(member: StaffDirectoryMember) {
  return (
    isEmploymentActive(member) && member.payroll_setup_status === "missing"
  );
}

function hasMissingSetup(
  member: StaffDirectoryMember,
  readiness?: StaffBookingReadiness | null,
) {
  const bookingStatus = getBookingStatus(member, readiness).kind;
  const posStatus = getPosStatus(member).kind;

  return (
    isEmploymentActive(member) &&
    (hasMissingRole(member) ||
      needsContact(member) ||
      hasMissingPayrollSetup(member) ||
      bookingStatus === "missing_services" ||
      bookingStatus === "missing_schedule" ||
      posStatus === "pin_missing" ||
      posStatus === "limited_access")
  );
}

function memberMatchesFilter(
  member: StaffDirectoryMember,
  filter: StaffFilter,
  requests: SalonStaffConnectionRequestWithDetails[] = [],
  readiness?: StaffBookingReadiness | null,
) {
  if (filter === "connected") {
    return isConnected(member);
  }

  if (filter === "need_contact") {
    return needsContact(member);
  }

  if (filter === "ready_invite") {
    return isReadyToInvite(member, requests);
  }

  if (filter === "missing_setup") {
    return hasMissingSetup(member, readiness);
  }

  if (filter === "inactive") {
    return !isEmploymentActive(member);
  }

  return isEmploymentActive(member);
}

function memberMatchesSearch(member: StaffDirectoryMember, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableText = [
    member.display_name,
    member.first_name,
    member.last_name,
    member.email,
    member.phone,
    member.job_title,
    member.connected_user?.display_name,
    member.connected_user?.email,
    member.connected_user?.phone,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return searchableText.includes(normalizedQuery);
}

function getVisibleStaff(input: {
  filter: StaffFilter;
  query: string;
  readinessByStaffId?: Record<string, StaffBookingReadiness>;
  requests?: SalonStaffConnectionRequestWithDetails[];
  staff: StaffDirectoryMember[];
}) {
  return input.staff.filter(
    (member) =>
      memberMatchesFilter(
        member,
        input.filter,
        input.requests ?? [],
        input.readinessByStaffId?.[member.id],
      ) &&
      memberMatchesSearch(member, input.query),
  );
}

function getInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "ST";
  }

  return parts.map((part) => part[0]?.toUpperCase()).join("");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function Field({
  label,
  name,
  autoComplete,
  required = false,
  type = "text",
}: {
  label: string;
  name: string;
  autoComplete?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  const toneClass = {
    danger: "border-rose-200 bg-rose-50 text-rose-700",
    dark: "border-zinc-950 bg-zinc-950 text-white",
    neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
  }[tone];

  return (
    <span
      className={`inline-flex min-h-7 w-fit items-center rounded-md border px-2.5 py-1 text-xs font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge tone={isActive ? "dark" : "neutral"}>
      {isActive ? "Active" : "Inactive"}
    </Badge>
  );
}

function AvatarInitials({ name }: { name: string }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
      {getInitials(name)}
    </span>
  );
}

function StaffForm({
  error,
  canManageStaff,
}: {
  error?: string;
  canManageStaff: boolean;
}) {
  if (!canManageStaff) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
        You do not have permission to manage staff.
      </p>
    );
  }

  return (
    <form
      action={createStaff}
      className="grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-2">
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Field
          autoComplete="name"
          label="Display Name"
          name="display_name"
          required
        />
      </div>
      <Field autoComplete="given-name" label="First Name" name="first_name" />
      <Field autoComplete="family-name" label="Last Name" name="last_name" />
      <Field autoComplete="tel" label="Phone" name="phone" />
      <Field autoComplete="email" label="Email" name="email" type="email" />
      <Field autoComplete="organization-title" label="Job Title" name="job_title" />

      <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 sm:col-span-2">
        <input
          className="size-4 rounded border-zinc-300"
          defaultChecked
          name="is_active"
          type="checkbox"
        />
        Active
      </label>

      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Create Staff
        </button>
      </div>
    </form>
  );
}

function getInviteHref(token: string) {
  return `/staff/invite/${encodeURIComponent(token)}`;
}

function NoticeBanner({
  children,
  tone = "success",
}: {
  children: ReactNode;
  tone?: "danger" | "success";
}) {
  const className =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-800";

  return (
    <p className={`rounded-md border px-4 py-3 text-sm ${className}`}>
      {children}
    </p>
  );
}

function InviteLinkPanel({ token }: { token: string }) {
  const href = getInviteHref(token);

  return (
    <div className="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div>
        <p className="text-sm font-semibold text-emerald-950">Invite link ready</p>
        <p className="mt-1 text-sm text-emerald-800">
          Share this link with the staff member. Resending rotates it.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="min-h-10 flex-1 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-zinc-950"
          readOnly
          value={href}
        />
        <CopyInviteLinkButton value={href} />
      </div>
    </div>
  );
}

function AddStaffConnectionPanel({
  inviteEmail,
  invitePhone,
  inviteToken,
  lookupError,
  lookupResult,
  staff,
}: {
  inviteEmail: string;
  invitePhone: string;
  inviteToken?: string;
  lookupError?: string | null;
  lookupResult: StaffAccountExactSearchResult | null;
  staff: StaffDirectoryMember[];
}) {
  const searched = Boolean(inviteEmail || invitePhone);
  const unconnectedStaff = staff.filter(
    (member) => member.is_active && !member.account_user_id && !member.user_id,
  );

  return (
    <section className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <h3 className="text-base font-semibold text-zinc-950">
          Invite staff account
        </h3>
        <p className="mt-1 text-sm text-zinc-600">
          Search an exact email or phone before sending a connection invite.
        </p>
      </div>

      {inviteToken ? <InviteLinkPanel token={inviteToken} /> : null}
      {lookupError ? <NoticeBanner tone="danger">{lookupError}</NoticeBanner> : null}

      <form action="/staff" className="grid gap-3 sm:grid-cols-2" method="get">
        <input name="add" type="hidden" value="1" />
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">Email</span>
          <input
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            defaultValue={inviteEmail}
            name="invite_email"
            type="email"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">Phone</span>
          <input
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            defaultValue={invitePhone}
            name="invite_phone"
            type="tel"
          />
        </label>
        <div className="sm:col-span-2">
          <button
            className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
            type="submit"
          >
            Search account
          </button>
        </div>
      </form>

      {searched && lookupResult?.status === "ambiguous" ? (
        <NoticeBanner tone="danger">
          More than one account matched. Refine the email or phone.
        </NoticeBanner>
      ) : null}

      {searched && lookupResult?.status === "found" ? (
        <form
          action={createSalonStaffInviteFormAction}
          className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4"
        >
          <input name="mode" type="hidden" value="existing_account" />
          <input
            name="account_user_id"
            type="hidden"
            value={lookupResult.account.id}
          />
          <input name="email" type="hidden" value={inviteEmail} />
          <input name="phone" type="hidden" value={invitePhone} />

          <div className="flex items-center gap-3">
            <AvatarInitials
              name={lookupResult.account.display_name ?? "Account"}
            />
            <div>
              <p className="font-medium text-zinc-950">
                {lookupResult.account.display_name ?? "Existing account"}
              </p>
              <p className="text-sm text-zinc-500">
                {[lookupResult.account.masked_email, lookupResult.account.masked_phone]
                  .filter(Boolean)
                  .join(" / ") || "Matched account"}
              </p>
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-zinc-700">
              Staff profile
            </span>
            <select
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              name="staff_id"
            >
              <option value="">Create a new staff profile</option>
              {unconnectedStaff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.display_name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Display Name" name="display_name" />
            <Field label="Job Title" name="job_title" />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <input
              className="size-4 rounded border-zinc-300"
              defaultChecked
              name="is_active"
              type="checkbox"
            />
            Active
          </label>
          <button
            className="w-fit rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
            type="submit"
          >
            Send invite
          </button>
        </form>
      ) : null}

      {searched && lookupResult?.status === "not_found" ? (
        <form
          action={createSalonStaffInviteFormAction}
          className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4"
        >
          <input name="mode" type="hidden" value="new_account" />
          <input name="email" type="hidden" value={inviteEmail} />
          <input name="phone" type="hidden" value={invitePhone} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Full Name" name="display_name" required />
            </div>
            <Field label="Job Title" name="job_title" />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <input
              className="size-4 rounded border-zinc-300"
              defaultChecked
              name="is_active"
              type="checkbox"
            />
            Active
          </label>
          <button
            className="w-fit rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
            type="submit"
          >
            Create staff and invite
          </button>
        </form>
      ) : null}
    </section>
  );
}

function MetricCard({
  active,
  href,
  label,
  value,
}: {
  active?: boolean;
  href: string;
  label: string;
  value: number;
}) {
  return (
    <Link
      className={`rounded-lg border bg-white p-4 text-left shadow-sm ${
        active
          ? "border-zinc-950 ring-1 ring-zinc-950"
          : "border-zinc-200 hover:border-zinc-300"
      }`}
      href={href}
    >
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
    </Link>
  );
}

function StaffMetrics({
  activeFilter,
  query,
  readinessByStaffId,
  requests,
  staff,
}: {
  activeFilter: StaffFilter;
  query: string;
  readinessByStaffId?: Record<string, StaffBookingReadiness>;
  requests: SalonStaffConnectionRequestWithDetails[];
  staff: StaffDirectoryMember[];
}) {
  const metrics: Array<{ filter: StaffFilter; label: string; value: number }> = [
    {
      filter: "active",
      label: "Active Staff",
      value: staff.filter(isEmploymentActive).length,
    },
    {
      filter: "connected",
      label: "Connected Accounts",
      value: staff.filter(isConnected).length,
    },
    {
      filter: "need_contact",
      label: "Need Contact",
      value: staff.filter(needsContact).length,
    },
    {
      filter: "ready_invite",
      label: "Ready to Invite",
      value: staff.filter((member) => isReadyToInvite(member, requests)).length,
    },
    {
      filter: "missing_setup",
      label: "Missing Setup",
      value: staff.filter((member) =>
        hasMissingSetup(member, readinessByStaffId?.[member.id]),
      ).length,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {metrics.map((metric) => (
        <MetricCard
          active={activeFilter === metric.filter}
          href={getStaffHref({ filter: metric.filter, query })}
          key={metric.filter}
          label={metric.label}
          value={metric.value}
        />
      ))}
    </div>
  );
}

function StaffSearch({
  activeFilter,
  query,
}: {
  activeFilter: StaffFilter;
  query: string;
}) {
  return (
    <form
      action="/staff"
      className="flex w-full flex-col gap-3 sm:flex-row sm:items-center"
      method="get"
    >
      <input name="filter" type="hidden" value={activeFilter} />
      <label className="sr-only" htmlFor="staff-search">
        Search staff
      </label>
      <input
        className="min-h-10 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
        defaultValue={query}
        id="staff-search"
        name="q"
        placeholder="Search staff..."
        type="search"
      />
      <div className="flex gap-2">
        <button
          className="min-h-10 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Search
        </button>
        {query ? (
          <Link
            className="inline-flex min-h-10 items-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href={getStaffHref({ filter: activeFilter })}
          >
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}

function StaffFilterTabs({
  activeFilter,
  query,
}: {
  activeFilter: StaffFilter;
  query: string;
}) {
  return (
    <nav aria-label="Staff filters" className="flex flex-wrap gap-2">
      {STAFF_FILTERS.map((filter) => {
        const isActive = filter.id === activeFilter;

        return (
          <Link
            className={
              isActive
                ? "rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white"
                : "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-400"
            }
            href={getStaffHref({ filter: filter.id, query })}
            key={filter.id}
          >
            {filter.label}
          </Link>
        );
      })}
    </nav>
  );
}

function AccountCell({
  member,
  requests,
}: {
  member: StaffDirectoryMember;
  requests: SalonStaffConnectionRequestWithDetails[];
}) {
  const status = getAccountStatus(member, requests);

  return (
    <div className="grid gap-1">
      <Badge tone={status.tone}>{status.label}</Badge>
      <span className="text-xs text-zinc-500">{bestContact(member)}</span>
    </div>
  );
}

function PayrollSetupCell({
  canManagePayroll,
  member,
}: {
  canManagePayroll: boolean;
  member: StaffDirectoryMember;
}) {
  if (member.payroll_setup_status === "restricted") {
    return (
      <div className="grid gap-1">
        <Badge>Restricted</Badge>
        <span className="text-xs text-zinc-500">Payroll permission needed</span>
      </div>
    );
  }

  if (member.payroll_setup_status === "configured") {
    return <Badge tone="success">Configured</Badge>;
  }

  return (
    <div className="grid gap-1">
      <Badge tone="warning">Missing Setup</Badge>
      {canManagePayroll ? (
        <Link
          className="text-xs font-medium text-zinc-950 underline"
          href={`/payroll?tab=settings&editStaff=${member.id}`}
        >
          Set Payroll
        </Link>
      ) : null}
    </div>
  );
}

function RoleCell({ member }: { member: StaffDirectoryMember }) {
  if (cleanValue(member.job_title)) {
    return <span className="text-zinc-700">{member.job_title}</span>;
  }

  return (
    <Badge tone={member.is_active ? "warning" : "neutral"}>
      {member.is_active ? "Need role" : "No role"}
    </Badge>
  );
}

function ActionButton({
  children,
  disabled = false,
  href,
  tone = "secondary",
}: {
  children: ReactNode;
  disabled?: boolean;
  href?: string;
  tone?: "primary" | "secondary";
}) {
  const className =
    tone === "primary"
      ? "inline-flex min-h-9 items-center justify-center rounded-md bg-zinc-950 px-3 py-1.5 text-xs font-medium text-white"
      : "inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-950";

  if (href && !disabled) {
    return (
      <Link className={className} href={href}>
        {children}
      </Link>
    );
  }

  return (
    <button
      className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}
      disabled
      type="button"
    >
      {children}
    </button>
  );
}

function PrimaryStaffAction({
  canManagePayroll,
  detailHref,
  member,
  organizationId,
  requests,
}: {
  canManagePayroll: boolean;
  detailHref: string;
  member: StaffDirectoryMember;
  organizationId: string;
  requests: SalonStaffConnectionRequestWithDetails[];
}) {
  const accountStatus = getAccountStatus(member, requests).kind;

  if (accountStatus === "need_contact") {
    return (
      <ActionButton href={detailHref} tone="primary">
        Add Contact
      </ActionButton>
    );
  }

  if (accountStatus === "ready_to_invite") {
    return (
      <ActionButton disabled tone="primary">
        Send Invite
      </ActionButton>
    );
  }

  if (accountStatus === "invite_sent") {
    return (
      <ActionButton disabled tone="primary">
        Resend Invite
      </ActionButton>
    );
  }

  if (member.payroll_setup_status === "missing") {
    return (
      <ActionButton
        disabled={!canManagePayroll}
        href={`/payroll?tab=settings&editStaff=${member.id}`}
        tone="primary"
      >
        Set Payroll
      </ActionButton>
    );
  }

  if (accountStatus === "connected") {
    return (
      <ActionButton
        href={`/organizations/${organizationId}/members`}
        tone="primary"
      >
        View Account
      </ActionButton>
    );
  }

  return (
    <ActionButton href={detailHref} tone="primary">
      View
    </ActionButton>
  );
}

function StaffDirectoryTable({
  activeFilter,
  canManagePayroll,
  hasAnyStaff,
  organizationId,
  query,
  readinessByStaffId,
  requests,
  staff,
}: {
  activeFilter: StaffFilter;
  canManagePayroll: boolean;
  hasAnyStaff: boolean;
  organizationId: string;
  query: string;
  readinessByStaffId?: Record<string, StaffBookingReadiness>;
  requests: SalonStaffConnectionRequestWithDetails[];
  staff: StaffDirectoryMember[];
}) {
  if (staff.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">
          {hasAnyStaff ? "No matching staff" : "No staff yet"}
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          {hasAnyStaff
            ? "Try a different search or filter."
            : "Create your first staff member for this salon."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
      <table className="w-full min-w-[1100px] divide-y divide-zinc-200 text-left text-sm">
        <thead className="bg-zinc-50 text-xs font-medium uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-3" scope="col">
              Staff
            </th>
            <th className="px-4 py-3" scope="col">
              Role
            </th>
            <th className="px-4 py-3" scope="col">
              Account
            </th>
            <th className="px-4 py-3" scope="col">
              Booking
            </th>
            <th className="px-4 py-3" scope="col">
              POS
            </th>
            <th className="px-4 py-3" scope="col">
              Payroll Setup
            </th>
            <th className="px-4 py-3" scope="col">
              Status
            </th>
            <th className="px-4 py-3" scope="col">
              Action
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {staff.map((member) => {
            const bookingStatus = getBookingStatus(
              member,
              readinessByStaffId?.[member.id],
            );
            const posStatus = getPosStatus(member);
            const detailHref = getStaffHref({
              filter: activeFilter,
              query,
              staffId: member.id,
            });

            return (
              <tr className="hover:bg-zinc-50" key={member.id}>
                <td className="max-w-72 px-4 py-4 align-top">
                  <div className="flex min-w-0 items-center gap-3">
                    <AvatarInitials name={member.display_name} />
                    <div className="min-w-0">
                      <Link
                        className="truncate font-medium text-zinc-950 hover:underline"
                        href={detailHref}
                      >
                        {member.display_name}
                      </Link>
                      <p className="mt-1 truncate text-xs text-zinc-500">
                        {bestContact(member)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 align-top">
                  <RoleCell member={member} />
                </td>
                <td className="px-4 py-4 align-top">
                  <AccountCell member={member} requests={requests} />
                </td>
                <td className="px-4 py-4 align-top">
                  <Badge tone={bookingStatus.tone}>{bookingStatus.label}</Badge>
                </td>
                <td className="px-4 py-4 align-top">
                  <Badge tone={posStatus.tone}>{posStatus.label}</Badge>
                </td>
                <td className="px-4 py-4 align-top">
                  <PayrollSetupCell
                    canManagePayroll={canManagePayroll}
                    member={member}
                  />
                </td>
                <td className="px-4 py-4 align-top">
                  <StatusBadge isActive={isEmploymentActive(member)} />
                </td>
                <td className="px-4 py-4 align-top">
                  <div className="flex flex-wrap gap-2">
                    <PrimaryStaffAction
                      canManagePayroll={canManagePayroll}
                      detailHref={detailHref}
                      member={member}
                      organizationId={organizationId}
                      requests={requests}
                    />
                    <ActionButton href={detailHref}>View</ActionButton>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SlideOver({
  children,
  closeHref,
  subtitle,
  title,
}: {
  children: ReactNode;
  closeHref: string;
  subtitle?: string;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <Link
        aria-label="Close"
        className="absolute inset-0 bg-zinc-950/30"
        href={closeHref}
      />
      <aside
        aria-modal="true"
        className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-zinc-950">{title}</h2>
            {subtitle ? (
              <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
            ) : null}
          </div>
          <Link
            aria-label="Close"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-950"
            href={closeHref}
          >
            Close
          </Link>
        </header>
        <div className="grid gap-5 px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium uppercase text-zinc-500">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-zinc-950">{value}</dd>
    </div>
  );
}

function DetailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-950">{title}</h3>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function DetailActions({
  canManagePayroll,
  member,
  requests,
}: {
  canManagePayroll: boolean;
  member: StaffDirectoryMember;
  requests: SalonStaffConnectionRequestWithDetails[];
}) {
  const accountStatus = getAccountStatus(member, requests).kind;

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {accountStatus === "need_contact" ? (
        <ActionButton disabled>Add Contact</ActionButton>
      ) : null}
      {accountStatus === "ready_to_invite" ? (
        <ActionButton disabled>Send Invite</ActionButton>
      ) : null}
      {accountStatus === "invite_sent" ? (
        <>
          <ActionButton disabled>Resend Invite</ActionButton>
          <ActionButton disabled>Cancel</ActionButton>
          <ActionButton disabled>Copy Invite Link</ActionButton>
          <ActionButton disabled>Show QR Code</ActionButton>
        </>
      ) : null}
      {accountStatus === "connected" ? (
        <ActionButton disabled>Disconnect Account</ActionButton>
      ) : null}
      {member.payroll_setup_status === "missing" ? (
        <ActionButton
          disabled={!canManagePayroll}
          href={`/payroll?tab=settings&editStaff=${member.id}`}
        >
          Payroll Settings
        </ActionButton>
      ) : null}
    </div>
  );
}

function StaffDetailDrawer({
  bookingSetup,
  canManagePayroll,
  closeHref,
  member,
  requests,
  setupMode,
}: {
  bookingSetup: BookingSetupData;
  canManagePayroll: boolean;
  closeHref: string;
  member: StaffDirectoryMember;
  requests: SalonStaffConnectionRequestWithDetails[];
  setupMode?: string;
}) {
  const accountStatus = getAccountStatus(member, requests);
  const bookingStatus = getBookingStatus(
    member,
    bookingSetup.readinessByStaffId[member.id],
  );
  const posStatus = getPosStatus(member);
  const connectedUser = member.connected_user;

  return (
    <SlideOver
      closeHref={closeHref}
      subtitle={bestContact(member)}
      title={member.display_name}
    >
      <div className="flex items-center gap-3">
        <AvatarInitials name={member.display_name} />
        <div>
          <p className="font-semibold text-zinc-950">{member.display_name}</p>
          <p className="text-sm text-zinc-500">
            {cleanValue(member.job_title) || "Need role"}
          </p>
        </div>
      </div>

      <DetailSection title="Profile">
        <DetailField label="Display Name" value={member.display_name} />
        <DetailField
          label="Nickname"
          value={cleanValue(member.first_name) || "No nickname"}
        />
        <DetailField
          label="Role"
          value={cleanValue(member.job_title) || "Need role"}
        />
        <DetailField
          label="Employment Status"
          value={<StatusBadge isActive={isEmploymentActive(member)} />}
        />
        <DetailField
          label="Contact Phone"
          value={cleanValue(member.phone) || "No phone"}
        />
        <DetailField
          label="Contact Email"
          value={cleanValue(member.email) || "No email"}
        />
      </DetailSection>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">
            Public Staff Profile
          </h3>
          <p className="mt-1 text-sm text-zinc-600">
            This is the staff identity customers see on Salon Profile.
          </p>
        </div>
        <div className="mt-4">
          <StaffPublicProfileEditor
            avatarUrl={getSalonProfileMediaUrl(member.public_profile_photo_path)}
            bio={member.public_bio}
            canChangeConsent={false}
            displayName={member.display_name}
            jobTitle={member.job_title}
            onlineBookingEnabled={member.online_booking_enabled}
            ownerPublicEnabled={member.owner_public_enabled}
            publicProfileVisible={member.public_profile_visible}
            staffPublicConsentStatus={member.staff_public_consent_status}
            specialties={member.specialties}
            staffId={member.id}
          />
        </div>
      </section>

      <DetailSection title="Account Connection">
        <DetailField
          label="Account Status"
          value={<Badge tone={accountStatus.tone}>{accountStatus.label}</Badge>}
        />
        <DetailField
          label="Connected User"
          value={
            connectedUser?.display_name ||
            connectedUser?.email ||
            (member.user_id ? "Connected auth user" : "No connected user")
          }
        />
        <DetailField
          label="Connected Date"
          value={formatDateTime(connectedUser?.created_at)}
        />
        <DetailField label="Best Contact" value={bestContact(member)} />
        <div className="sm:col-span-2">
          <DetailActions
            canManagePayroll={canManagePayroll}
            member={member}
            requests={requests}
          />
        </div>
      </DetailSection>

      <DetailSection title="Setup Status">
        <DetailField
          label="Booking"
          value={<Badge tone={bookingStatus.tone}>{bookingStatus.label}</Badge>}
        />
        <DetailField
          label="POS"
          value={<Badge tone={posStatus.tone}>{posStatus.label}</Badge>}
        />
        <DetailField
          label="Payroll"
          value={
            <PayrollSetupCell
              canManagePayroll={canManagePayroll}
              member={member}
            />
          }
        />
        <DetailField
          label="Shortcuts"
          value={
            <div className="flex flex-wrap gap-2">
              <ActionButton href={`/staff?staff=${member.id}&setup=booking`}>
                Booking Setup
              </ActionButton>
              <ActionButton disabled>POS Setup</ActionButton>
              <ActionButton
                disabled={!canManagePayroll}
                href={`/payroll?tab=settings&editStaff=${member.id}`}
              >
                Payroll Settings
              </ActionButton>
            </div>
          }
        />
      </DetailSection>
      {setupMode === "booking" ? (
        <StaffServicesBookingEditor
          assignments={bookingSetup.assignments}
          canManage={bookingSetup.permissions.canManageAssignments}
          readiness={bookingSetup.readinessByStaffId[member.id]}
          services={bookingSetup.services}
          staff={member}
        />
      ) : null}
    </SlideOver>
  );
}

function BookingSetupStaffSelector({
  activeFilter,
  query,
  readinessByStaffId,
  staff,
}: {
  activeFilter: StaffFilter;
  query: string;
  readinessByStaffId: Record<string, StaffBookingReadiness>;
  staff: StaffDirectoryMember[];
}) {
  const candidates = staff
    .filter((member) => member.is_active)
    .sort((left, right) => {
      const leftReady = readinessByStaffId[left.id]?.ready ? 1 : 0;
      const rightReady = readinessByStaffId[right.id]?.ready ? 1 : 0;

      return leftReady - rightReady || left.display_name.localeCompare(right.display_name);
    });

  return (
    <section className="grid gap-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-950">
          Select staff for booking setup
        </h2>
        <p className="mt-1 text-sm text-amber-900">
          Staff service assignments are edited from each staff profile.
        </p>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {candidates.map((member) => {
          const readiness = readinessByStaffId[member.id];

          return (
            <Link
              className="rounded-md border border-amber-200 bg-white p-3 hover:border-zinc-950"
              href={getStaffHref({
                filter: activeFilter,
                query,
                staffId: member.id,
              }).concat("&setup=booking")}
              key={member.id}
            >
              <p className="font-semibold text-zinc-950">{member.display_name}</p>
              <p className="mt-1 text-sm text-zinc-600">
                {readiness?.ready
                  ? "Ready"
                  : readiness?.reasons.map((reason) => reason.label).join(", ") ||
                    "Needs setup"}
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function AddStaffDrawer({
  canManageStaff,
  closeHref,
  error,
  inviteEmail,
  invitePhone,
  inviteToken,
  lookupError,
  lookupResult,
  staff,
}: {
  canManageStaff: boolean;
  closeHref: string;
  error?: string;
  inviteEmail: string;
  invitePhone: string;
  inviteToken?: string;
  lookupError?: string | null;
  lookupResult: StaffAccountExactSearchResult | null;
  staff: StaffDirectoryMember[];
}) {
  return (
    <SlideOver
      closeHref={closeHref}
      subtitle="Create a profile or invite a staff account."
      title="Add Staff"
    >
      {canManageStaff ? (
        <AddStaffConnectionPanel
          inviteEmail={inviteEmail}
          invitePhone={invitePhone}
          inviteToken={inviteToken}
          lookupError={lookupError}
          lookupResult={lookupResult}
          staff={staff}
        />
      ) : null}
      <StaffForm canManageStaff={canManageStaff} error={error} />
    </SlideOver>
  );
}

function connectionStatusTone(status: string): BadgeTone {
  if (status === "accepted") {
    return "success";
  }

  if (status === "pending") {
    return "warning";
  }

  if (status === "declined" || status === "revoked" || status === "expired") {
    return "danger";
  }

  return "neutral";
}

function requestApplicantName(request: SalonStaffConnectionRequestWithDetails) {
  return request.account?.display_name ?? request.account?.masked_email ?? "Applicant";
}

function requestStaffName(request: SalonStaffConnectionRequestWithDetails) {
  return request.staff?.display_name ?? "Staff profile";
}

function requestContact(request: SalonStaffConnectionRequestWithDetails) {
  const values = [
    request.account?.masked_email,
    request.account?.masked_phone,
    request.target_email_normalized,
    request.target_phone_e164,
    request.staff?.email,
    request.staff?.phone,
  ].filter(Boolean);

  return values.join(" / ") || "No contact";
}

function EmptyConnectionState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
      {children}
    </p>
  );
}

function IncomingApplicationsSection({
  requests,
  staff,
}: {
  requests: SalonStaffConnectionRequestWithDetails[];
  staff: StaffDirectoryMember[];
}) {
  const unconnectedStaff = staff.filter(
    (member) => member.is_active && !member.account_user_id && !member.user_id,
  );

  if (requests.length === 0) {
    return <EmptyConnectionState>No incoming applications.</EmptyConnectionState>;
  }

  return (
    <div className="grid gap-3">
      {requests.map((request) => (
        <article
          className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4"
          key={request.id}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold text-zinc-950">
                {requestApplicantName(request)}
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                {requestContact(request)}
              </p>
              <p className="mt-1 text-sm text-zinc-600">
                Requested title: {request.requested_job_title ?? "Not specified"}
              </p>
              {request.message ? (
                <p className="mt-2 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                  {request.message}
                </p>
              ) : null}
            </div>
            <Badge tone="warning">Submitted {formatDateTime(request.created_at)}</Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            <details className="w-full rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <summary className="cursor-pointer text-sm font-medium text-zinc-950">
                Accept application
              </summary>
              <form
                action={reviewStaffSalonApplicationFormAction}
                className="mt-4 grid gap-3 sm:grid-cols-2"
              >
                <input name="request_id" type="hidden" value={request.id} />
                <input name="decision" type="hidden" value="accepted" />
                <label className="block sm:col-span-2">
                  <span className="text-sm font-medium text-zinc-700">
                    Staff profile
                  </span>
                  <select
                    className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                    name="staff_id"
                  >
                    <option value="__new">Create a new staff profile</option>
                    {unconnectedStaff.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">
                    Full Name
                  </span>
                  <input
                    className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                    defaultValue={request.account?.display_name ?? ""}
                    name="display_name"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">
                    Job Title
                  </span>
                  <input
                    className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                    defaultValue={request.requested_job_title ?? ""}
                    name="job_title"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">Email</span>
                  <input
                    className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                    name="email"
                    type="email"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-zinc-700">Phone</span>
                  <input
                    className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                    name="phone"
                    type="tel"
                  />
                </label>
                <div className="sm:col-span-2">
                  <button
                    className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
                    type="submit"
                  >
                    Accept
                  </button>
                </div>
              </form>
            </details>

            <form action={reviewStaffSalonApplicationFormAction}>
              <input name="request_id" type="hidden" value={request.id} />
              <input name="decision" type="hidden" value="declined" />
              <button
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-950"
                type="submit"
              >
                Decline
              </button>
            </form>
          </div>
        </article>
      ))}
    </div>
  );
}

function OutgoingInvitationsSection({
  inviteRequestId,
  inviteToken,
  requests,
}: {
  inviteRequestId?: string;
  inviteToken?: string;
  requests: SalonStaffConnectionRequestWithDetails[];
}) {
  if (requests.length === 0) {
    return <EmptyConnectionState>No outgoing invitations.</EmptyConnectionState>;
  }

  return (
    <div className="grid gap-3">
      {requests.map((request) => {
        const canMutate = request.status === "pending" || request.status === "expired";
        const currentToken = inviteRequestId === request.id ? inviteToken : null;

        return (
          <article
            className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4"
            key={request.id}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-zinc-950">
                  {requestStaffName(request)}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  {requestContact(request)}
                </p>
                <p className="mt-1 text-sm text-zinc-600">
                  Sent {formatDateTime(request.created_at)} · Expires{" "}
                  {formatDateTime(request.expires_at)}
                </p>
              </div>
              <Badge tone={connectionStatusTone(request.status)}>
                {request.status}
              </Badge>
            </div>

            {currentToken ? <InviteLinkPanel token={currentToken} /> : null}

            <div className="flex flex-wrap gap-2">
              <form action={resendSalonStaffInviteFormAction}>
                <input name="request_id" type="hidden" value={request.id} />
                <button
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canMutate}
                  type="submit"
                >
                  Resend
                </button>
              </form>
              <form action={revokeSalonStaffInviteFormAction}>
                <input name="request_id" type="hidden" value={request.id} />
                <button
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={request.status !== "pending"}
                  type="submit"
                >
                  Revoke
                </button>
              </form>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ConnectionHistorySection({
  requests,
}: {
  requests: SalonStaffConnectionRequestWithDetails[];
}) {
  if (requests.length === 0) {
    return <EmptyConnectionState>No connection history yet.</EmptyConnectionState>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {requests.map((request) => (
        <article
          className="rounded-lg border border-zinc-200 bg-white p-4"
          key={request.id}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-zinc-950">
                {request.direction === "staff_application"
                  ? requestApplicantName(request)
                  : requestStaffName(request)}
              </p>
              <p className="mt-1 text-sm text-zinc-500">{requestContact(request)}</p>
            </div>
            <Badge tone={connectionStatusTone(request.status)}>
              {request.status}
            </Badge>
          </div>
          <p className="mt-3 text-sm text-zinc-600">
            {request.direction === "staff_application"
              ? "Application"
              : "Invitation"}{" "}
            · Updated {formatDateTime(request.updated_at)}
          </p>
        </article>
      ))}
    </div>
  );
}

function StaffConnectionRequestsSection({
  inviteRequestId,
  inviteToken,
  requests,
  staff,
}: {
  inviteRequestId?: string;
  inviteToken?: string;
  requests: SalonStaffConnectionRequestWithDetails[];
  staff: StaffDirectoryMember[];
}) {
  const incomingApplications = requests.filter(
    (request) =>
      request.direction === "staff_application" && request.status === "pending",
  );
  const outgoingInvitations = requests.filter(
    (request) =>
      request.direction === "salon_invite" &&
      (request.status === "pending" || request.status === "expired"),
  );
  const history = requests.filter(
    (request) =>
      request.status !== "pending" &&
      !(request.direction === "salon_invite" && request.status === "expired"),
  );

  return (
    <section className="grid gap-5">
      <div>
        <h2 className="text-xl font-semibold text-zinc-950">Requests</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Review applications and manage staff invitations for this salon.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="grid gap-3">
          <h3 className="text-base font-semibold text-zinc-950">
            Incoming Applications
          </h3>
          <IncomingApplicationsSection
            requests={incomingApplications}
            staff={staff}
          />
        </section>

        <section className="grid gap-3">
          <h3 className="text-base font-semibold text-zinc-950">
            Outgoing Invitations
          </h3>
          <OutgoingInvitationsSection
            inviteRequestId={inviteRequestId}
            inviteToken={inviteToken}
            requests={outgoingInvitations}
          />
        </section>
      </div>

      <section className="grid gap-3">
        <h3 className="text-base font-semibold text-zinc-950">History</h3>
        <ConnectionHistorySection requests={history} />
      </section>
    </section>
  );
}

export default async function StaffPage({ searchParams }: StaffPageProps) {
  const [params, context] = await Promise.all([
    searchParams,
    requireSalonManagePageContext("/staff"),
  ]);
  const error = stringParam(params.error);
  const connectionError = stringParam(params.connection_error);
  const connectionNotice = stringParam(params.connection_notice);
  const inviteEmail = stringParam(params.invite_email)?.trim() ?? "";
  const invitePhone = stringParam(params.invite_phone)?.trim() ?? "";
  const inviteRequestId = stringParam(params.invite_request);
  const inviteToken = stringParam(params.invite_token);
  const query = stringParam(params.q)?.trim() ?? "";
  const setupMode = stringParam(params.setup);
  const activeFilter = getStaffFilter(stringParam(params.filter));
  const selectedStaffId = stringParam(params.staff);
  const showAddStaff =
    stringParam(params.add) === "1" || Boolean(error) || Boolean(inviteToken);

  const canViewStaff = await hasPermission(STAFF_PERMISSIONS.view, context);

  if (!canViewStaff) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">Staff</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Manage staff profiles, account connection, booking setup, and POS access.
        </p>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to view staff.
        </p>
      </main>
    );
  }

  const [directory, bookingSetup, canManageStaff, canManagePayroll] = await Promise.all([
    getCurrentSalonStaffDirectory(context),
    getCurrentSalonBookingSetup(context),
    hasPermission(STAFF_PERMISSIONS.manage, context),
    hasPermission("payroll.manage", context),
  ]);
  const connectionRequests = canManageStaff
    ? (await getSalonStaffConnectionRequests()).requests
    : [];
  let lookupResult: StaffAccountExactSearchResult | null = null;
  let lookupError: string | null = null;

  if (showAddStaff && canManageStaff && (inviteEmail || invitePhone)) {
    try {
      lookupResult = await searchStaffAccountExact({
        email: inviteEmail || null,
        phone: invitePhone || null,
      });
    } catch (lookupErrorValue) {
      lookupError =
        lookupErrorValue instanceof Error
          ? lookupErrorValue.message
          : "Account lookup failed.";
    }
  }

  const visibleStaff = getVisibleStaff({
    filter: activeFilter,
    query,
    readinessByStaffId: bookingSetup.readinessByStaffId,
    requests: connectionRequests,
    staff: directory.staff,
  });
  const closeHref = getStaffHref({ filter: activeFilter, query });
  const selectedStaff =
    selectedStaffId && !showAddStaff
      ? directory.staff.find((member) => member.id === selectedStaffId)
      : null;
  const organizationId = context.currentOrganization?.id ?? "";

  return (
    <>
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-zinc-950">Staff</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Manage staff profiles, account connection, booking setup, and POS access.
            </p>
          </div>
          {canManageStaff ? (
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              href={getStaffHref({ add: true, filter: activeFilter, query })}
            >
              + Add Staff
            </Link>
          ) : null}
        </header>

        <StaffMetrics
          activeFilter={activeFilter}
          query={query}
          readinessByStaffId={bookingSetup.readinessByStaffId}
          requests={connectionRequests}
          staff={directory.staff}
        />

        {connectionNotice ? (
          <NoticeBanner>{connectionNotice}</NoticeBanner>
        ) : null}
        {connectionError ? (
          <NoticeBanner tone="danger">{connectionError}</NoticeBanner>
        ) : null}

        <section>
          <div className="flex flex-col gap-4">
            <StaffSearch activeFilter={activeFilter} query={query} />
            <StaffFilterTabs activeFilter={activeFilter} query={query} />
          </div>
          {setupMode === "services" && !selectedStaff ? (
            <div className="mt-4">
              <BookingSetupStaffSelector
                activeFilter={activeFilter}
                query={query}
                readinessByStaffId={bookingSetup.readinessByStaffId}
                staff={directory.staff}
              />
            </div>
          ) : null}
          <StaffDirectoryTable
            activeFilter={activeFilter}
            canManagePayroll={canManagePayroll}
            hasAnyStaff={directory.staff.length > 0}
            organizationId={organizationId}
            query={query}
            readinessByStaffId={bookingSetup.readinessByStaffId}
            requests={connectionRequests}
            staff={visibleStaff}
          />
        </section>

        {canManageStaff ? (
          <StaffConnectionRequestsSection
            inviteRequestId={inviteRequestId}
            inviteToken={inviteToken}
            requests={connectionRequests}
            staff={directory.staff}
          />
        ) : null}
      </main>

      {showAddStaff ? (
        <AddStaffDrawer
          canManageStaff={canManageStaff}
          closeHref={closeHref}
          error={error}
          inviteEmail={inviteEmail}
          invitePhone={invitePhone}
          inviteToken={inviteToken}
          lookupError={lookupError}
          lookupResult={lookupResult}
          staff={directory.staff}
        />
      ) : null}
      {selectedStaff ? (
        <StaffDetailDrawer
          bookingSetup={bookingSetup}
          canManagePayroll={canManagePayroll}
          closeHref={closeHref}
          member={selectedStaff}
          requests={connectionRequests}
          setupMode={setupMode}
        />
      ) : null}
    </>
  );
}
