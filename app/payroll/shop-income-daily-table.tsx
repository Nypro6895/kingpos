"use client";

import { Fragment, useMemo, useState } from "react";
import type {
  PayrollCorrectionListItem,
  PayrollShopDailyRow,
} from "@/types/payroll";

type DailyStatusKind = "match" | "missing" | "no_activity" | "over" | "short";

type CorrectionEvent = {
  by: string;
  change: string;
  correctedAt: string;
  id: string;
  reason: string | null;
  sortTime: number;
  status: string;
};

type DailyTableRow = {
  correctionEvents: CorrectionEvent[];
  row: PayrollShopDailyRow;
};

const FIELD_LABELS: Record<string, string> = {
  cash_amount: "Cash",
  commission_amount: "Commission",
  credit_card_amount: "Card",
  other_amount: "Other",
  staff_id: "Staff",
  staff_service_amount: "Staff earning",
  staff_tip: "Staff tip",
  ticket_amount: "Ticket Amount",
  ticket_discount: "Ticket Discount",
  ticket_tip: "Tip",
  tip_amount: "Tip",
};

const MONEY_FIELDS = new Set([
  "cash_amount",
  "commission_amount",
  "credit_card_amount",
  "other_amount",
  "staff_service_amount",
  "staff_tip",
  "ticket_amount",
  "ticket_discount",
  "ticket_tip",
  "tip_amount",
]);

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatSignedMoney(value: number) {
  if (value > 0) {
    return `+${formatMoney(value)}`;
  }

  if (value < 0) {
    return `-${formatMoney(Math.abs(value))}`;
  }

  return formatMoney(0);
}

function formatOptionalMoney(value: number | null) {
  return value === null ? "\u2014" : formatMoney(value);
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function formatDailyDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(parseDate(value));
}

function formatCorrectionDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fieldLabel(value: string) {
  return FIELD_LABELS[value] ?? titleCase(value);
}

function isAuditOnly(correction: PayrollCorrectionListItem) {
  return correction.delta === null || correction.delta === 0;
}

function readString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value ? value : null;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function readRecordNumber(record: Record<string, unknown> | null, key: string) {
  return readNumber(record?.[key]);
}

function readRecordArray(record: Record<string, unknown> | null, key: string) {
  return Array.isArray(record?.[key]) ? (record[key] as unknown[]) : [];
}

function parsedCorrectionPayloads(correction: PayrollCorrectionListItem) {
  const oldPayload = parseJsonValue(correction.rawOldValue ?? correction.oldValue);
  const newPayload = parseJsonValue(correction.rawNewValue ?? correction.newValue);

  return {
    newPayload,
    newRecord: readRecord(newPayload),
    oldPayload,
    oldRecord: readRecord(oldPayload),
  };
}

function staffNameFromSnapshotItem(item: unknown) {
  const record = readRecord(item);
  const assignedStaff = readRecord(record?.assigned_staff);
  return (
    readString(assignedStaff, "display_name") ??
    readString(record, "staffName") ??
    readString(record, "staff_name")
  );
}

function staffNamesFromPayload(value: unknown) {
  const names = new Map<string, string>();
  const root = readRecord(value);
  const ticket = readRecord(root?.ticket);
  const items = readRecordArray(ticket, "ticket_items");

  for (const item of items) {
    const record = readRecord(item);
    const staffId = readString(record, "assigned_staff_id") ?? readString(record, "staffId");
    const staffName = staffNameFromSnapshotItem(item);

    if (staffId && staffName) {
      names.set(staffId, staffName);
    }
  }

  return names;
}

function resolveStaffName(
  correction: PayrollCorrectionListItem,
  staffId: string | null,
  payloads: unknown[],
) {
  if (staffId && correction.staffId === staffId && correction.staffName) {
    return correction.staffName;
  }

  if (!staffId && correction.staffName) {
    return correction.staffName;
  }

  if (staffId) {
    for (const payload of payloads) {
      const staffName = staffNamesFromPayload(payload).get(staffId);

      if (staffName) {
        return staffName;
      }
    }
  }

  return null;
}

function sharedValue(values: string[]) {
  const uniqueValues = new Set(values.filter(Boolean));
  return uniqueValues.size === 1 ? values[0] : "Multiple";
}

