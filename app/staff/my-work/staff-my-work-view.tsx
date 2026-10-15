import { StaffRelay } from "@/app/service-relay/staff-relay";
import { WorkspaceText, WorkspaceElement } from "@/components/workspace-language";
import { ContextualSupport } from "@/components/contextual-support";
import { StaffGreeting } from "./staff-greeting";
import { StaffMyPay, StaffMyAnalysis } from "./staff-pay-analysis";
import { StaffDailyMetrics, StaffDailyTickets } from "./staff-daily-overview";
import dailyStyles from "./staff-daily-overview.module.css";
import { StaffLoadRetry } from "./staff-load-retry";
import { StaffProfileSettingsDrawer } from "./staff-profile-settings-drawer";
import type { StaffMyWorkResource, StaffMyWorkSearchParams, StaffPortalTab } from "@/lib/staff-my-work-experience";
import Link from "next/link";

type StaffPortalTabId = StaffPortalTab | "profile";
type StaffPortalTabItem = { href: string; id: StaffPortalTabId; label: string };
const STAFF_PORTAL_TABS: Array<Omit<StaffPortalTabItem, "href">> = [
  { id: "daily", label: "Daily" },
  { id: "payroll", label: "My Pay" },
  { id: "analysis", label: "Analysis" },
  { id: "profile", label: "Staff Profile" },
];

function formatWorkDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);

  return {
    date: new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      year: "numeric",
    }).format(date),
    weekday: new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
    }).format(date),
  };
}

