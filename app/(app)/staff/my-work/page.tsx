import { StaffGreeting } from "@/app/staff/my-work/staff-greeting";
import type { StaffGreetingHistory } from "@/lib/staff-greeting";
import { StaffDailyRefresh } from "@/app/staff/my-work/staff-daily-refresh";
import { StaffMyPay, StaffMyAnalysis } from "@/app/staff/my-work/staff-pay-analysis";
import { StaffDailyMetrics, StaffDailyTickets } from "@/app/staff/my-work/staff-daily-overview";
import dailyStyles from "@/app/staff/my-work/staff-daily-overview.module.css";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { StaffLoadRetry } from "@/app/staff/my-work/staff-load-retry";
import {
  getCurrentStaffAnalysisPortalData,
  getCurrentStaffPayrollPortalData,


} from "@/lib/payroll";
import {
  getCurrentStaffAssignedWork,
  getTodaysStaffWorkday,
  STAFF_WORKDAY_STATUS_LABELS,
} from "@/lib/staff-workdays";
import { StaffProfileSettingsDrawer } from "@/app/staff/my-work/staff-profile-settings-drawer";
import {
  getStaffProfileAvatarUrl,
  getStaffProfileDisplayName,
} from "@/lib/staff-profile";
import Link from "next/link";
import { redirect } from "next/navigation";

type StaffPortalTab = "daily" | "payroll" | "analysis";
type StaffPortalTabId = StaffPortalTab | "profile";
type StaffPortalTabItem = {
  href: string;
  id: StaffPortalTabId;
  label: string;
};

type StaffMyWorkSearchParams = {
  cycleType?: string | string[];
  end?: string | string[];
  error?: string | string[];
  month?: string | string[];
  payPeriodStart?: string | string[];
  profile?: string | string[];
  preset?: string | string[];
  segment?: string | string[];
  start?: string | string[];
  tab?: string | string[];
};

type StaffMyWorkPageProps = {
  searchParams?: Promise<StaffMyWorkSearchParams>;
};

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
  const active = [STAFF_WORKDAY_STATUS_LABELS.working, STAFF_WORKDAY_STATUS_LABELS.checked_in].some(label => label === workStatusLabel);
  const paused = workStatusLabel === STAFF_WORKDAY_STATUS_LABELS.break;
  return <>
    <header className={`${dailyStyles.header} ${dailyStyles.greetingHeader}`}>
      <h1 className={dailyStyles.heading}><StaffGreeting {...greeting} /></h1><p className={dailyStyles.date}>{weekday}, {dateLabel}</p>
      <div className={dailyStyles.actions}>
        <span className={[dailyStyles.status, active ? dailyStyles.active : paused ? dailyStyles.paused : ""].join(" ")}>{workStatusLabel}</span>
      </div>
    </header>
    <nav className={dailyStyles.tabs} aria-label="Staff portal tabs">
      {tabs.filter(tab => tab.id !== "profile").map(tab => <Link key={tab.id} href={tab.href} aria-current={tab.id === activeTab ? "page" : undefined} className={[dailyStyles.tab, tab.id === activeTab ? dailyStyles.selected : ""].join(" ")}>{tab.id === "daily" ? "Overview" : tab.label}</Link>)}
    </nav>
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
      {message}
    </p>
  );
}

function StaffPortalLoadError({ label = "Staff Portal" }: { label?: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <p className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        {label} could not load right now. Please refresh or try again after the
        current salon is available.
      </p>
      <StaffLoadRetry />
    </main>
  );
}

