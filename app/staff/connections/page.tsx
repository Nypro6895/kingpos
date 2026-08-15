import {
  acceptStaffInviteByRequestFormAction,
  cancelStaffSalonApplicationFormAction,
  declineStaffInviteByRequestFormAction,
  submitStaffSalonApplicationFormAction,
} from "@/app/staff/actions";
import {
  getStaffConnectionDashboard,
  searchPublicStaffApplicationSalons,
} from "@/lib/staff-salon-connections";
import Link from "next/link";
import { redirect } from "next/navigation";
import type {
  PublicStaffApplicationSalon,
  StaffConnectionDashboardRequest,
} from "@/types/staff-salon-connection";

type StaffConnectionsPageProps = {
  searchParams: Promise<{
    city?: string;
    connection_error?: string;
    connection_notice?: string;
    q?: string;
    state?: string;
  }>;
};

function clean(value: string | null | undefined) {
  return value?.trim() ?? "";
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

function formatAddress(input: {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}) {
  return [
    input.address_line1,
    input.address_line2,
    [input.city, input.state, input.postal_code].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "accepted"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "pending"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <span
      className={`inline-flex min-h-7 w-fit items-center rounded-md border px-2.5 py-1 text-xs font-medium ${className}`}
    >
      {status}
    </span>
  );
}

function Notice({
  children,
  tone = "success",
}: {
  children: React.ReactNode;
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
      {children}
    </p>
  );
}

function StaffInvitationCard({
  request,
}: {
  request: StaffConnectionDashboardRequest;
}) {
  const address = formatAddress(request);
  const canRespond = request.status === "pending";

  return (
    <article className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-lg font-semibold text-zinc-950">
            {request.salon_name}
          </p>
          {address ? <p className="mt-1 text-sm text-zinc-600">{address}</p> : null}
          <p className="mt-2 text-sm text-zinc-600">
            Invited as {request.staff_job_title ?? "Staff"} · Expires{" "}
            {formatDateTime(request.expires_at)}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      {canRespond ? (
        <div className="flex flex-wrap gap-2">
          <form action={acceptStaffInviteByRequestFormAction}>
            <input name="request_id" type="hidden" value={request.id} />
            <button
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              type="submit"
            >
              Accept
            </button>
          </form>
          <form action={declineStaffInviteByRequestFormAction}>
            <input name="request_id" type="hidden" value={request.id} />
            <button
              className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
              type="submit"
            >
              Decline
            </button>
          </form>
        </div>
      ) : null}
    </article>
  );
}

function StaffApplicationCard({
  request,
}: {
  request: StaffConnectionDashboardRequest;
}) {
  const address = formatAddress(request);

  return (
    <article className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-lg font-semibold text-zinc-950">
            {request.salon_name}
          </p>
          {address ? <p className="mt-1 text-sm text-zinc-600">{address}</p> : null}
          <p className="mt-2 text-sm text-zinc-600">
            Submitted {formatDateTime(request.created_at)} · Requested title{" "}
            {request.requested_job_title ?? "Not specified"}
          </p>
          {request.message ? (
            <p className="mt-2 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              {request.message}
            </p>
          ) : null}
        </div>
        <StatusBadge status={request.status} />
      </div>

      {request.status === "pending" ? (
        <form action={cancelStaffSalonApplicationFormAction}>
          <input name="request_id" type="hidden" value={request.id} />
          <button
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
            type="submit"
          >
            Cancel application
          </button>
        </form>
      ) : request.status === "accepted" ? (
        <Link
          className="w-fit rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          href="/staff/my-work"
        >
          Open staff workplace
        </Link>
      ) : null}
    </article>
  );
}

function SalonResultCard({ salon }: { salon: PublicStaffApplicationSalon }) {
  const address = formatAddress({
    address_line1: salon.address_line1,
    address_line2: salon.address_line2,
    city: salon.city,
    postal_code: salon.postal_code,
    state: salon.state,
  });

  return (
    <article className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div>
        <p className="text-lg font-semibold text-zinc-950">{salon.salon_name}</p>
        {address ? <p className="mt-1 text-sm text-zinc-600">{address}</p> : null}
      </div>
      <form action={submitStaffSalonApplicationFormAction} className="grid gap-3">
        <input name="salon_id" type="hidden" value={salon.salon_id} />
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">
            Requested title
          </span>
          <input
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            name="requested_job_title"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">Message</span>
          <textarea
            className="mt-2 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            name="message"
          />
        </label>
        <button
          className="w-fit rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Apply
        </button>
      </form>
    </article>
  );
}

export default async function StaffConnectionsPage({
  searchParams,
}: StaffConnectionsPageProps) {
  const params = await searchParams;
  const query = clean(params.q);
  const city = clean(params.city);
  const state = clean(params.state);
  const [{ context, requests }, salonResults] = await Promise.all([
    getStaffConnectionDashboard(),
    query || city || state
      ? searchPublicStaffApplicationSalons({ city, query, state })
      : Promise.resolve([] as PublicStaffApplicationSalon[]),
  ]);

  if (!context.user) {
    redirect("/login?next=/staff/connections");
  }

  const invitations = requests.filter(
    (request) => request.direction === "salon_invite",
  );
  const applications = requests.filter(
    (request) => request.direction === "staff_application",
  );
  const connected = requests.filter((request) => request.status === "accepted");

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:px-8">
      {params.connection_notice ? (
        <Notice>{params.connection_notice}</Notice>
      ) : null}
      {params.connection_error ? (
        <Notice tone="danger">{params.connection_error}</Notice>
      ) : null}

      {connected.length > 0 ? (
        <section className="grid gap-3">
          <h2 className="text-xl font-semibold text-zinc-950">Connected</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {connected.map((request) => (
              <Link
                className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm font-medium text-emerald-950"
                href="/staff/my-work"
                key={request.id}
              >
                {request.salon_name} · Open staff workplace
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-xl font-semibold text-zinc-950">Invitations</h2>
        {invitations.length > 0 ? (
          <div className="grid gap-3">
            {invitations.map((request) => (
              <StaffInvitationCard key={request.id} request={request} />
            ))}
          </div>
        ) : (
          <EmptyState>No invitations for this account.</EmptyState>
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-xl font-semibold text-zinc-950">My Applications</h2>
        {applications.length > 0 ? (
          <div className="grid gap-3">
            {applications.map((request) => (
              <StaffApplicationCard key={request.id} request={request} />
            ))}
          </div>
        ) : (
          <EmptyState>No applications submitted.</EmptyState>
        )}
      </section>

      <section className="grid gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-950">Apply to Salon</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Search active salons that allow staff applications.
          </p>
        </div>

        <form
          action="/staff/connections"
          className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-4"
          method="get"
        >
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-zinc-700">Salon name</span>
            <input
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              defaultValue={query}
              name="q"
              type="search"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">City</span>
            <input
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              defaultValue={city}
              name="city"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">State</span>
            <input
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              defaultValue={state}
              name="state"
            />
          </label>
          <div className="sm:col-span-4">
            <button
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              type="submit"
            >
              Search
            </button>
          </div>
        </form>

        {query || city || state ? (
          salonResults.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {salonResults.map((salon) => (
                <SalonResultCard key={salon.salon_id} salon={salon} />
              ))}
            </div>
          ) : (
            <EmptyState>No application-enabled salons matched.</EmptyState>
          )
        ) : null}
      </section>
    </main>
  );
}
