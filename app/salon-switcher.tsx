import { setCurrentSalon } from "@/app/salons/actions";
import {
  isOwnerMembership,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import Link from "next/link";

export function SalonSwitcher({
  context,
}: {
  context: CurrentBusinessContext;
}) {
  if (!context.user) {
    return null;
  }

  const { currentOrganization, currentMembership, currentSalon, salons } = context;

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Link className="text-lg font-semibold text-zinc-950" href="/account">
          KingPOS
        </Link>

        <nav className="flex flex-wrap items-center gap-3 text-sm">
          <Link className="font-medium text-zinc-700 hover:text-zinc-950" href="/organizations">
            Organizations
          </Link>
          <Link className="font-medium text-zinc-700 hover:text-zinc-950" href="/salons">
            Salons
          </Link>
          <Link className="font-medium text-zinc-700 hover:text-zinc-950" href="/staff">
            Staff
          </Link>
          <Link className="font-medium text-zinc-700 hover:text-zinc-950" href="/staff/today">
            Staff Today
          </Link>
          <Link className="font-medium text-zinc-700 hover:text-zinc-950" href="/staff/workday">
            My Workday
          </Link>
          <Link className="font-medium text-zinc-700 hover:text-zinc-950" href="/staff/my-work">
            My Work
          </Link>
          <Link
            className="font-medium text-zinc-700 hover:text-zinc-950"
            href="/services"
          >
            Services
          </Link>
          <Link
            className="font-medium text-zinc-700 hover:text-zinc-950"
            href="/bookings"
          >
            Bookings
          </Link>
          <Link
            className="font-medium text-zinc-700 hover:text-zinc-950"
            href="/pos-tickets"
          >
            POS Tickets
          </Link>
          <Link
            className="font-medium text-zinc-700 hover:text-zinc-950"
            href="/salon-settings"
          >
            Salon Settings
          </Link>
          <Link className="font-medium text-zinc-700 hover:text-zinc-950" href="/roles">
            Roles
          </Link>
          <Link
            className="font-medium text-zinc-700 hover:text-zinc-950"
            href="/permissions"
          >
            Permissions
          </Link>
          <Link className="font-medium text-zinc-700 hover:text-zinc-950" href="/account">
            Account
          </Link>
        </nav>

        <div className="flex min-w-0 flex-col gap-1 text-sm sm:items-end">
          <div className="max-w-full truncate">
            <span className="font-medium text-zinc-500">Organization</span>{" "}
            <span className="text-zinc-950">{currentOrganization?.name ?? "Not set"}</span>
          </div>

          {salons.length > 1 && isOwnerMembership(currentMembership) ? (
            <details className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 font-medium text-zinc-950">
                <span className="text-zinc-500">Salon</span>
                <span>{currentSalon?.name ?? "Choose Salon"}</span>
                <span aria-hidden="true">v</span>
              </summary>
              <div className="absolute right-0 z-10 mt-2 min-w-64 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
                {salons.map((salon) => (
                  <form action={setCurrentSalon} key={salon.id}>
                    <input name="salon_id" type="hidden" value={salon.id} />
                    <button
                      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm hover:bg-zinc-50"
                      disabled={salon.id === currentSalon?.id}
                      type="submit"
                    >
                      <span className="font-medium text-zinc-950">{salon.name}</span>
                      {salon.id === currentSalon?.id ? (
                        <span className="text-xs font-medium text-zinc-500">Current</span>
                      ) : null}
                    </button>
                  </form>
                ))}
              </div>
            </details>
          ) : (
            <div className="max-w-full truncate">
              <span className="font-medium text-zinc-500">Salon</span>{" "}
              <span className="text-zinc-950">{currentSalon?.name ?? "Not set"}</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
