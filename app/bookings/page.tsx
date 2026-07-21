import { BookingWorkspaceClient } from "@/app/bookings/booking-workspace-client";
import {
  BOOKING_PERMISSIONS,
  getCurrentSalonBookingWorkspace,
  type BookingWorkspaceSearchParams,
} from "@/lib/bookings";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";

type BookingsPageProps = {
  searchParams: Promise<BookingWorkspaceSearchParams>;
};

export default async function BookingsPage({ searchParams }: BookingsPageProps) {
  const [params, context] = await Promise.all([
    searchParams,
    requireSalonManagePageContext("/bookings"),
  ]);
  const canViewBookings = await hasPermission(BOOKING_PERMISSIONS.view, context);

  if (!canViewBookings) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">Booking</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Owner appointment workspace for this salon.
        </p>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to view bookings.
        </p>
      </main>
    );
  }

  const workspace = await getCurrentSalonBookingWorkspace(params, context);

  return (
    <BookingWorkspaceClient
      bookings={workspace.bookings}
      canManageBookings={workspace.canManageBookings}
      canViewBookings={workspace.canViewBookings}
      filters={workspace.filters}
      options={workspace.options}
      organizationName={context.currentOrganization.name}
      publicBookingHref={`/book/${context.currentSalon.id}`}
      range={workspace.range}
      requests={workspace.requests}
      salonName={context.currentSalon.name}
      settings={workspace.settings}
      timezone={workspace.timezone}
      warnings={workspace.warnings}
    />
  );
}
