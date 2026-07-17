"use client";

import {
  cancelStaffTimeBlockAction,
  createStaffTimeBlockAction,
  saveServiceStaffAssignmentsAction,
  saveStaffServiceAssignmentsAction,
  saveStaffWeeklyAvailabilityAction,
  type BookingSetupActionResult,
} from "@/app/booking-setup/actions";
import {
  SALON_PROFILE_MEDIA_BUCKET,
  normalizeSalonProfileMediaPath,
} from "@/lib/salon-profile-media";
import { useRouter } from "next/navigation";
import {
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import type {
  StaffAvailabilityRule,
  StaffServiceAssignment,
  StaffTimeBlock,
} from "@/types/booking";
import type {
  BookingSetupData,
  StaffBookingReadiness,
} from "@/lib/booking-setup";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";
import "./booking-setup.css";

type AssignmentDraft = {
  assigned: boolean;
  onlineBookable: boolean;
};

type DayDraft = {
  breaks: TimeIntervalDraft[];
  working: TimeIntervalDraft[];
};

type TimeIntervalDraft = {
  endsAt: string;
  startsAt: string;
};

const DAYS = [
  { id: 0, label: "Sun" },
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
] as const;

const EMPTY_WEEK: Record<number, DayDraft> = Object.fromEntries(
  DAYS.map((day) => [day.id, { breaks: [], working: [] }]),
) as Record<number, DayDraft>;

type DraftState = {
  key: string;
  rows: Record<string, AssignmentDraft>;
};

type WeekState = {
  key: string;
  week: Record<number, DayDraft>;
};

function classNames(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
    weekday: "short",
  }).format(new Date(value));
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("") || "ST";
}

function encodeStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function getStaffAvatarUrl(path: string | null | undefined) {
  const cleanedPath = normalizeSalonProfileMediaPath(path);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!cleanedPath || !supabaseUrl) {
    return null;
  }

  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(
    SALON_PROFILE_MEDIA_BUCKET,
  )}/${encodeStoragePath(cleanedPath)}`;
}

function SetupStaffAvatar({
  className,
  staff,
}: {
  className?: string;
  staff: Pick<Staff, "display_name" | "public_profile_photo_path">;
}) {
  const avatarUrl = getStaffAvatarUrl(staff.public_profile_photo_path);

  return (
    <span className={classNames("booking-setup-avatar", className)}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="booking-setup-avatar__image" src={avatarUrl} />
      ) : (
        getInitials(staff.display_name)
      )}
    </span>
  );
}

function uniqueCategories(services: Service[]) {
  return [
    ...new Set(
      services.map((service) => service.category?.trim() || "Uncategorized"),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function assignmentKey(rows: Record<string, AssignmentDraft>) {
  return JSON.stringify(
    Object.entries(rows)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, row]) => [id, row.assigned, row.onlineBookable]),
  );
}

function Message({ result }: { result: BookingSetupActionResult | null }) {
  if (!result) {
    return null;
  }

  return (
    <div
      className={classNames(
        "rounded-md border px-3 py-2 text-sm",
        result.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-800",
      )}
    >
      {result.ok ? "Saved." : result.error ?? "Save failed."}
      {!result.ok && result.conflicts && result.conflicts.length > 0 ? (
        <ul className="mt-2 grid gap-1">
          {result.conflicts.slice(0, 4).map((conflict) => (
            <li key={conflict.booking_line_id}>
              {conflict.customer_name} / {conflict.status}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReadinessChips({
  readiness,
}: {
  readiness?: StaffBookingReadiness | null;
}) {
  if (!readiness) {
    return null;
  }

  return (
    <div className="booking-setup-chip-row">
      <span
        className={classNames(
          "booking-setup-chip",
          readiness.ready
            ? "booking-setup-chip--ready"
            : "booking-setup-chip--warning",
        )}
      >
        {readiness.ready ? "Booking ready" : "Needs setup"}
      </span>
      <span className="booking-setup-chip">
        {readiness.onlineAssignedServiceCount} online services
      </span>
      <span className="booking-setup-chip">
        {readiness.workingRuleCount} working rules
      </span>
      {readiness.reasons.map((reason) => (
        <span
          className="booking-setup-chip booking-setup-chip--warning"
          key={reason.code}
        >
          {reason.label}
        </span>
      ))}
    </div>
  );
}

function StickySaveBar({
  canManage,
  children,
  dirtyCount,
  isPending,
  onReset,
  onSave,
}: {
  canManage: boolean;
  children?: ReactNode;
  dirtyCount: number;
  isPending: boolean;
  onReset: () => void;
  onSave: () => void;
}) {
  return (
    <div className="booking-setup-savebar sticky bottom-0 z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm font-semibold text-zinc-700">
        {dirtyCount > 0 ? `${dirtyCount} unsaved changes` : "No unsaved changes"}
      </div>
      {children}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button
            className="booking-setup-secondary-button disabled:opacity-50"
            disabled={isPending || dirtyCount === 0}
            onClick={onReset}
            type="button"
          >
            Cancel
          </button>
          <button
            className="booking-setup-primary-button disabled:opacity-50"
            disabled={isPending || dirtyCount === 0}
            onClick={onSave}
            type="button"
          >
            {isPending ? "Saving" : "Save changes"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-zinc-600">View-only access.</p>
      )}
    </div>
  );
}

function buildServiceDraft(
  services: Service[],
  assignments: StaffServiceAssignment[],
  staffId: string,
) {
  return Object.fromEntries(
    services.map((service) => {
      const assignment = assignments.find(
        (item) => item.staff_id === staffId && item.service_id === service.id,
      );

      return [
        service.id,
        {
          assigned: assignment?.is_active ?? false,
          onlineBookable: assignment?.online_bookable ?? false,
        },
      ];
    }),
  ) as Record<string, AssignmentDraft>;
}

function buildStaffDraft(
  staff: Staff[],
  assignments: StaffServiceAssignment[],
  serviceId: string,
) {
  return Object.fromEntries(
    staff.map((member) => {
      const assignment = assignments.find(
        (item) => item.staff_id === member.id && item.service_id === serviceId,
      );

      return [
        member.id,
        {
          assigned: assignment?.is_active ?? false,
          onlineBookable: assignment?.online_bookable ?? false,
        },
      ];
    }),
  ) as Record<string, AssignmentDraft>;
}

export function StaffServicesBookingEditor({
  assignments,
  canManage,
  readiness,
  services,
  staff,
}: {
  assignments: StaffServiceAssignment[];
  canManage: boolean;
  readiness?: StaffBookingReadiness | null;
  services: Service[];
  staff: Staff;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [result, setResult] = useState<BookingSetupActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const initialDraft = useMemo(
    () => buildServiceDraft(services, assignments, staff.id),
    [assignments, services, staff.id],
  );
  const initialKey = assignmentKey(initialDraft);
  const [draftState, setDraftState] = useState<DraftState>(() => ({
    key: initialKey,
    rows: initialDraft,
  }));
  const draft = draftState.key === initialKey ? draftState.rows : initialDraft;
  const dirtyCount = Object.keys(draft).filter(
    (serviceId) =>
      draft[serviceId]?.assigned !== initialDraft[serviceId]?.assigned ||
      draft[serviceId]?.onlineBookable !== initialDraft[serviceId]?.onlineBookable,
  ).length;
  const categories = uniqueCategories(
    services.filter(
      (service) => service.is_active || initialDraft[service.id]?.assigned,
    ),
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleServices = services.filter((service) => {
    const serviceCategory = service.category?.trim() || "Uncategorized";
    const row = initialDraft[service.id];
    const exposeInactive =
      service.is_active || row?.assigned || normalizedQuery.length > 0;
    const matchesCategory = category === "all" || serviceCategory === category;
    const matchesQuery =
      !normalizedQuery ||
      [service.name, service.category, service.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);

    return exposeInactive && matchesCategory && matchesQuery;
  });

  function setDraftRows(
    updater:
      | Record<string, AssignmentDraft>
      | ((current: Record<string, AssignmentDraft>) => Record<string, AssignmentDraft>),
  ) {
    setDraftState({
      key: initialKey,
      rows: typeof updater === "function" ? updater(draft) : updater,
    });
  }

  function update(serviceId: string, next: Partial<AssignmentDraft>) {
    setDraftRows((current) => {
      const currentRow = current[serviceId] ?? {
        assigned: false,
        onlineBookable: false,
      };
      const nextRow = { ...currentRow, ...next };

      if (!nextRow.assigned) {
        nextRow.onlineBookable = false;
      }

      return {
        ...current,
        [serviceId]: nextRow,
      };
    });
  }

  function save() {
    setResult(null);
    startTransition(async () => {
      const response = await saveStaffServiceAssignmentsAction({
        rows: services.map((service) => ({
          assigned: draft[service.id]?.assigned ?? false,
          onlineBookable: draft[service.id]?.onlineBookable ?? false,
          serviceId: service.id,
        })),
        staffId: staff.id,
      });

      setResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  function bulkActive() {
    setDraftRows((current) => ({
      ...current,
      ...Object.fromEntries(
        services
          .filter((service) => service.is_active)
          .map((service) => [
            service.id,
            { assigned: true, onlineBookable: true },
          ]),
      ),
    }));
  }

  return (
    <section className="booking-setup-panel" data-booking-setup-surface="staff-services">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="booking-setup-profile-head">
          <SetupStaffAvatar staff={staff} />
          <div className="min-w-0">
          <h3 className="text-base font-semibold text-zinc-950">
            Services & booking
          </h3>
          <p className="mt-1 text-sm text-zinc-600">
            {staff.display_name} / {staff.is_active ? "Active" : "Inactive"}
          </p>
          </div>
        </div>
        <ReadinessChips readiness={readiness} />
      </div>
      <Message result={result} />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <label className="grid gap-1">
          <span className="text-xs font-semibold uppercase text-zinc-500">
            Search services
          </span>
          <input
            className="booking-setup-field"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, category"
            value={query}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-semibold uppercase text-zinc-500">
            Category
          </span>
          <select
            className="booking-setup-field"
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          >
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="booking-setup-table max-h-[58vh] overflow-y-auto">
        <div className="booking-setup-table-header grid grid-cols-[minmax(0,1fr)_112px_112px] gap-2">
          <span>Service</span>
          <span>Assigned</span>
          <span>Online</span>
        </div>
        <div className="divide-y divide-zinc-100">
          {visibleServices.map((service) => {
            const row = draft[service.id] ?? {
              assigned: false,
              onlineBookable: false,
            };
            const disabled = !canManage || !staff.is_active;

            return (
              <div
                className={classNames(
                  "booking-setup-row grid grid-cols-[minmax(0,1fr)_112px_112px] gap-2",
                  !service.is_active && "booking-setup-row--muted",
                )}
                key={service.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-950">
                    {service.name}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {(service.category || "Uncategorized")} /{" "}
                    {formatMoney(Number(service.base_price))} /{" "}
                    {service.duration_minutes} min
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span
                      className={classNames(
                        "booking-setup-chip",
                        service.is_active
                          ? "booking-setup-chip--ready"
                          : "booking-setup-chip--muted",
                      )}
                    >
                      {service.is_active ? "Active" : "Inactive"}
                    </span>
                    {!staff.public_profile_visible ||
                    !staff.owner_public_enabled ||
                    staff.staff_public_consent_status !== "granted" ? (
                      <span className="booking-setup-chip booking-setup-chip--warning">
                        Public profile needed
                      </span>
                    ) : null}
                  </div>
                </div>
                <label className="flex items-start justify-center pt-1">
                  <input
                    checked={row.assigned}
                    className="size-5"
                    disabled={disabled || (!service.is_active && !row.assigned)}
                    onChange={(event) =>
                      update(service.id, { assigned: event.target.checked })
                    }
                    type="checkbox"
                  />
                  <span className="sr-only">Assign {service.name}</span>
                </label>
                <label className="flex items-start justify-center pt-1">
                  <input
                    checked={row.onlineBookable}
                    className="size-5"
                    disabled={disabled || !row.assigned || !service.is_active}
                    onChange={(event) =>
                      update(service.id, {
                        assigned: row.assigned || event.target.checked,
                        onlineBookable: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span className="sr-only">
                    Enable online booking for {service.name}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </div>
      <StickySaveBar
        canManage={canManage}
        dirtyCount={dirtyCount}
        isPending={isPending}
        onReset={() => setDraftRows(initialDraft)}
        onSave={save}
      >
        {canManage ? (
          <button
            className="booking-setup-secondary-button w-fit"
            onClick={bulkActive}
            type="button"
          >
            Bulk select active services
          </button>
        ) : null}
      </StickySaveBar>
    </section>
  );
}

export function ServiceBookableStaffEditor({
  assignments,
  canManage,
  readinessByStaffId,
  service,
  staff,
}: {
  assignments: StaffServiceAssignment[];
  canManage: boolean;
  readinessByStaffId: Record<string, StaffBookingReadiness>;
  service: Service;
  staff: Staff[];
}) {
  const router = useRouter();
  const [result, setResult] = useState<BookingSetupActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const initialDraft = useMemo(
    () => buildStaffDraft(staff, assignments, service.id),
    [assignments, service.id, staff],
  );
  const initialKey = assignmentKey(initialDraft);
  const [draftState, setDraftState] = useState<DraftState>(() => ({
    key: initialKey,
    rows: initialDraft,
  }));
  const draft = draftState.key === initialKey ? draftState.rows : initialDraft;
  const dirtyCount = Object.keys(draft).filter(
    (staffId) =>
      draft[staffId]?.assigned !== initialDraft[staffId]?.assigned ||
      draft[staffId]?.onlineBookable !== initialDraft[staffId]?.onlineBookable,
  ).length;
  const visibleStaff = staff.filter(
    (member) => member.is_active || initialDraft[member.id]?.assigned,
  );

  function setDraftRows(
    updater:
      | Record<string, AssignmentDraft>
      | ((current: Record<string, AssignmentDraft>) => Record<string, AssignmentDraft>),
  ) {
    setDraftState({
      key: initialKey,
      rows: typeof updater === "function" ? updater(draft) : updater,
    });
  }

  function update(staffId: string, next: Partial<AssignmentDraft>) {
    setDraftRows((current) => {
      const currentRow = current[staffId] ?? {
        assigned: false,
        onlineBookable: false,
      };
      const nextRow = { ...currentRow, ...next };

      if (!nextRow.assigned) {
        nextRow.onlineBookable = false;
      }

      return {
        ...current,
        [staffId]: nextRow,
      };
    });
  }

  function save() {
    setResult(null);
    startTransition(async () => {
      const response = await saveServiceStaffAssignmentsAction({
        rows: staff.map((member) => ({
          assigned: draft[member.id]?.assigned ?? false,
          onlineBookable: draft[member.id]?.onlineBookable ?? false,
          staffId: member.id,
        })),
        serviceId: service.id,
      });

      setResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  return (
    <section className="booking-setup-panel" data-booking-setup-surface="bookable-staff">
      <div>
        <h3 className="text-base font-semibold text-zinc-950">Bookable staff</h3>
        <p className="mt-1 text-sm text-zinc-600">
          {service.name} / {service.is_active ? "Active" : "Inactive"} /{" "}
          {formatMoney(Number(service.base_price))}
        </p>
      </div>
      <Message result={result} />
      <div className="booking-setup-table max-h-[58vh] overflow-y-auto">
        <div className="booking-setup-table-header grid grid-cols-[minmax(0,1fr)_112px_112px] gap-2">
          <span>Staff</span>
          <span>Assigned</span>
          <span>Online</span>
        </div>
        <div className="divide-y divide-zinc-100">
          {visibleStaff.map((member) => {
            const row = draft[member.id] ?? {
              assigned: false,
              onlineBookable: false,
            };
            const disabled = !canManage || !service.is_active;
            const readiness = readinessByStaffId[member.id];

            return (
              <div
                className={classNames(
                  "booking-setup-row grid grid-cols-[minmax(0,1fr)_112px_112px] gap-2",
                  (!member.is_active || !service.is_active) && "booking-setup-row--muted",
                )}
                key={member.id}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <SetupStaffAvatar staff={member} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-950">
                        {member.display_name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {member.job_title || "Staff"} /{" "}
                        {member.is_active ? "Active" : "Inactive"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2">
                    <ReadinessChips readiness={readiness} />
                  </div>
                </div>
                <label className="flex items-start justify-center pt-1">
                  <input
                    checked={row.assigned}
                    className="size-5"
                    disabled={disabled || (!member.is_active && !row.assigned)}
                    onChange={(event) =>
                      update(member.id, { assigned: event.target.checked })
                    }
                    type="checkbox"
                  />
                  <span className="sr-only">Assign {member.display_name}</span>
                </label>
                <label className="flex items-start justify-center pt-1">
                  <input
                    checked={row.onlineBookable}
                    className="size-5"
                    disabled={disabled || !row.assigned || !member.is_active}
                    onChange={(event) =>
                      update(member.id, {
                        assigned: row.assigned || event.target.checked,
                        onlineBookable: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span className="sr-only">
                    Enable online booking for {member.display_name}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </div>
      <StickySaveBar
        canManage={canManage}
        dirtyCount={dirtyCount}
        isPending={isPending}
        onReset={() => setDraftRows(initialDraft)}
        onSave={save}
      />
    </section>
  );
}

function buildWeekDraft(
  rules: StaffAvailabilityRule[],
  staffId: string,
): Record<number, DayDraft> {
  const week = Object.fromEntries(
    DAYS.map((day) => [day.id, { breaks: [], working: [] }]),
  ) as Record<number, DayDraft>;

  for (const rule of rules) {
    if (rule.staff_id !== staffId || !rule.is_active) {
      continue;
    }

    const target = rule.rule_type === "break" ? "breaks" : "working";
    week[rule.day_of_week][target].push({
      endsAt: rule.ends_at_local.slice(0, 5),
      startsAt: rule.starts_at_local.slice(0, 5),
    });
  }

  for (const day of DAYS) {
    week[day.id].working.sort((left, right) =>
      left.startsAt.localeCompare(right.startsAt),
    );
    week[day.id].breaks.sort((left, right) =>
      left.startsAt.localeCompare(right.startsAt),
    );
  }

  return week;
}

function weekKey(week: Record<number, DayDraft>) {
  return JSON.stringify(
    DAYS.map((day) => [
      day.id,
      week[day.id].working,
      week[day.id].breaks,
    ]),
  );
}

function presetWeekdays() {
  const week = structuredClone(EMPTY_WEEK);

  for (const day of [1, 2, 3, 4, 5]) {
    week[day] = {
      breaks: [],
      working: [{ endsAt: "17:00", startsAt: "09:00" }],
    };
  }

  return week;
}

function nextLocalDateTime(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "00";
  const date = `${part("year")}-${part("month")}-${part("day")}`;

  return {
    end: `${date}T17:00`,
    start: `${date}T13:00`,
  };
}

function IntervalEditor({
  disabled,
  intervals,
  label,
  onAdd,
  onRemove,
  onUpdate,
}: {
  disabled: boolean;
  intervals: TimeIntervalDraft[];
  label: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, next: Partial<TimeIntervalDraft>) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
        <button
          className="booking-setup-secondary-button min-h-8 px-2 text-xs disabled:opacity-50"
          disabled={disabled}
          onClick={onAdd}
          type="button"
        >
          Add interval
        </button>
      </div>
      {intervals.length === 0 ? (
        <p className="booking-setup-empty px-3 py-2 text-sm">
          None
        </p>
      ) : (
        intervals.map((interval, index) => (
          <div
            className="grid grid-cols-[1fr_1fr_auto] gap-2"
            key={`${interval.startsAt}-${interval.endsAt}-${index}`}
          >
            <input
              aria-label={`${label} start`}
              className="booking-setup-field"
              disabled={disabled}
              onChange={(event) =>
                onUpdate(index, { startsAt: event.target.value })
              }
              type="time"
              value={interval.startsAt}
            />
            <input
              aria-label={`${label} end`}
              className="booking-setup-field"
              disabled={disabled}
              onChange={(event) => onUpdate(index, { endsAt: event.target.value })}
              type="time"
              value={interval.endsAt}
            />
            <button
              className="booking-setup-secondary-button px-2 disabled:opacity-50"
              disabled={disabled}
              onClick={() => onRemove(index)}
              type="button"
            >
              Remove
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export function StaffAvailabilityEditor({
  availabilityRules,
  canManage,
  readinessByStaffId,
  selectedStaffId,
  staff,
  timeBlocks,
  timezone,
}: {
  availabilityRules: StaffAvailabilityRule[];
  canManage: boolean;
  readinessByStaffId: Record<string, StaffBookingReadiness>;
  selectedStaffId?: string | null;
  staff: Staff[];
  timeBlocks: StaffTimeBlock[];
  timezone: string;
}) {
  const router = useRouter();
  const firstStaffId =
    (selectedStaffId && staff.some((member) => member.id === selectedStaffId)
      ? selectedStaffId
      : null) ||
    staff[0]?.id ||
    "";
  const [selectedStaffState, setSelectedStaffState] = useState(() => ({
    key: firstStaffId,
    staffId: firstStaffId,
  }));
  const activeStaffId =
    selectedStaffState.key === firstStaffId
      ? selectedStaffState.staffId
      : firstStaffId;
  const activeStaff = staff.find((member) => member.id === activeStaffId) ?? null;
  const initialWeek = useMemo(
    () => buildWeekDraft(availabilityRules, activeStaffId),
    [activeStaffId, availabilityRules],
  );
  const initialWeekKey = weekKey(initialWeek);
  const weekStateKey = `${activeStaffId}:${initialWeekKey}`;
  const [weekState, setWeekState] = useState<WeekState>(() => ({
    key: weekStateKey,
    week: initialWeek,
  }));
  const week = weekState.key === weekStateKey ? weekState.week : initialWeek;
  const [result, setResult] = useState<BookingSetupActionResult | null>(null);
  const [blockResult, setBlockResult] = useState<BookingSetupActionResult | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const [isBlockPending, startBlockTransition] = useTransition();
  const [blockType, setBlockType] =
    useState<"blocked" | "break" | "cleanup" | "time_off">("time_off");
  const nextBlock = useMemo(() => nextLocalDateTime(timezone), [timezone]);
  const [blockStart, setBlockStart] = useState(nextBlock.start);
  const [blockEnd, setBlockEnd] = useState(nextBlock.end);
  const [blockReason, setBlockReason] = useState("");
  const [allDayBlock, setAllDayBlock] = useState(false);
  const weekDirty = weekKey(week) !== initialWeekKey ? 1 : 0;
  const relevantBlocks = timeBlocks.filter(
    (block) =>
      block.is_active !== false &&
      (!block.staff_id || block.staff_id === activeStaffId),
  );

  function selectStaff(staffId: string) {
    setSelectedStaffState({ key: firstStaffId, staffId });

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.set("tab", "availability");
      params.delete("section");
      params.set("staffId", staffId);
      router.replace(`/bookings?${params.toString()}`, { scroll: false });
    }
  }

  function updateDay(
    dayId: number,
    target: keyof DayDraft,
    updater: (intervals: TimeIntervalDraft[]) => TimeIntervalDraft[],
  ) {
    setWeekState({
      key: weekStateKey,
      week: {
        ...week,
        [dayId]: {
          ...week[dayId],
          [target]: updater(week[dayId][target]),
        },
      },
    });
  }

  function toggleDay(dayId: number, enabled: boolean) {
    setWeekState({
      key: weekStateKey,
      week: {
        ...week,
        [dayId]: enabled
          ? {
              breaks: [],
              working:
                week[dayId].working.length > 0
                  ? week[dayId].working
                  : [{ endsAt: "17:00", startsAt: "09:00" }],
            }
          : { breaks: [], working: [] },
      },
    });
  }

  function copyMonday(target: "all" | "weekdays") {
    const monday = structuredClone(week[1]);
    const next = structuredClone(week);
    const days = target === "all" ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];

    for (const day of days) {
      next[day] = structuredClone(monday);
    }

    setWeekState({
      key: weekStateKey,
      week: next,
    });
  }

  function saveWeek() {
    if (!activeStaffId) {
      return;
    }

    setResult(null);
    startTransition(async () => {
      const rules = DAYS.flatMap((day) => [
        ...week[day.id].working.map((interval) => ({
          dayOfWeek: day.id,
          endsAtLocal: interval.endsAt,
          ruleType: "working" as const,
          startsAtLocal: interval.startsAt,
          timezoneIana: timezone,
        })),
        ...week[day.id].breaks.map((interval) => ({
          dayOfWeek: day.id,
          endsAtLocal: interval.endsAt,
          ruleType: "break" as const,
          startsAtLocal: interval.startsAt,
          timezoneIana: timezone,
        })),
      ]);
      const response = await saveStaffWeeklyAvailabilityAction({
        rules,
        staffId: activeStaffId,
      });

      setResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  function createBlock(overrideConflicts = false) {
    if (!activeStaffId) {
      return;
    }

    setBlockResult(null);
    startBlockTransition(async () => {
      const startLocal = allDayBlock ? `${blockStart.slice(0, 10)}T00:00` : blockStart;
      const endLocal = allDayBlock ? `${blockStart.slice(0, 10)}T23:59` : blockEnd;
      const response = await createStaffTimeBlockAction({
        blockType,
        endLocal,
        overrideConflicts,
        reason: blockReason,
        staffId: activeStaffId,
        startLocal,
        timezoneIana: timezone,
      });

      setBlockResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  function cancelBlock(blockId: string) {
    setBlockResult(null);
    startBlockTransition(async () => {
      const response = await cancelStaffTimeBlockAction({ blockId });

      setBlockResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  if (staff.length === 0) {
    return (
      <section className="booking-setup-empty p-5 text-sm">
        No staff profiles are available.
      </section>
    );
  }

  return (
    <section
      className="booking-setup-panel"
      data-booking-setup-surface="availability"
      id="staff-availability"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-zinc-950">
            Staff availability
          </h3>
          <p className="mt-1 text-sm text-zinc-600">{timezone}</p>
        </div>
        {activeStaff ? (
          <ReadinessChips readiness={readinessByStaffId[activeStaff.id]} />
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="booking-setup-staff-picker">
          {staff.map((member) => {
            const readiness = readinessByStaffId[member.id];

            return (
              <button
                className={classNames(
                  "booking-setup-staff-option",
                  activeStaffId === member.id
                    ? "booking-setup-staff-option--active"
                    : "booking-setup-staff-option--idle",
                )}
                key={member.id}
                onClick={() => selectStaff(member.id)}
                type="button"
              >
                <SetupStaffAvatar staff={member} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-zinc-950">
                    {member.display_name}
                  </span>
                  <span className="mt-1 block text-xs text-zinc-500">
                    {readiness?.assignedServiceCount ?? 0} services /{" "}
                    {readiness?.workingRuleCount ?? 0} hours
                  </span>
                </span>
              </button>
            );
          })}
        </aside>
        <div className="grid min-w-0 gap-5">
          <Message result={result} />
          <div className="flex flex-wrap gap-2">
            <button
              className="booking-setup-secondary-button min-h-9 disabled:opacity-50"
              disabled={!canManage}
              onClick={() =>
                setWeekState({ key: weekStateKey, week: presetWeekdays() })
              }
              type="button"
            >
              Monday-Friday preset
            </button>
            <button
              className="booking-setup-secondary-button min-h-9 disabled:opacity-50"
              disabled={!canManage}
              onClick={() => copyMonday("weekdays")}
              type="button"
            >
              Copy Monday to weekdays
            </button>
            <button
              className="booking-setup-secondary-button min-h-9 disabled:opacity-50"
              disabled={!canManage}
              onClick={() => copyMonday("all")}
              type="button"
            >
              Copy Monday to all days
            </button>
            <button
              className="booking-setup-secondary-button min-h-9 disabled:opacity-50"
              disabled={!canManage}
              onClick={() =>
                setWeekState({
                  key: weekStateKey,
                  week: structuredClone(EMPTY_WEEK),
                })
              }
              type="button"
            >
              Clear week
            </button>
          </div>
          <div className="grid gap-3">
            {DAYS.map((day) => {
              const dayDraft = week[day.id];
              const enabled = dayDraft.working.length > 0;

              return (
                <section className="booking-setup-day-card" key={day.id}>
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-zinc-950">
                      {day.label}
                    </h4>
                    <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                      <input
                        checked={enabled}
                        className="size-4"
                        disabled={!canManage}
                        onChange={(event) =>
                          toggleDay(day.id, event.target.checked)
                        }
                        type="checkbox"
                      />
                      {enabled ? "Enabled" : "Off"}
                    </label>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    <IntervalEditor
                      disabled={!canManage || !enabled}
                      intervals={dayDraft.working}
                      label="Working"
                      onAdd={() =>
                        updateDay(day.id, "working", (intervals) => [
                          ...intervals,
                          { endsAt: "17:00", startsAt: "09:00" },
                        ])
                      }
                      onRemove={(index) =>
                        updateDay(day.id, "working", (intervals) =>
                          intervals.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      onUpdate={(index, next) =>
                        updateDay(day.id, "working", (intervals) =>
                          intervals.map((interval, itemIndex) =>
                            itemIndex === index
                              ? { ...interval, ...next }
                              : interval,
                          ),
                        )
                      }
                    />
                    <IntervalEditor
                      disabled={!canManage || !enabled}
                      intervals={dayDraft.breaks}
                      label="Breaks"
                      onAdd={() =>
                        updateDay(day.id, "breaks", (intervals) => [
                          ...intervals,
                          { endsAt: "13:00", startsAt: "12:00" },
                        ])
                      }
                      onRemove={(index) =>
                        updateDay(day.id, "breaks", (intervals) =>
                          intervals.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                      onUpdate={(index, next) =>
                        updateDay(day.id, "breaks", (intervals) =>
                          intervals.map((interval, itemIndex) =>
                            itemIndex === index
                              ? { ...interval, ...next }
                              : interval,
                          ),
                        )
                      }
                    />
                  </div>
                </section>
              );
            })}
          </div>
          <StickySaveBar
            canManage={canManage}
            dirtyCount={weekDirty}
            isPending={isPending}
            onReset={() => setWeekState({ key: weekStateKey, week: initialWeek })}
            onSave={saveWeek}
          />
          <section className="booking-setup-subpanel">
            <div>
              <h4 className="text-sm font-semibold text-zinc-950">
                Breaks and time off
              </h4>
              <p className="mt-1 text-sm text-zinc-600">
                Upcoming blocks for {activeStaff?.display_name ?? "staff"}.
              </p>
            </div>
            <Message result={blockResult} />
            <div className="grid gap-3 lg:grid-cols-[160px_1fr_1fr]">
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase text-zinc-500">
                  Type
                </span>
                <select
                  className="booking-setup-field"
                  disabled={!canManage}
                  onChange={(event) =>
                    setBlockType(
                      event.target.value as "blocked" | "break" | "cleanup" | "time_off",
                    )
                  }
                  value={blockType}
                >
                  <option value="time_off">Time off</option>
                  <option value="blocked">Blocked</option>
                  <option value="break">Break</option>
                  <option value="cleanup">Cleanup</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase text-zinc-500">
                  Start
                </span>
                <input
                  className="booking-setup-field"
                  disabled={!canManage}
                  onChange={(event) => setBlockStart(event.target.value)}
                  type="datetime-local"
                  value={blockStart}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase text-zinc-500">
                  End
                </span>
                <input
                  className="booking-setup-field"
                  disabled={!canManage || allDayBlock}
                  onChange={(event) => setBlockEnd(event.target.value)}
                  type="datetime-local"
                  value={blockEnd}
                />
              </label>
            </div>
            <div className="grid gap-3 lg:grid-cols-[160px_minmax(0,1fr)_auto]">
              <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                <input
                  checked={allDayBlock}
                  className="size-4"
                  disabled={!canManage}
                  onChange={(event) => setAllDayBlock(event.target.checked)}
                  type="checkbox"
                />
                All day
              </label>
              <input
                className="booking-setup-field"
                disabled={!canManage}
                onChange={(event) => setBlockReason(event.target.value)}
                placeholder="Reason"
                value={blockReason}
              />
              <button
                className="booking-setup-primary-button disabled:opacity-50"
                disabled={!canManage || isBlockPending}
                onClick={() => createBlock(false)}
                type="button"
              >
                Add block
              </button>
            </div>
            {!blockResult?.ok && blockResult?.conflicts?.length ? (
              <button
                className="booking-setup-secondary-button w-fit border-amber-300 text-amber-900"
                disabled={!canManage || isBlockPending}
                onClick={() => createBlock(true)}
                type="button"
              >
                Save block with override
              </button>
            ) : null}
            <div className="grid gap-2">
              {relevantBlocks.length === 0 ? (
                <p className="booking-setup-empty px-3 py-4 text-sm">
                  No upcoming blocks.
                </p>
              ) : (
                relevantBlocks.map((block) => (
                  <div
                    className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    key={block.id}
                  >
                    <div>
                      <p className="text-sm font-semibold text-zinc-950">
                        {block.block_type.replace(/_/g, " ")}
                      </p>
                      <p className="mt-1 text-sm text-zinc-600">
                        {formatDateTime(block.starts_at, timezone)} -{" "}
                        {formatDateTime(block.ends_at, timezone)}
                      </p>
                      {block.reason ? (
                        <p className="mt-1 text-xs text-zinc-500">
                          {block.reason}
                        </p>
                      ) : null}
                    </div>
                    {canManage ? (
                      <button
                        className="booking-setup-secondary-button min-h-9 disabled:opacity-50"
                        disabled={isBlockPending}
                        onClick={() => cancelBlock(block.id)}
                        type="button"
                      >
                        Cancel block
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

export type BookingSetupEditorData = Pick<
  BookingSetupData,
  | "assignments"
  | "availabilityRules"
  | "permissions"
  | "readinessByStaffId"
  | "services"
  | "staff"
  | "timeBlocks"
  | "timezone"
>;
