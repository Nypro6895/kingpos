// This module is deliberately client-safe. Server loaders are imported as types only.
import type { TodayDashboard, TodayLoadError, TodayTeamMember } from "./today-dashboard";

export const TODAY_DASHBOARD_SECTIONS = ["staff", "bookings", "waiting", "financials", "extras"] as const;
export type TodayDashboardSection = typeof TODAY_DASHBOARD_SECTIONS[number];

/** Native replies and persisted JSON may reorder keys without changing access. */
export function getTodayDashboardPermissionsIdentity(permissions: TodayDashboard["permissions"]): string {
  return JSON.stringify(Object.keys(permissions).sort().map(key => [key, permissions[key as keyof typeof permissions]]));
}

export function isTodayDashboardSection(value: unknown): value is TodayDashboardSection {
  return typeof value === "string" && (TODAY_DASHBOARD_SECTIONS as readonly string[]).includes(value);
}

export function getTodayDashboardSections(dashboard: Pick<TodayDashboard, "permissions" | "dayView" | "noAccess">): TodayDashboardSection[] {
  if (dashboard.noAccess) return [];
  return TODAY_DASHBOARD_SECTIONS.filter((section) => {
    if (section === "bookings") return dashboard.permissions.canViewBookings;
    if (section === "waiting") return dashboard.permissions.canViewBookings && dashboard.dayView.isCurrentDate;
    if (section === "financials") return dashboard.permissions.canViewReports || dashboard.permissions.canViewStaffFinancials;
    return true;
  });
}

const ERROR_AREAS: Record<TodayDashboardSection, TodayLoadError["area"][]> = {
  staff: ["staff"], bookings: ["bookings"], waiting: ["waiting"],
  financials: ["reports", "financials", "business_hours"],
  extras: ["notifications", "quick_accesses"],
};

function ownsError(error: TodayLoadError, section: TodayDashboardSection) {
  return error.section ? error.section === section : ERROR_AREAS[section].includes(error.area);
}

/** A failed transport must settle the shell's placeholder without inventing
 * financial values or throwing away the last successfully loaded section. */
export function failTodayDashboardSection(base: TodayDashboard, section: TodayDashboardSection): TodayDashboard {
  return mergeTodayDashboardSection(base, {...base, loadErrors: [{area: ERROR_AREAS[section][0], section, message: "Data temporarily unavailable"}]}, section);
}

function ownsAttention(id: string, section: TodayDashboardSection) {
  return section === "bookings" ? id === "pending-bookings"
    : section === "waiting" ? id === "waiting-clients"
    : section === "financials" ? id === "open-pos-tickets"
    : section === "extras" ? id.startsWith("notification:") : false;
}

function financialFields(member: TodayTeamMember) {
  return {
    earnings: member.earnings,
    financialAttribution: member.financialAttribution,
    serviceSales: member.serviceSales,
    tips: member.tips,
    turns: member.turns,
  };
}

function withoutFinancials(member: TodayTeamMember): TodayTeamMember {
  return {
    ...member,
    earnings: undefined,
    serviceSales: undefined,
    tips: undefined,
    financialAttribution: { services: "unavailable", tips: "unavailable" },
  };
}

/** Merge a settled source without replacing other sources or failed read fallbacks.
 * Caller resource scope owns account/salon admission. A different date, timezone,
 * permission set, or denied frame requires a new shell rather than a patch.
 * Financial totals, trends and staff financial fields are admitted as one group.
 */
