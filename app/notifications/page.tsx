import {
  markAppNotificationReadAction,
  openAppNotificationAction,
} from "@/app/notifications/actions";
import {
  acceptStaffInviteByRequestFormAction,
  cancelStaffSalonApplicationFormAction,
  declineStaffInviteByRequestFormAction,
} from "@/app/staff/actions";
import {
  getCurrentAppNotifications,
  type AppNotification,
} from "@/lib/app-notifications";
import { hasPermission } from "@/lib/permissions";
import {
  getSalonStaffConnectionRequests,
  getStaffConnectionDashboard,
} from "@/lib/staff-salon-connections";
import { getAppNotificationScopeForContext } from "@/lib/workspace-pending";
import Link from "next/link";
import { redirect } from "next/navigation";
import type {
  SalonStaffConnectionRequestWithDetails,
  StaffConnectionDashboardRequest,
} from "@/types/staff-salon-connection";

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(date);
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "pending"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : status === "accepted"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <span className={`w-fit rounded-md border px-2 py-1 text-xs font-semibold ${className}`}>
      {status}
    </span>
  );
}

function NotificationKindBadge({ kind }: { kind: AppNotification["recipient_kind"] }) {
  const label =
    kind === "staff" ? "Staff" : kind === "owner_manager" ? "Owner" : "Customer";

  return (
    <span className="w-fit rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700">
      {label}
    </span>
  );
}

function notificationDestination(notification: AppNotification) {
  if (notification.recipient_kind === "customer" && notification.booking_id) {
    return `/my-bookings/${notification.booking_id}`;
  }

  return notification.href.startsWith("/") ? notification.href : "/notifications";
}

