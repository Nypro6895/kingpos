import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";
import { WorkspaceToolbar } from "@/components/workspace-toolbar";
import { ContextualSupport } from "@/components/contextual-support";

import { getContextBusinessTimezone } from "@/lib/salon-business-clock";
import {OwnerLiveTickets} from '@/app/pos-tickets/owner-live-tickets';
import {
  canApplyFinancialCorrections,
  FINANCIAL_CORRECTION_PERMISSIONS,
  isDailyClosingLocked,
} from "@/lib/daily-pos-report";
import {
  getCurrentSalonPosTickets,
  getCurrentSalonPosTicketOptions,
  POS_TICKET_PERMISSIONS,
} from "@/lib/pos-tickets";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { getTodayDate } from "@/lib/staff-workdays";

type PosTicketsPageProps = {
  searchParams: Promise<{
    date?: string;
    error?: string;
    q?: string;
  }>;
};




function parseLocalDateParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;

  return {
    day: Number(day),
    month: Number(month),
    year: Number(year),
  };
}

function getLocalDateString(timeZone: string) {
  return getTodayDate(timeZone);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const getPart = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const zonedTimeAsUtc = Date.UTC(
    getPart("year"),
    getPart("month") - 1,
    getPart("day"),
    getPart("hour"),
    getPart("minute"),
    getPart("second"),
    date.getUTCMilliseconds(),
  );

  return zonedTimeAsUtc - date.getTime();
}

function getUtcInstantForLocalDateTime(
  dateString: string,
  timeZone: string,
  hour: number,
) {
  const parts = parseLocalDateParts(dateString);

  if (!parts) {
    throw new Error("Invalid POS work log date.");
  }

  const localTimeAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour);
  const offset = getTimeZoneOffsetMs(new Date(localTimeAsUtc), timeZone);
  const firstPass = localTimeAsUtc - offset;
  const verifiedOffset = getTimeZoneOffsetMs(new Date(firstPass), timeZone);

  return new Date(localTimeAsUtc - verifiedOffset);
}

function getNextLocalDateString(dateString: string) {
  const parts = parseLocalDateParts(dateString);

  if (!parts) {
    throw new Error("Invalid POS work log date.");
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1))
    .toISOString()
    .slice(0, 10);
}

function getUtcBoundsForLocalDate(dateString: string, timeZone: string) {
  const start = getUtcInstantForLocalDateTime(dateString, timeZone, 0);
  const nextDate = getNextLocalDateString(dateString);
  const nextStart = getUtcInstantForLocalDateTime(nextDate, timeZone, 0);

  return {
    openedFrom: start.toISOString(),
    openedTo: new Date(nextStart.getTime() - 1).toISOString(),
  };
}

function formatLocalDateHeader(dateString: string, timeZone: string) {
  const parts = parseLocalDateParts(dateString);

  if (!parts) {
    return dateString;
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
    year: "numeric",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
}

function formatLocalDateCompact(dateString: string, timeZone: string) {
  const parts = parseLocalDateParts(dateString);

  if (!parts) {
    return dateString;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    year: "numeric",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
}


function isDateInputValue(value: string | undefined) {
  return Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));
}

function getTicketFilterHref({
  date,
  q,
}: {
  date: string;
  q?: string;
}) {
  const params = new URLSearchParams({ date });

  if (q) {
    params.set("q", q);
  }

  return `/pos-tickets?${params.toString()}`;
}






function WorkLogFilters() {
  return (
    <WorkspaceToolbar title="POS Tickets">
      <div className="ml-auto"><ContextualSupport /></div>
    </WorkspaceToolbar>
  );
}


async function PosTicketsPage({
  searchParams,
}: PosTicketsPageProps) {
  const [{ date, error, q }, context] = await Promise.all([
    searchParams,
    requireSalonManagePageContext("/pos-tickets"),
  ]);

  const canViewTickets = await hasPermission(POS_TICKET_PERMISSIONS.view, context);

  if (!canViewTickets) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          <WorkspaceText text="You do not have permission to view POS tickets." />
        </p>
      </main>
    );
  }

  const timeZone = await getContextBusinessTimezone(context);
  const selectedDate = isDateInputValue(date)
    ? date!
    : getLocalDateString(timeZone);
  const searchQuery = q?.trim() ?? "";
  const selectedDateLabel = formatLocalDateHeader(selectedDate, timeZone);
  const selectedDateCompactLabel = formatLocalDateCompact(selectedDate, timeZone);
  const returnTo = getTicketFilterHref({ date: selectedDate, q: searchQuery });
  const [
    canManageTickets,
    canVoidTickets,
    canRequestStaffCorrection,
    canApplyFinancialCorrection,
    isSelectedDateLocked,
    { tickets },
  ] = await Promise.all([
    hasPermission(POS_TICKET_PERMISSIONS.manage, context),
    hasPermission(POS_TICKET_PERMISSIONS.void, context),
    hasPermission(FINANCIAL_CORRECTION_PERMISSIONS.request, context),
    canApplyFinancialCorrections(context),
    isDailyClosingLocked(selectedDate, context),
    getCurrentSalonPosTickets(getUtcBoundsForLocalDate(selectedDate, timeZone)),
  ]);
  const canCorrectTickets = canManageTickets || canVoidTickets;
  const canEditDailyTickets = isSelectedDateLocked
    ? canCorrectTickets || canRequestStaffCorrection || canApplyFinancialCorrection
    : canCorrectTickets;
  const ticketOptions = canEditDailyTickets
    ? await getCurrentSalonPosTicketOptions(context)
    : { services: [], staff: [] };

  return (
    <main className="mx-auto w-full max-w-7xl py-4 text-zinc-950 sm:px-6">
      <WorkLogFilters />

      {error ? (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <WorkspaceText text={error} />
        </p>
      ) : null}

      {/* Server response time bounds client reconciliation of this snapshot. */}
      {/* eslint-disable-next-line react-hooks/purity */}
      <OwnerLiveTickets selectedDate={selectedDate} snapshotAt={Date.now()} key={selectedDate+searchQuery} salonId={context.currentSalon.id} initialTickets={tickets} bounds={getUtcBoundsForLocalDate(selectedDate,timeZone)} searchQuery={searchQuery}
        canApplyFinancialCorrection={canApplyFinancialCorrection}
        canEdit={canEditDailyTickets}
        isBusinessDateLocked={isSelectedDateLocked}
        returnTo={returnTo}
        selectedDateCompactLabel={selectedDateCompactLabel}
        selectedDateLabel={selectedDateLabel}
        services={ticketOptions.services}
        staff={ticketOptions.staff}
      />
    </main>
  );
}

export default withExperiencePage(PosTicketsPage);