function getActiveTab(tab: string | string[] | undefined): StaffPortalTab {
  const value = Array.isArray(tab) ? tab[0] : tab;

  if (value === "payroll" || value === "analysis") {
    return value;
  }

  return "daily";
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildStaffPortalTabs(params: StaffMyWorkSearchParams | undefined) {
  const periodParamNames = ["payPeriodStart"] as const;

  return STAFF_PORTAL_TABS.map((tab) => {
    if (tab.id === "profile") {
      return {
        ...tab,
        href: "/staff/my-work?profile=1",
      } satisfies StaffPortalTabItem;
    }

    const urlParams = new URLSearchParams();

    for (const name of periodParamNames) {
      const value = stringParam(params?.[name]);

      if (value) {
        urlParams.set(name, value);
      }
    }

    if (tab.id !== "daily") {
      urlParams.set("tab", tab.id);
    }

    const query = urlParams.toString();

    return {
      ...tab,
      href: query ? `/staff/my-work?${query}` : "/staff/my-work",
    } satisfies StaffPortalTabItem;
  });
}

function StaffPortalHeader({ activeTab, dateLabel, tabs, weekday, workStatusLabel, greeting }: {
  activeTab: StaffPortalTab; dateLabel: string; staffName: string;
  tabs: StaffPortalTabItem[]; weekday: string; workStatusLabel: string;
  greeting: React.ComponentProps<typeof StaffGreeting>;
}) {
  const active = ["Working", "Checked in"].some(label => label === workStatusLabel);
  const paused = workStatusLabel === "On break";
  return <>
    <header className={`${dailyStyles.header} ${dailyStyles.greetingHeader}`}>
      <h1 className={dailyStyles.heading}><StaffGreeting {...greeting} /></h1><p className={dailyStyles.date}>{weekday}, <WorkspaceText text={dateLabel} /></p>
      <div className={dailyStyles.actions}>
        <span className={[dailyStyles.status, active ? dailyStyles.active : paused ? dailyStyles.paused : ""].join(" ")}><WorkspaceText text={workStatusLabel} /></span>
      </div>
    </header>
    <div className="flex min-w-0 items-center gap-3">
<WorkspaceElement as="nav" style={{ flex: "1 1 auto", minWidth: 0 }} className={dailyStyles.tabs} aria-label="Staff portal tabs">
      {tabs.filter(tab => tab.id !== "profile").map(tab => <Link key={tab.id} href={tab.href} aria-current={tab.id === activeTab ? "page" : undefined} className={[dailyStyles.tab, tab.id === activeTab ? dailyStyles.selected : ""].join(" ")}>{tab.id === "daily" ? <WorkspaceText text="Today" /> : tab.label}</Link>)}
    </WorkspaceElement>
<ContextualSupport />
</div>
  </>;
}

function EmptyTickets({
  excludedTicketCount,
  hasTodayActivity,
  workStatus,
}: {
  excludedTicketCount: number;
  hasTodayActivity: boolean;
  workStatus: string;
}) {
  let message = "No tickets are assigned to you today yet.";

  if (excludedTicketCount > 0) {
    message =
      "Only cancelled or voided tickets were found today. They are excluded from Daily totals.";
  } else if (hasTodayActivity) {
    message =
      "You have activity today, but no ticket earnings are ready to show yet.";
  } else if (workStatus === "not_checked_in") {
    message = "You are not checked in yet, and no tickets are assigned for today.";
  }

  return (
    <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
      <WorkspaceText text={message} />
    </p>
  );
}

export function StaffPortalLoadError({ label = "Staff Portal" }: { label?: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <p className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        <WorkspaceText text={label} /> <WorkspaceText text="could not load right now. Please refresh or try again after the current salon is available." />
      </p>
      <StaffLoadRetry />
    </main>
  );
}

export function StaffMyWorkView({ resource, params }: { resource: StaffMyWorkResource; params: StaffMyWorkSearchParams }) {
  const { salonId, staff, today, workTickets, excludedTicketCount, workStatus, workStatusLabel,
    salonTimezone, greetingHistory, staffDisplayName, staffAvatarUrl, payrollData, analysisData, generatedAt } = resource;
  const activeTab = getActiveTab(params.tab);
  const error = stringParam(params.error);
  const tabs = buildStaffPortalTabs(params);
  const activity = workTickets.filter(ticket => ticket.hasEarning && ticket.status === "closed").reduce((total, ticket) => ({
    assignedServiceAmount: total.assignedServiceAmount + ticket.serviceTotal,
    bigTurns: total.bigTurns + ticket.bigTurns,
    smallTurns: total.smallTurns + ticket.smallTurns,
    tipAmount: total.tipAmount + ticket.tipAmount,
    totalEarning: total.totalEarning + ticket.totalEarning,
  }), { assignedServiceAmount: 0, bigTurns: 0, smallTurns: 0, tipAmount: 0, totalEarning: 0 });


  const { date: dateLabel, weekday } = formatWorkDate(today);
  const totalTurns = activity.bigTurns + activity.smallTurns;
  const hasTodayActivity =
    activity.assignedServiceAmount > 0 ||
    activity.tipAmount > 0 ||
    activity.totalEarning > 0 ||
    totalTurns > 0;
  const hasTicketsWithoutEarnings =
    workTickets.length > 0 && workTickets.some((ticket) => !ticket.hasEarning);
  const showProfileSettings =
    activeTab === "daily" && stringParam(params?.profile) === "1";
  return (
    <>
      <main data-staff-today className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-5">
        <StaffPortalHeader
          greeting={{ name: staffDisplayName, timezone: salonTimezone, todayServices: activity.assignedServiceAmount, businessDate: today, history: greetingHistory, now: generatedAt }}
          activeTab={activeTab}
          dateLabel={dateLabel}
          staffName={staffDisplayName}
          tabs={tabs}
          weekday={weekday}
          workStatusLabel={workStatusLabel}
        />

        {error ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <WorkspaceText text={error} />
          </p>
        ) : null}

        {activeTab === "daily" ? (
          <>
            <StaffDailyMetrics activity={activity} completedTickets={workTickets.filter(ticket => ticket.status === "closed" && ticket.hasEarning).length} />
            <StaffRelay salonId={salonId} />
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-zinc-950"><WorkspaceText text="Your tickets" /> <span className="ml-2 text-xs font-normal text-zinc-500">{workTickets.length}</span></h2>
              </div>

              {workTickets.length === 0 ? (
                <EmptyTickets
                  excludedTicketCount={excludedTicketCount}
                  workStatus={workStatus}
                  hasTodayActivity={hasTodayActivity}
                />
              ) : (
                <div className="space-y-3">
                  {hasTicketsWithoutEarnings ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      <WorkspaceText text="Some assigned tickets have no earnings yet and are excluded from these totals." />
                    </p>
                  ) : null}
                  <StaffDailyTickets tickets={workTickets} timezone={salonTimezone} />
                </div>
              )}
            </section>
          </>
        ) : activeTab === "payroll" ? (
          payrollData ? (
            <StaffMyPay data={payrollData} />
          ) : (
            <p className="mt-8 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              <WorkspaceText text="My Payroll could not load right now." /> <StaffLoadRetry automatic={false} />
            </p>
          )
        ) : activeTab === "analysis" ? (
          analysisData ? (
            <StaffMyAnalysis data={analysisData} today={today} />
          ) : (
            <p className="mt-8 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              <WorkspaceText text="My Analysis could not load right now." /> <StaffLoadRetry automatic={false} />
            </p>
          )
        ) : null}
      </main>
      {showProfileSettings ? (
        <StaffProfileSettingsDrawer
          avatarUrl={staffAvatarUrl}
          closeHref="/staff/my-work"
          displayName={staffDisplayName}
          staff={staff}
        />
      ) : null}
    </>
  );
}