function AppNotificationCard({
  notification,
}: {
  notification: AppNotification;
}) {
  const destinationHref = notificationDestination(notification);

  return (
    <article className="grid min-w-0 gap-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-zinc-950">
              {notification.title}
            </h3>
            {!notification.read_at ? (
              <span className="rounded-md bg-zinc-950 px-2 py-1 text-xs font-semibold text-white">
                New
              </span>
            ) : null}
          </div>
          {notification.body ? (
            <p className="mt-2 text-sm text-zinc-600">{notification.body}</p>
          ) : null}
          <p className="mt-1 text-sm text-zinc-500">
            {formatDate(notification.created_at)}
          </p>
        </div>
        <NotificationKindBadge kind={notification.recipient_kind} />
      </div>
      <div className="flex flex-wrap gap-2">
        <form action={openAppNotificationAction}>
          <input name="notification_id" type="hidden" value={notification.id} />
          <input name="href" type="hidden" value={destinationHref} />
          <button
            className="min-h-11 rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white"
            type="submit"
          >
            Open
          </button>
        </form>
        {!notification.read_at ? (
          <form action={markAppNotificationReadAction}>
            <input name="notification_id" type="hidden" value={notification.id} />
            <button
              className="min-h-11 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-950"
              type="submit"
            >
              Mark read
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function StaffNotificationCard({
  request,
}: {
  request: StaffConnectionDashboardRequest;
}) {
  const isInvite = request.direction === "salon_invite";
  const title = isInvite
    ? `Invitation from ${request.salon_name}`
    : `Application to ${request.salon_name}`;
  const detail = isInvite
    ? `Invited as ${request.staff_job_title ?? "Staff"}`
    : `Requested title ${request.requested_job_title ?? "Not specified"}`;

  return (
    <article className="grid min-w-0 gap-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-zinc-950">{title}</h3>
          <p className="mt-2 text-sm text-zinc-600">{detail}</p>
          <p className="mt-1 text-sm text-zinc-500">
            Updated {formatDate(request.updated_at)}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      {request.message ? (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          {request.message}
        </p>
      ) : null}

      {request.status === "pending" && isInvite ? (
        <div className="flex flex-wrap gap-2">
          <form action={acceptStaffInviteByRequestFormAction}>
            <input name="request_id" type="hidden" value={request.id} />
            <button
              className="min-h-11 rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white"
              type="submit"
            >
              Accept
            </button>
          </form>
          <form action={declineStaffInviteByRequestFormAction}>
            <input name="request_id" type="hidden" value={request.id} />
            <button
              className="min-h-11 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-950"
              type="submit"
            >
              Decline
            </button>
          </form>
        </div>
      ) : null}

      {request.status === "pending" && !isInvite ? (
        <form action={cancelStaffSalonApplicationFormAction}>
          <input name="request_id" type="hidden" value={request.id} />
          <button
            className="min-h-11 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-950"
            type="submit"
          >
            Cancel application
          </button>
        </form>
      ) : null}
    </article>
  );
}

function ManagerNotificationCard({
  request,
}: {
  request: SalonStaffConnectionRequestWithDetails;
}) {
  return (
    <article className="grid min-w-0 gap-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-zinc-950">
            Staff application pending
          </h3>
          <p className="mt-2 text-sm text-zinc-600">
            {request.staff?.display_name ??
              request.account?.display_name ??
              request.target_email_normalized ??
              "Applicant"}
            {request.requested_job_title
              ? ` / ${request.requested_job_title}`
              : ""}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Submitted {formatDate(request.created_at)}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>
      {request.message ? (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
          {request.message}
        </p>
      ) : null}
      <Link
        className="inline-flex min-h-11 w-fit items-center rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white"
        href="/staff"
      >
        Review in Staff
      </Link>
    </article>
  );
}

export default async function NotificationsPage() {
  const { context, requests } = await getStaffConnectionDashboard();

  if (!context.user) {
    redirect("/login?next=/notifications");
  }

  const appNotifications = await getCurrentAppNotifications(
    getAppNotificationScopeForContext(context),
  );

  const pendingStaffRequests = requests.filter(
    (request) => request.status === "pending",
  );
  const historyRequests = requests.filter(
    (request) => request.status !== "pending",
  );
  const canManageStaff =
    context.currentMembership && context.currentAccount
      ? await hasPermission("staff.manage", context)
      : false;
  let managerRequests: SalonStaffConnectionRequestWithDetails[] = [];

  if (canManageStaff) {
    try {
      const managerDashboard = await getSalonStaffConnectionRequests();
      managerRequests = managerDashboard.requests.filter(
        (request) =>
          request.direction === "staff_application" && request.status === "pending",
      );
    } catch {
      managerRequests = [];
    }
  }

  const unreadBookingNotifications = appNotifications.filter(
    (notification) => !notification.read_at,
  ).length;
  const connectionTotal = pendingStaffRequests.length + historyRequests.length;
  const hasConnectionActivity = connectionTotal > 0;

  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-zinc-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-500">Notifications</p>
            <h1 className="mt-1 text-3xl font-semibold text-zinc-950">
              Your updates
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-600">
              Booking updates, account messages, and connection requests stay
              together here.
            </p>
          </div>
          {hasConnectionActivity ? (
            <Link
              className="inline-flex min-h-11 w-fit items-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-950"
              href="/staff/connections"
            >
              Manage connections
            </Link>
          ) : null}
        </div>

      <section className="mt-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-zinc-500">Unread</p>
          <p className="mt-2 text-3xl font-semibold text-zinc-950">
            {unreadBookingNotifications}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-zinc-500">
            Booking
          </p>
          <p className="mt-2 text-3xl font-semibold text-zinc-950">
            {appNotifications.length}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase text-zinc-500">
            Connections
          </p>
          <p className="mt-2 text-3xl font-semibold text-zinc-950">
            {connectionTotal}
          </p>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">
          Booking notifications
        </h2>
        {appNotifications.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
            No booking notifications yet.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {appNotifications.map((notification) => (
              <AppNotificationCard
                key={notification.id}
                notification={notification}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">
          Account notifications
        </h2>
        {pendingStaffRequests.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
            No pending account-level connection requests.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {pendingStaffRequests.map((request) => (
              <StaffNotificationCard key={request.id} request={request} />
            ))}
          </div>
        )}
      </section>

      {canManageStaff ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-950">
            Manager notifications
          </h2>
          {managerRequests.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
              No staff applications need review for the selected salon.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {managerRequests.map((request) => (
                <ManagerNotificationCard key={request.id} request={request} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {historyRequests.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-950">Recent history</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {historyRequests.slice(0, 6).map((request) => (
              <StaffNotificationCard key={request.id} request={request} />
            ))}
          </div>
        </section>
      ) : null}
      </div>
    </main>
  );
}