export function mergeTodayDashboardSection(
  base: TodayDashboard,
  patch: TodayDashboard,
  section: TodayDashboardSection,
): TodayDashboard {
  if (base.noAccess || patch.noAccess || base.date !== patch.date || base.timezone !== patch.timezone ||
    base.dayView.currentDate !== patch.dayView.currentDate || base.dayView.isCurrentDate !== patch.dayView.isCurrentDate ||
    getTodayDashboardPermissionsIdentity(base.permissions) !== getTodayDashboardPermissionsIdentity(patch.permissions)) {
    return base;
  }
  const errors = patch.loadErrors.filter((error) => ownsError(error, section));
  const failed = errors.length > 0;
  const pending = (base.pendingSections?.sections ?? []).filter((item) => item !== section);
  const next: TodayDashboard = {
    ...base,
    generatedAt: patch.generatedAt,
    summary: { ...base.summary },
    rightNow: { ...base.rightNow },
    performance: { ...base.performance },
    loadErrors: [...base.loadErrors.filter((error) => !ownsError(error, section)), ...errors],
    attention: base.attention.filter((item) => item.id !== "all-good" && !item.id.startsWith("incomplete-attention") && (failed || !ownsAttention(item.id, section))),
  };
  if (!failed) {
    next.attention.push(...patch.attention.filter((item) => ownsAttention(item.id, section)));
    if (section === "staff") {
      next.summary.staff = patch.summary.staff;
      const moneyById = new Map(base.team.map((member) => [member.id, member]));
      next.team = patch.team.map((member) => {
        const financial = moneyById.get(member.id);
        const retainedFinancials = financial && (financial.earnings !== undefined || financial.financialAttribution !== undefined);
        return retainedFinancials ? { ...member, ...financialFields(financial) }
          : base.permissions.canViewStaffFinancials && !base.pendingSections?.sections?.includes("financials") ? withoutFinancials(member) : member;
      });
    } else if (section === "bookings") {
      next.summary.customers = patch.summary.customers;
      next.rightNow.scheduleHref = patch.rightNow.scheduleHref;
      next.rightNow.upcomingBookings = patch.rightNow.upcomingBookings;
      next.performance.bookingStatus = patch.performance.bookingStatus;
    } else if (section === "waiting") {
      next.summary.waiting = patch.summary.waiting;
      next.rightNow.waitingClients = patch.rightNow.waitingClients;
    } else if (section === "financials") {
      next.summary.sales = patch.summary.sales;
      if (!base.permissions.canViewBookings) next.summary.customers = patch.summary.customers;
      next.businessHours = patch.businessHours;
      next.performance = { ...patch.performance, bookingStatus: base.performance.bookingStatus };
      const financialById = new Map(patch.team.map((member) => [member.id, member]));
      next.team = base.pendingSections?.sections?.includes("staff") ? patch.team : base.team.map((member) => {
        const financial = financialById.get(member.id);
        return financial ? { ...member, ...financialFields(financial) } : withoutFinancials(member);
      });
    } else {
      next.quickAccesses = patch.quickAccesses;
    }
    if (section === "staff" || section === "bookings") next.businessHours = patch.businessHours;
  } else {
    const failedMetrics: Array<keyof TodayDashboard["summary"]> = section === "staff" ? ["staff"]
      : section === "bookings" ? ["customers"] : section === "waiting" ? ["waiting"]
      : section === "financials" ? ["sales", ...(!base.permissions.canViewBookings ? ["customers" as const] : [])] : [];
    for (const metric of failedMetrics) {
      if (next.summary[metric].value === "--" && next.summary[metric].detail === "Loading…") {
        next.summary[metric] = { ...next.summary[metric], detail: "Data temporarily unavailable" };
      }
    }
  }
  const metrics: Array<keyof TodayDashboard["summary"]> = [];
  if (pending.includes("staff")) metrics.push("staff");
  if (pending.includes("waiting")) metrics.push("waiting");
  if (pending.includes("bookings") || (!base.permissions.canViewBookings && base.permissions.canViewReports && pending.includes("financials"))) metrics.push("customers");
  if (base.permissions.canViewReports && pending.includes("financials")) metrics.push("sales");
  next.pendingSections = { sections: pending, metrics, details: pending.length > 0 };
  // Staff/queue assessment uses two independently fetched counts. Recompute only
  // once both sources succeeded; do not interpret an unreceived queue as zero.
  if (base.dayView.isCurrentDate && !pending.includes("staff") && !pending.includes("waiting") &&
    !next.loadErrors.some((error) => ownsError(error, "staff") || ownsError(error, "waiting"))) {
    const count = Number.parseInt(next.summary.staff.value, 10);
    const waiting = Number.parseInt(next.summary.waiting.value, 10);
    if (Number.isFinite(count) && Number.isFinite(waiting)) next.summary.staff = {
      ...next.summary.staff,
      tone: waiting > 0 && count === 0 ? "danger" : waiting > count ? "warning" : count > 0 ? "good" : "default",
      assessment: waiting > 0 && count === 0 ? "Clients waiting, no staff checked in" : waiting > count ? "Queue exceeds checked-in staff" : count > 0 ? "Staff checked in" : "No staffing activity",
    };
  }
  if (next.loadErrors.length > 0) next.attention.push({
    id: "incomplete-attention", label: "Some checks unavailable",
    detail: "Refresh to check all items needing attention.", href: null, tone: "notice", count: 0,
  });
  if (pending.length === 0 && next.loadErrors.length === 0 && next.attention.length === 0) next.attention.push({
    id: "all-good", label: "All good", href: null, tone: "good",
    detail: next.dayView.isCurrentDate ? "Nothing needs your attention right now." : "No date-specific issues found for this day.",
  });
  const priority = (id: string) => id === "waiting-clients" ? 0 : id === "pending-bookings" ? 1 : id === "open-pos-tickets" ? 2 : 3;
  next.attention.sort((left, right) => priority(left.id) - priority(right.id));
  next.attention = next.attention.slice(0, 5);
  return next;
}