export default async function StaffMyWorkPage({
  searchParams,
}: StaffMyWorkPageProps) {
  const params = await searchParams;
  const activeTab = getActiveTab(params?.tab);
  const error = Array.isArray(params?.error) ? params?.error[0] : params?.error;
  const tabs = buildStaffPortalTabs(params);
  // Start only the selected tab while the header/daily snapshot loads. Identity
  // and authorization are shared within this render, never across requests.
  const tabInput = { payPeriodStart: stringParam(params?.payPeriodStart) };
  const payrollPromise = activeTab === "payroll" ? getCurrentStaffPayrollPortalData(tabInput).catch(error => {
    console.error("Staff payroll portal load failed", error); return null;
  }) : Promise.resolve(null);
  const analysisPromise = activeTab === "analysis" ? getCurrentStaffAnalysisPortalData(tabInput).catch(error => {
    console.error("Staff analysis portal load failed", error); return null;
  }) : Promise.resolve(null);
  let assignedWork: Awaited<ReturnType<typeof getCurrentStaffAssignedWork>>;

  try {
    assignedWork = await getCurrentStaffAssignedWork();
  } catch (error) {
    console.error("Staff Daily load failed", error);
    return <StaffPortalLoadError label="Staff Daily" />;
  }

  const { context, excludedTicketCount, staff, today, workTickets } =
    assignedWork;

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
          Please select a salon first.
        </p>
      </main>
    );
  }

  if (!staff) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          No active staff profile is linked to your account for this salon.
        </p>
      </main>
    );
  }

  let greetingHistory: StaffGreetingHistory | null = null;
  let salonTimezone = "America/Chicago";
  let workday: Awaited<ReturnType<typeof getTodaysStaffWorkday>>["workday"] =
    null;
  try {
    const { supabase } = await getStaffPortalIdentity();
    if (!supabase) throw new Error("Staff Daily unavailable");
    const [attendance, timezone, history] = await Promise.all([
      getTodaysStaffWorkday(undefined, { allowEmailFallback: false, workDate: today }),
      supabase.rpc("get_salon_business_timezone", { p_salon_id: context.currentSalon.id }),
      supabase.rpc("get_my_staff_greeting_context", { p_salon_id: context.currentSalon.id }).then(result => result.error ? null : result.data, () => null),
    ]);
    if (timezone.error || typeof timezone.data !== "string") throw new Error("Salon timezone unavailable");
    workday = attendance.workday;
    salonTimezone = timezone.data;
    greetingHistory = history;
  } catch (error) {
    console.error("Staff Daily supporting data load failed", error);
    return <StaffPortalLoadError label="Staff Daily" />;
  }

  const [payrollData, analysisData] = await Promise.all([payrollPromise, analysisPromise]);

  const activity = workTickets.filter(ticket => ticket.hasEarning && ticket.status === "closed").reduce((total, ticket) => ({
    assignedServiceAmount: total.assignedServiceAmount + ticket.serviceTotal,
    bigTurns: total.bigTurns + ticket.bigTurns,
    smallTurns: total.smallTurns + ticket.smallTurns,
    tipAmount: total.tipAmount + ticket.tipAmount,
    totalEarning: total.totalEarning + ticket.totalEarning,
  }), { assignedServiceAmount: 0, bigTurns: 0, smallTurns: 0, tipAmount: 0, totalEarning: 0 });
  const workStatus = workday?.status ?? "not_checked_in";
  const workStatusLabel = STAFF_WORKDAY_STATUS_LABELS[workStatus];
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
  const staffDisplayName = getStaffProfileDisplayName(staff, context.user);
  const staffAvatarUrl = getStaffProfileAvatarUrl({
    accountAvatarUrl: context.user.avatar_url,
    staffProfilePhotoPath: staff.public_profile_photo_path,
  });

  return (
    <>
      <main data-staff-today className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-5">
        <StaffDailyRefresh salonId={context.currentSalon.id} refreshedAt={new Date().toISOString()} viewKey={`${activeTab}:${stringParam(params?.payPeriodStart) ?? ""}`} />
        <StaffPortalHeader
          greeting={{ name: staffDisplayName, timezone: salonTimezone, todayServices: activity.assignedServiceAmount, businessDate: today, history: greetingHistory, now: new Date().toISOString() }}
          activeTab={activeTab}
          dateLabel={dateLabel}
          staffName={staffDisplayName}
          tabs={tabs}
          weekday={weekday}
          workStatusLabel={workStatusLabel}
        />

        {error ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {activeTab === "daily" ? (
          <>
            <StaffDailyMetrics activity={activity} completedTickets={workTickets.filter(ticket => ticket.status === "closed" && ticket.hasEarning).length} />
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-zinc-950">Your tickets <span className="ml-2 text-xs font-normal text-zinc-500">{workTickets.length}</span></h2>
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
                      Some assigned tickets have no earnings yet and are excluded from these totals.
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
              My Payroll could not load right now. <StaffLoadRetry automatic={false} />
            </p>
          )
        ) : activeTab === "analysis" ? (
          analysisData ? (
            <StaffMyAnalysis data={analysisData} today={today} />
          ) : (
            <p className="mt-8 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              My Analysis could not load right now. <StaffLoadRetry automatic={false} />
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