function parseJsonValue(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readCorrectionField(value: unknown) {
  const record = readRecord(value);
  const field = record && typeof record.field === "string" ? record.field : null;

  return {
    field,
    value: record && "value" in record ? record.value : value,
  };
}

function isSimpleValue(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function formatFieldValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (MONEY_FIELDS.has(field) && typeof value === "number") {
    return formatMoney(value);
  }

  if (MONEY_FIELDS.has(field) && typeof value === "string") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? formatMoney(numeric) : value;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return `${value}`;
  }

  if (typeof value === "string") {
    return value;
  }

  return "Details";
}

function inferredField(correction: PayrollCorrectionListItem) {
  if (FIELD_LABELS[correction.type]) {
    return correction.type;
  }

  if (correction.type === "ticket_tip") {
    return "ticket_tip";
  }

  return null;
}

function isLikelyId(value: unknown) {
  return (
    typeof value === "string" &&
    (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) || value.length > 24)
  );
}

function correctionFieldDiff(correction: PayrollCorrectionListItem) {
  const oldPayload = parseJsonValue(correction.rawOldValue ?? correction.oldValue);
  const newPayload = parseJsonValue(correction.rawNewValue ?? correction.newValue);
  const oldField = readCorrectionField(oldPayload);
  const newField = readCorrectionField(newPayload);
  const field = newField.field ?? oldField.field ?? inferredField(correction);

  if (!field || !isSimpleValue(oldField.value) || !isSimpleValue(newField.value)) {
    return null;
  }

  return {
    field,
    newValue: newField.value,
    oldValue: oldField.value,
  };
}

function formatChangeAmount(
  label: string,
  oldAmount: number | null,
  newAmount: number | null,
) {
  if (oldAmount !== null && newAmount !== null) {
    if (oldAmount === newAmount) {
      return null;
    }

    return `${label} ${formatMoney(oldAmount)} \u2192 ${formatMoney(newAmount)}`;
  }

  return null;
}

function staffAmountChange(
  staffName: string | null,
  label: string,
  oldAmount: number | null,
  newAmount: number | null,
) {
  if (staffName && newAmount !== null && newAmount > 0 && (oldAmount ?? 0) === 0) {
    return `${staffName} added: ${formatMoney(newAmount)}`;
  }

  if (staffName && oldAmount !== null && oldAmount > 0 && (newAmount ?? 0) === 0) {
    return `${staffName} removed: ${formatMoney(oldAmount)}`;
  }

  const amount = formatChangeAmount(label, oldAmount, newAmount);

  if (!amount) {
    return null;
  }

  return staffName ? `${staffName}: ${amount}` : `Staff ${amount.toLowerCase()}`;
}

function correctionDetailStaffId(
  detail: Record<string, unknown>,
  oldValue: Record<string, unknown> | null,
  requestedValue: Record<string, unknown> | null,
) {
  return (
    readString(detail, "staffId") ??
    readString(detail, "staff_id") ??
    readString(oldValue, "staffId") ??
    readString(oldValue, "staff_id") ??
    readString(requestedValue, "staffId") ??
    readString(requestedValue, "staff_id")
  );
}

function financialCorrectionDetails(correction: PayrollCorrectionListItem) {
  const { newRecord } = parsedCorrectionPayloads(correction);
  const financialCorrection = readRecord(newRecord?.financial_correction);
  const financialRows = readRecordArray(financialCorrection, "corrections");
  const directRows = readRecordArray(newRecord, "corrections");
  const rows = financialRows.length > 0 ? financialRows : directRows;

  return rows
    .map(readRecord)
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

function changeFromFinancialDetail(
  detail: Record<string, unknown>,
  correction: PayrollCorrectionListItem,
) {
  const { newPayload, oldPayload } = parsedCorrectionPayloads(correction);
  const oldValue = readRecord(detail.oldValue);
  const requestedValue = readRecord(detail.requestedValue);
  const correctionType = readString(detail, "correctionType") ?? correction.type;
  const staffId = correctionDetailStaffId(detail, oldValue, requestedValue);
  const staffName = resolveStaffName(correction, staffId, [oldPayload, newPayload]);

  if (correctionType === "staff_service_amount") {
    return staffAmountChange(
      staffName,
      "Pay",
      readRecordNumber(oldValue, "serviceAmount"),
      readRecordNumber(requestedValue, "serviceAmount"),
    );
  }

  if (correctionType === "staff_tip") {
    return staffAmountChange(
      staffName,
      "Tip",
      readRecordNumber(oldValue, "tipAmount"),
      readRecordNumber(requestedValue, "tipAmount"),
    );
  }

  if (correctionType === "staff_turn_count") {
    return null;
  }

  if (correctionType === "ticket_staff_assignment") {
    return null;
  }

  if (correctionType === "ticket_service") {
    return null;
  }

  return null;
}

function changeFromFieldDiff(correction: PayrollCorrectionListItem) {
  const diff = correctionFieldDiff(correction);

  if (!diff) {
    return null;
  }

  if (
    diff.field === "staff_turn_count" ||
    diff.field === "turnCount" ||
    diff.field === "turn_count" ||
    diff.field === "status" ||
    diff.field === "difference"
  ) {
    return null;
  }

  if (diff.field === "staff_id") {
    if (isLikelyId(diff.oldValue) || isLikelyId(diff.newValue)) {
      return "Staff changed";
    }

    return `Staff changed: ${formatFieldValue(
      diff.field,
      diff.oldValue,
    )} \u2192 ${formatFieldValue(diff.field, diff.newValue)}`;
  }

  if (
    diff.field === "cash_amount" ||
    diff.field === "credit_card_amount" ||
    diff.field === "other_amount"
  ) {
    return `${fieldLabel(diff.field)} ${formatFieldValue(
      diff.field,
      diff.oldValue,
    )} \u2192 ${formatFieldValue(diff.field, diff.newValue)}`;
  }

  if (diff.field === "staff_service_amount" || diff.field === "commission_amount") {
    return staffAmountChange(
      correction.staffName,
      "Pay",
      readNumber(diff.oldValue),
      readNumber(diff.newValue),
    );
  }

  if (diff.field === "staff_tip" || diff.field === "ticket_tip" || diff.field === "tip_amount") {
    return staffAmountChange(
      correction.staffName,
      "Tip",
      readNumber(diff.oldValue),
      readNumber(diff.newValue),
    );
  }

  if (MONEY_FIELDS.has(diff.field)) {
    return formatChangeAmount(
      fieldLabel(diff.field),
      readNumber(diff.oldValue),
      readNumber(diff.newValue),
    );
  }

  const oldAmount = readNumber(diff.oldValue);
  const newAmount = readNumber(diff.newValue);

  if (oldAmount !== null && newAmount !== null) {
    return formatChangeAmount("Amount changed", oldAmount, newAmount);
  }

  return null;
}

function readSnapshotEarnings(payload: unknown) {
  const root = readRecord(payload);
  return readRecordArray(root, "earnings")
    .map(readRecord)
    .filter((row): row is Record<string, unknown> => Boolean(row));
}

function changeFromTicketSnapshot(correction: PayrollCorrectionListItem) {
  const { newPayload, oldPayload } = parsedCorrectionPayloads(correction);
  const beforeEarnings = readSnapshotEarnings(oldPayload);
  const afterEarnings = readSnapshotEarnings(newPayload);

  if (beforeEarnings.length === 0 || afterEarnings.length === 0) {
    return [];
  }

  const beforeByStaff = new Map(
    beforeEarnings
      .map((earning) => [readString(earning, "staff_id"), earning] as const)
      .filter((entry): entry is readonly [string, Record<string, unknown>] =>
        Boolean(entry[0]),
      ),
  );
  const changes: string[] = [];

  for (const after of afterEarnings) {
    const staffId = readString(after, "staff_id");

    if (!staffId) {
      continue;
    }

    const before = beforeByStaff.get(staffId);
    const staffName = resolveStaffName(correction, staffId, [oldPayload, newPayload]);
    const beforeService = readRecordNumber(before ?? null, "service_total");
    const afterService = readRecordNumber(after, "service_total");
    const beforeTip = readRecordNumber(before ?? null, "tip_amount");
    const afterTip = readRecordNumber(after, "tip_amount");
    const serviceChange = staffAmountChange(
      staffName,
      "Pay",
      beforeService,
      afterService,
    );
    const tipChange = staffAmountChange(
      staffName,
      "Tip",
      beforeTip,
      afterTip,
    );

    if (
      serviceChange &&
      beforeService !== null &&
      afterService !== null &&
      beforeService !== afterService
    ) {
      changes.push(serviceChange);
    }

    if (tipChange && beforeTip !== null && afterTip !== null && beforeTip !== afterTip) {
      changes.push(tipChange);
    }
  }

  return changes;
}

function fallbackCorrectionChange(correction: PayrollCorrectionListItem) {
  if (correction.type === "void_ticket") {
    return "Ticket voided";
  }

  return null;
}

function ownerChangesForCorrection(correction: PayrollCorrectionListItem) {
  const financialChanges = financialCorrectionDetails(correction)
    .map((detail) => changeFromFinancialDetail(detail, correction))
    .filter((change): change is string => Boolean(change));

  if (financialChanges.length > 0) {
    return financialChanges;
  }

  const fieldChange = changeFromFieldDiff(correction);

  if (fieldChange) {
    return [fieldChange];
  }

  const snapshotChanges = changeFromTicketSnapshot(correction);

  if (snapshotChanges.length > 0) {
    return snapshotChanges;
  }

  const fallback = fallbackCorrectionChange(correction);
  return fallback ? [fallback] : [];
}

function formatCorrectionStatus(status: string) {
  const normalized = status.toLowerCase();

  if (
    normalized === "applied" ||
    normalized === "approved" ||
    normalized === "recorded"
  ) {
    return "Applied";
  }

  if (normalized === "pending") {
    return "Pending";
  }

  if (normalized === "rejected" || normalized === "denied") {
    return "Rejected";
  }

  return titleCase(status);
}

function eventStatus(corrections: PayrollCorrectionListItem[]) {
  const labels = corrections.map((correction) => formatCorrectionStatus(correction.status));

  if (labels.includes("Rejected")) {
    return "Rejected";
  }

  if (labels.includes("Applied")) {
    return "Applied";
  }

  if (labels.includes("Pending")) {
    return "Pending";
  }

  return labels[0] ?? "Applied";
}

function statusClass(status: string) {
  if (status === "Rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (status === "Pending") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function correctionTimeBucket(value: string) {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  return `${Math.floor(timestamp / (5 * 60 * 1000))}`;
}

function correctionGroupKey(correction: PayrollCorrectionListItem) {
  if (correction.correctionRequestId) {
    return `request:${correction.correctionRequestId}`;
  }

  const actor = correction.changedById ?? correction.changedByName ?? "unknown";
  const note = correction.note?.trim().toLowerCase() ?? "";
  const ticket = correction.ticketId ?? correction.ticketNumber ?? "";
  const bucket = correctionTimeBucket(correction.correctionDate);

  if (ticket) {
    return [
      "ticket",
      correction.businessDate,
      ticket,
      actor,
      note,
      bucket,
    ].join("::");
  }

  return [
    isAuditOnly(correction) ? "audit" : "event",
    correction.businessDate,
    actor,
    note,
    bucket,
    isAuditOnly(correction) ? correction.type : "",
    isAuditOnly(correction) ? correction.status : "",
  ].join("::");
}

function eventChange(corrections: PayrollCorrectionListItem[]) {
  const labels = corrections.flatMap(ownerChangesForCorrection);
  const uniqueLabels = Array.from(new Set(labels));
  const hasExactAmountChange = uniqueLabels.some((label) => label.includes("\u2192"));
  const displayLabels = hasExactAmountChange
    ? uniqueLabels.filter(
        (label) =>
          label.includes("\u2192") ||
          (!label.includes("+$") &&
            !label.includes("-$") &&
            !label.startsWith("Amount changed")),
      )
    : uniqueLabels;

  if (displayLabels.length === 1) {
    return displayLabels[0];
  }

  if (displayLabels.length === 2) {
    return displayLabels.join("; ");
  }

  if (displayLabels.length > 2) {
    return displayLabels.slice(0, 4).join("; ");
  }

  return "Correction applied";
}

function correctionSortTime(correction: PayrollCorrectionListItem) {
  const timestamp = Date.parse(correction.correctionDate);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function buildCorrectionEvents(corrections: PayrollCorrectionListItem[]) {
  const grouped = new Map<string, PayrollCorrectionListItem[]>();

  for (const correction of corrections) {
    const key = correctionGroupKey(correction);
    const list = grouped.get(key) ?? [];
    list.push(correction);
    grouped.set(key, list);
  }

  return Array.from(grouped.values())
    .map<CorrectionEvent>((group) => {
      const sorted = [...group].sort(
        (left, right) => correctionSortTime(left) - correctionSortTime(right),
      );
      const sortTime = Math.max(...sorted.map(correctionSortTime));
      const correctedAtCorrection =
        sorted.find((correction) => correctionSortTime(correction) === sortTime) ??
        sorted[sorted.length - 1];

      return {
        by: sharedValue(
          sorted.map((correction) => correction.changedByName ?? "Unknown"),
        ),
        change: eventChange(sorted),
        correctedAt: formatCorrectionDateTime(correctedAtCorrection.correctionDate),
        id: sorted.map((correction) => correction.id).join("-"),
        reason:
          sorted.find((correction) => correction.note?.trim())?.note?.trim() ?? null,
        sortTime,
        status: eventStatus(sorted),
      };
    })
    .sort((left, right) => right.sortTime - left.sortTime);
}

function rowDifference(row: PayrollShopDailyRow) {
  if (row.actualIncome === null) {
    return null;
  }

  return row.difference ?? row.actualIncome - row.posIncome;
}

function formatDifference(row: PayrollShopDailyRow) {
  const difference = rowDifference(row);
  return difference === null ? "\u2014" : formatSignedMoney(difference);
}

function differenceClass(row: PayrollShopDailyRow) {
  const difference = rowDifference(row);

  if (difference === null) {
    return "text-zinc-400";
  }

  if (difference < 0) {
    return "font-semibold text-rose-700";
  }

  if (difference > 0) {
    return "font-semibold text-amber-700";
  }

  return "text-zinc-700";
}

function statusForRow(row: PayrollShopDailyRow): {
  kind: DailyStatusKind;
  label: string;
} {
  if (row.actualIncome === null) {
    return row.posIncome > 0
      ? {
          kind: "missing",
          label: "Missing actual input",
        }
      : {
          kind: "no_activity",
          label: "No activity",
        };
  }

  const difference = rowDifference(row) ?? 0;

  if (difference < 0) {
    return {
      kind: "short",
      label: `Short ${formatMoney(Math.abs(difference))}`,
    };
  }

  if (difference > 0) {
    return {
      kind: "over",
      label: `Over ${formatMoney(difference)}`,
    };
  }

  return {
    kind: "match",
    label: "Match",
  };
}

function statusBadgeClass(kind: DailyStatusKind) {
  if (kind === "match") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (kind === "over") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (kind === "short") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  if (kind === "missing") {
    return "border-yellow-200 bg-yellow-50 text-yellow-800";
  }

  return "border-zinc-200 bg-zinc-50 text-zinc-500";
}

function DetailMetric({
  className = "",
  label,
  value,
}: {
  className?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`whitespace-nowrap font-medium text-zinc-800 ${className}`}>
        {value}
      </dd>
    </div>
  );
}

function DailyDetailsSubRow({ row }: { row: PayrollShopDailyRow }) {
  return (
    <tr>
      <td className="bg-zinc-50/80 px-4 py-3" colSpan={5}>
        <div className="grid gap-5 text-xs md:grid-cols-2">
          <section>
            <h3 className="mb-2 font-semibold text-zinc-800">Reconciliation</h3>
            <dl className="grid gap-1.5">
              <DetailMetric label="Actual" value={formatOptionalMoney(row.actualIncome)} />
              <DetailMetric label="POS" value={formatMoney(row.posIncome)} />
              <DetailMetric
                className={differenceClass(row)}
                label="Difference"
                value={formatDifference(row)}
              />
            </dl>
          </section>
          <section>
            <h3 className="mb-2 font-semibold text-zinc-800">Payroll impact</h3>
            <dl className="grid gap-1.5">
              <DetailMetric
                label="Staff Production"
                value={formatMoney(row.staffProduction)}
              />
              <DetailMetric
                label="Staff Commission Pay"
                value={formatMoney(row.staffCommissionPay)}
              />
              <DetailMetric label="Tips" value={formatMoney(row.tips)} />
              <DetailMetric label="Shop Share" value={formatMoney(row.shopShare)} />
            </dl>
          </section>
        </div>
      </td>
    </tr>
  );
}

function correctionEventDetails(event: CorrectionEvent) {
  return event.change;
}

function CorrectionEventList({ events }: { events: CorrectionEvent[] }) {
  return (
    <ul className="grid gap-2">
      {events.map((event) => (
        <li
          className="grid gap-2 rounded-md border border-amber-100 bg-white px-3 py-2 text-xs shadow-sm md:grid-cols-[11rem_1fr_auto] md:items-start"
          key={event.id}
        >
          <div className="whitespace-nowrap text-zinc-600">{event.correctedAt}</div>
          <div>
            <div className="font-medium text-zinc-950">
              {correctionEventDetails(event)}
            </div>
            {event.reason ? (
              <div className="mt-1 text-zinc-500">Reason: {event.reason}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <span className="whitespace-nowrap text-zinc-600">by {event.by}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClass(
                event.status,
              )}`}
            >
              {event.status}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CorrectionSubRow({ events }: { events: CorrectionEvent[] }) {
  return (
    <tr>
      <td className="bg-amber-50/40 px-4 py-4" colSpan={5}>
        <div className="grid gap-2">
          <CorrectionEventList events={events} />
        </div>
      </td>
    </tr>
  );
}

export function ShopIncomeDailyTable({ rows }: { rows: PayrollShopDailyRow[] }) {
  const [openCorrectionDates, setOpenCorrectionDates] = useState<Set<string>>(
    new Set(),
  );
  const [openDetailDates, setOpenDetailDates] = useState<Set<string>>(new Set());
  const [showInactiveDays, setShowInactiveDays] = useState(false);
  const dailyRows = useMemo<DailyTableRow[]>(
    () =>
      rows.map((row) => ({
        correctionEvents: buildCorrectionEvents(row.corrections),
        row,
      })),
    [rows],
  );
  const visibleRows = showInactiveDays
    ? dailyRows
    : dailyRows.filter(
        ({ correctionEvents, row }) =>
          !(
            row.actualIncome === null &&
            row.posIncome === 0 &&
            correctionEvents.length === 0
          ),
      );

  function toggleCorrectionDate(date: string) {
    setOpenCorrectionDates((current) => {
      const next = new Set(current);

      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }

      return next;
    });
  }

  function toggleDetailDate(date: string) {
    setOpenDetailDates((current) => {
      const next = new Set(current);

      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }

      return next;
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-950">Daily Shop Income</h2>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-600">
          <input
            checked={showInactiveDays}
            className="h-4 w-4 rounded border-zinc-300 text-zinc-900"
            onChange={(event) => setShowInactiveDays(event.target.checked)}
            type="checkbox"
          />
          Show inactive days
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold text-zinc-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3">Date</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Actual</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">POS</th>
              <th className="whitespace-nowrap px-4 py-3">Status</th>
              <th className="whitespace-nowrap px-4 py-3">Corrections</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {visibleRows.map(({ correctionEvents, row }) => {
              const isCorrectionsOpen = openCorrectionDates.has(row.businessDate);
              const isDetailsOpen = openDetailDates.has(row.businessDate);
              const hasCorrections = correctionEvents.length > 0;
              const status = statusForRow(row);

              return (
                <Fragment key={row.businessDate}>
                  <tr
                    className={`align-middle ${
                      hasCorrections ? "bg-amber-50/30" : "bg-white"
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-950">
                      <button
                        aria-expanded={isDetailsOpen}
                        className="inline-flex items-center gap-2 rounded-md text-left font-medium text-zinc-950 hover:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-300"
                        onClick={() => toggleDetailDate(row.businessDate)}
                        title="Show daily details"
                        type="button"
                      >
                        <span className="w-3 text-xs text-zinc-500" aria-hidden>
                          {isDetailsOpen ? "v" : ">"}
                        </span>
                        {formatDailyDate(row.businessDate)}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {formatOptionalMoney(row.actualIncome)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {formatMoney(row.posIncome)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClass(
                          status.kind,
                        )}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {hasCorrections ? (
                        <button
                          aria-expanded={isCorrectionsOpen}
                          className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800"
                          onClick={() => toggleCorrectionDate(row.businessDate)}
                          type="button"
                        >
                          <span aria-hidden>{isCorrectionsOpen ? "v" : ">"}</span>
                          {correctionEvents.length}{" "}
                          {correctionEvents.length === 1
                            ? "correction"
                            : "corrections"}
                        </button>
                      ) : (
                        <span className="text-zinc-400">{"\u2014"}</span>
                      )}
                    </td>
                  </tr>
                  {isDetailsOpen ? <DailyDetailsSubRow row={row} /> : null}
                  {hasCorrections && isCorrectionsOpen ? (
                    <CorrectionSubRow events={correctionEvents} />
                  ) : null}
                </Fragment>
              );
            })}
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                  colSpan={5}
                >
                  No active shop income days in this period.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
