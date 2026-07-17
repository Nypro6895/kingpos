"use client";

import { useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  correctClosedPosTicketInline,
  submitLockedStaffFinancialCorrection,
} from "@/app/pos-tickets/actions";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import type { PosTicketWithRelations } from "@/types/pos-ticket";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";

type EditablePart = {
  amount: string;
  key: string;
};

type EditableLine = {
  itemId: string | null;
  key: string;
  parts: EditablePart[];
  remove: boolean;
  serviceId: string;
  staffId: string;
};

type SelectorTarget =
  | { field: "service" | "staff"; lineKey: string }
  | null;

type MoneyTarget =
  | { kind: "part"; lineKey: string; partKey: string }
  | { kind: "staffTip"; staffId: string }
  | { kind: "totalTip" }
  | null;

type DailyPosTicketCardProps = {
  businessDateCompactLabel: string;
  canApplyFinancialCorrection: boolean;
  canEdit: boolean;
  dailyNumber: number;
  isBusinessDateLocked: boolean;
  returnTo: string;
  services: Service[];
  staff: Staff[];
  ticket: PosTicketWithRelations;
};

type TicketHistoryAdjustment = NonNullable<
  PosTicketWithRelations["adjustments"]
>[number];

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return `${formatTime(value)} | ${formatDate(value)}`;
}

function toMoneyNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toCents(value: number | string) {
  const numeric = typeof value === "string" ? Number(value) : value;

  if (!Number.isFinite(numeric)) {
    return Number.NaN;
  }

  return Math.round(numeric * 100);
}

function fromCents(value: number) {
  return roundMoney(value / 100);
}

function safeCents(value: number | string) {
  const cents = toCents(value);
  return Number.isFinite(cents) ? cents : 0;
}

function normalizeMoneyInput(value: string) {
  return formatNumber(Math.max(0, fromCents(safeCents(value))));
}

function centsEqual(left: number | string, right: number | string) {
  return safeCents(left) === safeCents(right);
}

function lineTotalCents(line: EditableLine) {
  return line.parts.reduce((total, part) => total + safeCents(part.amount), 0);
}

function lineTotal(line: EditableLine) {
  return fromCents(lineTotalCents(line));
}

function allocateTipCentsByStaff(
  staffServiceTotalCents: Map<string, number>,
  totalTipCents: number,
  manualTipCentsByStaffId = new Map<string, number>(),
) {
  const tipCentsByStaffId = new Map<string, number>();
  const staffIds = Array.from(staffServiceTotalCents.keys()).sort();
  const validTotalTipCents = Math.max(0, totalTipCents);
  const manualTipCents = staffIds.reduce(
    (total, staffId) => total + (manualTipCentsByStaffId.get(staffId) ?? 0),
    0,
  );
  const remainingTipCents = Math.max(0, validTotalTipCents - manualTipCents);
  const nonManualStaffIds = staffIds.filter(
    (staffId) => !manualTipCentsByStaffId.has(staffId),
  );
  const nonManualServiceTotalCents = nonManualStaffIds.reduce(
    (total, staffId) => total + (staffServiceTotalCents.get(staffId) ?? 0),
    0,
  );

  for (const staffId of staffIds) {
    if (manualTipCentsByStaffId.has(staffId)) {
      tipCentsByStaffId.set(staffId, manualTipCentsByStaffId.get(staffId) ?? 0);
    }
  }

  if (remainingTipCents > 0 && nonManualServiceTotalCents > 0) {
    for (const staffId of nonManualStaffIds) {
      const serviceTotalCents = staffServiceTotalCents.get(staffId) ?? 0;
      tipCentsByStaffId.set(
        staffId,
        Math.round((remainingTipCents * serviceTotalCents) / nonManualServiceTotalCents),
      );
    }

    const allocated = nonManualStaffIds.reduce(
      (total, staffId) => total + (tipCentsByStaffId.get(staffId) ?? 0),
      0,
    );
    const remainderCents = remainingTipCents - allocated;

    if (remainderCents !== 0) {
      const remainderStaffId = [...nonManualStaffIds].sort(
        (left, right) =>
          (staffServiceTotalCents.get(right) ?? 0) -
            (staffServiceTotalCents.get(left) ?? 0) ||
          left.localeCompare(right),
      )[0];

      if (remainderStaffId) {
        tipCentsByStaffId.set(
          remainderStaffId,
          (tipCentsByStaffId.get(remainderStaffId) ?? 0) + remainderCents,
        );
      }
    }
  }

  for (const staffId of nonManualStaffIds) {
    tipCentsByStaffId.set(staffId, tipCentsByStaffId.get(staffId) ?? 0);
  }

  return tipCentsByStaffId;
}

function getInitialLines(ticket: PosTicketWithRelations): EditableLine[] {
  return (ticket.ticket_items ?? []).map((item) => {
    const parts =
      item.turn_parts && item.turn_parts.length > 0
        ? [...item.turn_parts].sort(
            (left, right) =>
              left.turn_index - right.turn_index || left.id.localeCompare(right.id),
          )
        : [
            {
              amount: item.line_total,
              id: `${item.id}:fallback`,
              turn_index: 1,
              turn_type: item.line_total >= 25 ? "large" : "small",
            },
          ];

    return {
      itemId: item.id,
      key: item.id,
      parts: parts.map((part) => ({
        amount: formatNumber(part.amount),
        key: part.id,
      })),
      remove: false,
      serviceId: item.service_id ?? "",
      staffId: item.assigned_staff_id ?? "",
    };
  });
}

function getInitialStaffTips(ticket: PosTicketWithRelations, totalTipAmount: number) {
  const tipsByStaffId = new Map<string, number>();

  for (const earning of ticket.staff_earnings ?? []) {
    tipsByStaffId.set(earning.staff_id, earning.tip_amount);
  }

  if (tipsByStaffId.size > 0 || totalTipAmount <= 0) {
    return tipsByStaffId;
  }

  const serviceTotalsByStaffId = new Map<string, number>();

  for (const item of ticket.ticket_items ?? []) {
    if (!item.assigned_staff_id) {
      continue;
    }

    const itemTotalCents =
      item.turn_parts && item.turn_parts.length > 0
        ? item.turn_parts.reduce((total, part) => total + safeCents(part.amount), 0)
        : safeCents(item.line_total);

    serviceTotalsByStaffId.set(
      item.assigned_staff_id,
      (serviceTotalsByStaffId.get(item.assigned_staff_id) ?? 0) + itemTotalCents,
    );
  }

  for (const [staffId, tipCents] of allocateTipCentsByStaff(
    serviceTotalsByStaffId,
    safeCents(totalTipAmount),
  )) {
    tipsByStaffId.set(staffId, fromCents(tipCents));
  }

  return tipsByStaffId;
}

function getInitialManualStaffTips(ticket: PosTicketWithRelations) {
  const tipsByStaffId = new Map<string, number>();

  for (const earning of ticket.staff_earnings ?? []) {
    if (!earning.tip_is_manual) {
      continue;
    }

    tipsByStaffId.set(
      earning.staff_id,
      earning.manual_tip_amount ?? earning.tip_amount,
    );
  }

  return tipsByStaffId;
}

function SaveButton({
  canApplyFinancialCorrection,
  canSave,
  isCorrectionMode,
  onCorrectionIntentChange,
}: {
  canApplyFinancialCorrection: boolean;
  canSave: boolean;
  isCorrectionMode: boolean;
  onCorrectionIntentChange: (intent: "apply" | "request") => void;
}) {
  const { pending } = useFormStatus();

  if (isCorrectionMode) {
    return (
      <>
        {canApplyFinancialCorrection ? (
          <button
            className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
            disabled={!canSave || pending}
            formAction={submitLockedStaffFinancialCorrection}
            onClick={() => onCorrectionIntentChange("request")}
            type="submit"
          >
            {pending ? "Submitting..." : "Submit Correction Request"}
          </button>
        ) : null}
        <button
          className="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
          disabled={!canSave || pending}
          formAction={submitLockedStaffFinancialCorrection}
          onClick={() =>
            onCorrectionIntentChange(
              canApplyFinancialCorrection ? "apply" : "request",
            )
          }
          type="submit"
        >
          {pending
            ? canApplyFinancialCorrection
              ? "Applying..."
              : "Submitting..."
            : canApplyFinancialCorrection
              ? "Apply Correction"
              : "Submit Correction Request"}
        </button>
      </>
    );
  }

  return (
    <button
      className="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
      disabled={!canSave || pending}
      formAction={correctClosedPosTicketInline}
      type="submit"
    >
      {pending ? "Saving..." : "Save Correction"}
    </button>
  );
}

function PickerPopover({
  items,
  onSelect,
}: {
  items: Array<{ disabled?: boolean; id: string; label: string }>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="absolute left-0 top-full z-20 mt-1 max-h-56 min-w-52 overflow-auto rounded border border-zinc-200 bg-white py-1 shadow-lg">
      {items.map((item) => (
        <button
          className="block w-full px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-white"
          disabled={item.disabled}
          key={item.id}
          onClick={() => onSelect(item.id)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function InlineMoney({
  className = "",
  disabled,
  isEditing,
  onChange,
  onDone,
  onStart,
  prefix = "",
  value,
}: {
  className?: string;
  disabled?: boolean;
  isEditing: boolean;
  onChange: (value: string) => void;
  onDone: () => void;
  onStart: () => void;
  prefix?: string;
  value: string;
}) {
  if (isEditing) {
    return (
      <input
        autoFocus
        className={`h-7 w-24 rounded border border-zinc-300 px-2 text-sm font-medium text-zinc-950 ${className}`}
        min="0"
        onBlur={onDone}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        step="0.01"
        type="number"
        value={value}
      />
    );
  }

  return (
    <button
      className={`rounded px-1 py-0.5 text-left font-medium text-zinc-950 hover:bg-zinc-100 disabled:hover:bg-transparent ${className}`}
      disabled={disabled}
      onClick={onStart}
      type="button"
    >
      {prefix}
      {formatMoney(toMoneyNumber(value))}
    </button>
  );
}

type SnapshotRecord = Record<string, unknown>;

type SnapshotItem = {
  assigned_staff?: { display_name?: string | null } | null;
  assigned_staff_id?: string | null;
  id?: string;
  is_removed?: boolean;
  line_total?: number;
  service?: { name?: string | null } | null;
  service_id?: string | null;
  turn_parts?: Array<{
    amount?: number;
    id?: string;
    turn_index?: number;
  }> | null;
};

type SnapshotTicket = {
  discount_type?: "fixed_amount" | "percentage";
  discount_value?: number;
  tax_rate?: number;
  ticket_items?: SnapshotItem[] | null;
  tip_type?: "fixed_amount" | "percentage";
  tip_value?: number;
};

type SnapshotEarning = {
  manual_tip_amount?: number | null;
  staff_id?: string;
  tip_amount?: number;
  tip_is_manual?: boolean;
};

function asRecord(value: unknown): SnapshotRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SnapshotRecord)
    : null;
}

function readSnapshot(snapshot: unknown) {
  const root = asRecord(snapshot);
  const ticket = asRecord(root?.ticket) as SnapshotTicket | null;
  const earnings = Array.isArray(root?.earnings)
    ? (root.earnings as SnapshotEarning[])
    : [];

  return { earnings, ticket };
}

function readRecordNumber(record: SnapshotRecord | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function correctionTypeLabel(value: unknown) {
  switch (value) {
    case "staff_service_amount":
      return "Staff service amount";
    case "staff_tip":
      return "Staff tip";
    case "staff_turn_count":
      return "Staff turn count";
    case "ticket_staff_assignment":
      return "Ticket staff assignment";
    case "ticket_service":
      return "Ticket service";
    case "ticket_amount":
      return "Ticket amount";
    case "ticket_tip":
      return "Ticket tip";
    case "ticket_discount":
      return "Ticket discount";
    case "void_ticket":
      return "Void ticket";
    default:
      return "Correction";
  }
}

function correctionValueSummary(
  correctionType: unknown,
  oldValue: SnapshotRecord | null,
  requestedValue: SnapshotRecord | null,
) {
  if (correctionType === "staff_service_amount") {
    const oldAmount = readRecordNumber(oldValue, "serviceAmount");
    const requestedAmount = readRecordNumber(requestedValue, "serviceAmount");

    if (oldAmount !== null && requestedAmount !== null) {
      return `${formatMoney(oldAmount)} -> ${formatMoney(requestedAmount)}`;
    }
  }

  if (correctionType === "staff_tip") {
    const oldAmount = readRecordNumber(oldValue, "tipAmount");
    const requestedAmount = readRecordNumber(requestedValue, "tipAmount");

    if (oldAmount !== null && requestedAmount !== null) {
      return `${formatMoney(oldAmount)} -> ${formatMoney(requestedAmount)}`;
    }
  }

  if (correctionType === "staff_turn_count") {
    const oldTurns = readRecordNumber(oldValue, "turnCount");
    const requestedTurns = readRecordNumber(requestedValue, "turnCount");

    if (oldTurns !== null && requestedTurns !== null) {
      return `${oldTurns} -> ${requestedTurns}`;
    }
  }

  if (correctionType === "ticket_staff_assignment") {
    const requestedAssignments = requestedValue?.assignments;
    const assignments = Array.isArray(requestedAssignments)
      ? requestedAssignments
      : [];

    if (assignments.length > 0) {
      return `${assignments.length} staff assignment${
        assignments.length === 1 ? "" : "s"
      } recorded`;
    }
  }

  if (correctionType === "ticket_service") {
    const requestedServiceChanges = requestedValue?.serviceChanges;
    const serviceChanges = Array.isArray(requestedServiceChanges)
      ? requestedServiceChanges
      : [];

    if (serviceChanges.length > 0) {
      return `${serviceChanges.length} service change${
        serviceChanges.length === 1 ? "" : "s"
      } recorded`;
    }
  }

  return "recorded in financial audit log";
}

function buildFinancialCorrectionSummary(snapshot: unknown) {
  const root = asRecord(snapshot);
  const financialCorrection = asRecord(root?.financial_correction);
  const corrections = Array.isArray(financialCorrection?.corrections)
    ? financialCorrection.corrections
    : [];

  if (corrections.length === 0) {
    return [];
  }

  return corrections.map((correction) => {
    const row = asRecord(correction);
    const oldValue = asRecord(row?.oldValue);
    const requestedValue = asRecord(row?.requestedValue);
    const correctionType = row?.correctionType;

    return `${correctionTypeLabel(correctionType)} ${correctionValueSummary(
      correctionType,
      oldValue,
      requestedValue,
    )}`;
  });
}

function activeSnapshotItems(ticket: SnapshotTicket | null) {
  return (ticket?.ticket_items ?? []).filter((item) => !item.is_removed);
}

function snapshotParts(item: SnapshotItem) {
  const parts = [...(item.turn_parts ?? [])]
    .sort(
      (left, right) =>
        (left.turn_index ?? 0) - (right.turn_index ?? 0) ||
        (left.id ?? "").localeCompare(right.id ?? ""),
    )
    .map((part) => Number(part.amount))
    .filter((amount) => Number.isFinite(amount) && amount > 0);

  return parts.length > 0 ? parts : [Number(item.line_total ?? 0)];
}

function snapshotLineTotal(item: SnapshotItem) {
  return snapshotParts(item).reduce((total, amount) => total + amount, 0);
}

function snapshotStaffName(item: SnapshotItem) {
  return item.assigned_staff?.display_name ?? item.assigned_staff_id ?? "Unassigned";
}

function snapshotServiceName(item: SnapshotItem) {
  return item.service?.name ?? item.service_id ?? "No service";
}

function formatParts(parts: number[]) {
  return parts.map((amount) => formatMoney(amount)).join(" / ");
}

function sameParts(left: SnapshotItem, right: SnapshotItem) {
  const leftParts = snapshotParts(left);
  const rightParts = snapshotParts(right);

  return (
    leftParts.length === rightParts.length &&
    leftParts.every((amount, index) => safeCents(amount) === safeCents(rightParts[index] ?? 0))
  );
}

function findSingleAddedPart(beforeParts: number[], afterParts: number[]) {
  if (afterParts.length !== beforeParts.length + 1) {
    return null;
  }

  const remainingCents = afterParts.map(safeCents);

  for (const beforePart of beforeParts) {
    const index = remainingCents.indexOf(safeCents(beforePart));

    if (index === -1) {
      return null;
    }

    remainingCents.splice(index, 1);
  }

  return remainingCents.length === 1 ? fromCents(remainingCents[0]) : null;
}

function findSingleRemovedPart(beforeParts: number[], afterParts: number[]) {
  if (beforeParts.length !== afterParts.length + 1) {
    return null;
  }

  return findSingleAddedPart(afterParts, beforeParts);
}

function partChangeSummary(staffName: string, beforeItem: SnapshotItem, afterItem: SnapshotItem) {
  const beforeParts = snapshotParts(beforeItem);
  const afterParts = snapshotParts(afterItem);
  const addedPart = findSingleAddedPart(beforeParts, afterParts);

  if (addedPart !== null) {
    return `${staffName} part +${formatMoney(addedPart)}`;
  }

  const removedPart = findSingleRemovedPart(beforeParts, afterParts);

  if (removedPart !== null) {
    return `${staffName} part -${formatMoney(removedPart)}`;
  }

  if (beforeParts.length === afterParts.length) {
    const changedIndexes = beforeParts
      .map((amount, index) =>
        safeCents(amount) === safeCents(afterParts[index] ?? 0) ? -1 : index,
      )
      .filter((index) => index >= 0);

    if (changedIndexes.length === 1) {
      const index = changedIndexes[0];

      return `${staffName} part ${formatMoney(beforeParts[index])} -> ${formatMoney(
        afterParts[index] ?? 0,
      )}`;
    }
  }

  return `${staffName} parts updated ${formatParts(beforeParts)} -> ${formatParts(afterParts)}`;
}

function snapshotTipAmount(ticket: SnapshotTicket | null) {
  if (!ticket) {
    return 0;
  }

  return calculateTicketTotals({
    discountType: ticket.discount_type ?? "fixed_amount",
    discountValue: ticket.discount_value ?? 0,
    items: activeSnapshotItems(ticket).map((item) => ({
      line_total: snapshotLineTotal(item),
    })),
    taxRate: ticket.tax_rate ?? 0,
    tipType: ticket.tip_type ?? "fixed_amount",
    tipValue: ticket.tip_value ?? 0,
  }).tip_amount;
}

function staffNamesById(...tickets: Array<SnapshotTicket | null>) {
  const names = new Map<string, string>();

  for (const ticket of tickets) {
    for (const item of ticket?.ticket_items ?? []) {
      if (item.assigned_staff_id) {
        names.set(item.assigned_staff_id, snapshotStaffName(item));
      }
    }
  }

  return names;
}

function isManualTipEarning(earning: SnapshotEarning | undefined) {
  return Boolean(
    earning?.tip_is_manual ||
      (earning?.manual_tip_amount !== null && earning?.manual_tip_amount !== undefined),
  );
}

function getFinancialCorrectionRecord(snapshot: unknown) {
  const root = asRecord(snapshot);
  return asRecord(root?.financial_correction);
}

function historyKind(adjustment: TicketHistoryAdjustment) {
  const financialCorrection = getFinancialCorrectionRecord(adjustment.after_snapshot);

  if (!financialCorrection) {
    return "direct" as const;
  }

  return financialCorrection.intent === "apply" ? ("applied" as const) : ("pending" as const);
}

function historyBadgeLabel(kind: ReturnType<typeof historyKind>) {
  if (kind === "applied") {
    return "Applied Correction";
  }

  if (kind === "pending") {
    return "Pending Correction";
  }

  return "Direct Edit";
}

function historySummaryLabel(kind: ReturnType<typeof historyKind>) {
  return kind === "pending" ? "Requested" : "Changed";
}

function buildCorrectionChangeSummary(beforeSnapshot: unknown, afterSnapshot: unknown) {
  const financialSummary = buildFinancialCorrectionSummary(afterSnapshot);

  if (financialSummary.length > 0) {
    return financialSummary;
  }

  const before = readSnapshot(beforeSnapshot);
  const after = readSnapshot(afterSnapshot);
  const beforeTicket = before.ticket;
  const afterTicket = after.ticket;

  if (!beforeTicket || !afterTicket) {
    return ["Details captured in audit snapshot."];
  }

  const lines: string[] = [];
  const partsChangedItemIds = new Set<string | undefined>();
  const beforeItems = activeSnapshotItems(beforeTicket);
  const afterItems = activeSnapshotItems(afterTicket);
  const beforeById = new Map(beforeItems.map((item) => [item.id, item]));
  const afterById = new Map(afterItems.map((item) => [item.id, item]));
  const removedItems = beforeItems.filter((item) => item.id && !afterById.has(item.id));
  const addedItems = afterItems.filter((item) => item.id && !beforeById.has(item.id));
  const pairedAddedIds = new Set<string | undefined>();
  const pairedRemovedIds = new Set<string | undefined>();

  for (const removed of removedItems) {
    const added = addedItems.find(
      (candidate) =>
        !pairedAddedIds.has(candidate.id) &&
        candidate.assigned_staff_id === removed.assigned_staff_id,
    );

    if (!added) {
      continue;
    }

    pairedAddedIds.add(added.id);
    pairedRemovedIds.add(removed.id);

    if (removed.service_id !== added.service_id) {
      lines.push(
        `${snapshotStaffName(added)} service ${snapshotServiceName(
          removed,
        )} -> ${snapshotServiceName(added)}`,
      );
    }

    if (!sameParts(removed, added)) {
      partsChangedItemIds.add(removed.id);
      partsChangedItemIds.add(added.id);
      lines.push(partChangeSummary(snapshotStaffName(added), removed, added));
    }
  }

  for (const item of addedItems.filter((item) => !pairedAddedIds.has(item.id))) {
    lines.push(
      `Added: ${snapshotStaffName(item)} / ${snapshotServiceName(item)} / ${formatParts(
        snapshotParts(item),
      )}`,
    );
  }

  for (const item of removedItems.filter((item) => !pairedRemovedIds.has(item.id))) {
    lines.push(
      `Removed: ${snapshotStaffName(item)} / ${snapshotServiceName(item)} / ${formatParts(
        snapshotParts(item),
      )}`,
    );
  }

  for (const beforeItem of beforeItems) {
    if (!beforeItem.id) {
      continue;
    }

    const afterItem = afterById.get(beforeItem.id);

    if (!afterItem) {
      continue;
    }

    if (beforeItem.assigned_staff_id !== afterItem.assigned_staff_id) {
      lines.push(
        `Staff ${snapshotStaffName(beforeItem)} -> ${snapshotStaffName(afterItem)}`,
      );
    }

    if (beforeItem.service_id !== afterItem.service_id) {
      lines.push(
        `${snapshotStaffName(afterItem)} service ${snapshotServiceName(
          beforeItem,
        )} -> ${snapshotServiceName(afterItem)}`,
      );
    }

    if (!sameParts(beforeItem, afterItem)) {
      partsChangedItemIds.add(beforeItem.id);
      lines.push(partChangeSummary(snapshotStaffName(afterItem), beforeItem, afterItem));
    }

    if (
      !partsChangedItemIds.has(beforeItem.id) &&
      safeCents(snapshotLineTotal(beforeItem)) !== safeCents(snapshotLineTotal(afterItem))
    ) {
      lines.push(
        `${snapshotStaffName(afterItem)} / ${snapshotServiceName(
          afterItem,
        )} total ${formatMoney(snapshotLineTotal(beforeItem))} -> ${formatMoney(
          snapshotLineTotal(afterItem),
        )}`,
      );
    }
  }

  const beforeTip = snapshotTipAmount(beforeTicket);
  const afterTip = snapshotTipAmount(afterTicket);

  if (safeCents(beforeTip) !== safeCents(afterTip)) {
    lines.push(`Ticket tip ${formatMoney(beforeTip)} -> ${formatMoney(afterTip)}`);
  }

  const namesByStaffId = staffNamesById(beforeTicket, afterTicket);
  const beforeEarningsByStaffId = new Map(
    before.earnings
      .filter((earning) => earning.staff_id)
      .map((earning) => [earning.staff_id as string, earning]),
  );

  for (const earning of after.earnings) {
    if (!earning.staff_id) {
      continue;
    }

    const previousEarning = beforeEarningsByStaffId.get(earning.staff_id);
    const previousTip = previousEarning?.tip_amount ?? 0;
    const nextTip = earning.tip_amount ?? 0;

    if (
      (isManualTipEarning(previousEarning) || isManualTipEarning(earning)) &&
      safeCents(previousTip) !== safeCents(nextTip)
    ) {
      lines.push(
        `${namesByStaffId.get(earning.staff_id) ?? earning.staff_id} tip ${formatMoney(
          previousTip,
        )} -> ${formatMoney(nextTip)}`,
      );
    }
  }

  return lines.length > 0
    ? lines
    : ["Details captured in audit snapshot."];
}

export function DailyPosTicketCard({
  businessDateCompactLabel,
  canApplyFinancialCorrection,
  canEdit,
  dailyNumber,
  isBusinessDateLocked,
  returnTo,
  services,
  staff,
  ticket,
}: DailyPosTicketCardProps) {
  const initialLines = useMemo(() => getInitialLines(ticket), [ticket]);
  const initialLineByKey = useMemo(
    () => new Map(initialLines.map((line) => [line.key, line])),
    [initialLines],
  );
  const servicesById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );
  const staffById = useMemo(
    () => new Map(staff.map((member) => [member.id, member])),
    [staff],
  );
  const originalItemByKey = useMemo(
    () => new Map((ticket.ticket_items ?? []).map((item) => [item.id, item])),
    [ticket.ticket_items],
  );
  const initialTotals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items: initialLines.map((line) => ({ line_total: lineTotal(line) })),
    taxRate: ticket.tax_rate,
    tipType: ticket.tip_type,
    tipValue: ticket.tip_value,
  });
  const initialStaffTipById = useMemo(
    () => getInitialStaffTips(ticket, initialTotals.tip_amount),
    [initialTotals.tip_amount, ticket],
  );
  const initialManualStaffTipById = useMemo(
    () => getInitialManualStaffTips(ticket),
    [ticket],
  );
  const [isEditing, setIsEditing] = useState(false);
  const [isCorrectionMode, setIsCorrectionMode] = useState(false);
  const [showLockedConfirmation, setShowLockedConfirmation] = useState(false);
  const [selectorTarget, setSelectorTarget] = useState<SelectorTarget>(null);
  const [moneyTarget, setMoneyTarget] = useState<MoneyTarget>(null);
  const [lines, setLines] = useState<EditableLine[]>(initialLines);
  const [tipTotal, setTipTotal] = useState(formatNumber(initialTotals.tip_amount));
  const [staffTipDrafts, setStaffTipDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const nextKeyRef = useRef(0);
  const correctionIntentRef = useRef<HTMLInputElement>(null);
  const canCorrectClosedTicket = canEdit && ticket.status === "closed";
  const displayedLines = isEditing ? lines : initialLines;
  const activeLines = lines.filter((line) => !line.remove);
  const totalTipAmount = toMoneyNumber(tipTotal);
  const safeTotalTipCents = safeCents(tipTotal);
  const initialTotalTipCents = safeCents(initialTotals.tip_amount);
  const hasTipChange = safeTotalTipCents !== initialTotalTipCents;
  const staffServiceTotalCents = new Map<string, number>();

  for (const line of activeLines) {
    if (!line.staffId) {
      continue;
    }

    staffServiceTotalCents.set(
      line.staffId,
      (staffServiceTotalCents.get(line.staffId) ?? 0) + lineTotalCents(line),
    );
  }

  const staffIdsInActiveLines = activeLines
    .map((line) => line.staffId)
    .filter(Boolean);
  const duplicateStaff = staffIdsInActiveLines.some(
    (staffId, index) => staffIdsInActiveLines.indexOf(staffId) !== index,
  );
  const staffIdSet = new Set(staffIdsInActiveLines);
  const submittedManualStaffTipCentsById = new Map(
    Object.entries(staffTipDrafts)
      .filter(([staffId]) => staffIdSet.has(staffId))
      .map(([staffId, value]) => [staffId, Math.max(0, safeCents(value))]),
  );
  const existingManualStaffTipCentsById = new Map(
    Array.from(initialManualStaffTipById.entries())
      .filter(([staffId]) => staffIdSet.has(staffId))
      .map(([staffId, value]) => [staffId, Math.max(0, safeCents(value))]),
  );
  const effectiveManualStaffTipCentsById = new Map(
    hasTipChange ? [] : existingManualStaffTipCentsById,
  );

  for (const [staffId, tipCents] of submittedManualStaffTipCentsById) {
    effectiveManualStaffTipCentsById.set(staffId, tipCents);
  }

  const submittedManualStaffIds = new Set(submittedManualStaffTipCentsById.keys());
  const effectiveManualStaffIds = new Set(effectiveManualStaffTipCentsById.keys());
  const effectiveManualStaffTipCents = Array.from(
    effectiveManualStaffTipCentsById.values(),
  ).reduce(
    (total, tipCents) => total + tipCents,
    0,
  );
  const staffTipCentsById = allocateTipCentsByStaff(
    staffServiceTotalCents,
    safeTotalTipCents,
    effectiveManualStaffTipCentsById,
  );
  const staffSummaries = Array.from(staffServiceTotalCents.keys());
  const finalItemsForTotals = activeLines.map((line) => ({
    line_total: lineTotal(line),
  }));
  const editedTotals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items: finalItemsForTotals,
    taxRate: ticket.tax_rate,
    tipType: "fixed_amount",
    tipValue: totalTipAmount,
  });
  const editedItems = lines
    .filter((line) => {
      const initial = initialLineByKey.get(line.key);

      if (!initial || !line.itemId) {
        return false;
      }

      return (
        line.remove ||
        line.serviceId !== initial.serviceId ||
        line.staffId !== initial.staffId ||
        line.parts.length !== initial.parts.length ||
        line.parts.some(
          (part, index) => !centsEqual(part.amount, initial.parts[index]?.amount ?? 0),
        )
      );
    })
    .map((line) => ({
      item_id: line.itemId,
      parts: line.parts.map((part) => ({ amount: part.amount })),
      remove: line.remove,
      service_id: line.serviceId || null,
      staff_id: line.staffId || null,
    }));
  const addedItems = lines
    .filter((line) => !line.itemId && !line.remove)
    .map((line) => ({
      parts: line.parts.map((part) => ({ amount: part.amount })),
      service_id: line.serviceId,
      staff_id: line.staffId,
    }));
  const itemPartsPayload = activeLines
    .filter((line) => line.itemId)
    .map((line) => ({
      item_id: line.itemId,
      parts: line.parts.map((part) => ({ amount: part.amount })),
    }));
  const staffTipOverrides = staffSummaries
    .map((staffId) => {
      const isSubmittedManual = submittedManualStaffIds.has(staffId);

      if (isSubmittedManual) {
        return {
          is_manual: true,
          staff_id: staffId,
          tip_amount: fromCents(submittedManualStaffTipCentsById.get(staffId) ?? 0),
        };
      }

      if (hasTipChange) {
        return {
          is_manual: false,
          staff_id: staffId,
          tip_amount: 0,
        };
      }

      return null;
    })
    .filter((override): override is NonNullable<typeof override> => Boolean(override));
  const hasManualTipChange = Object.entries(staffTipDrafts).some(([staffId, value]) => {
    if (!staffIdSet.has(staffId)) {
      return false;
    }

    return safeCents(value) !== safeCents(initialStaffTipById.get(staffId) ?? 0);
  });
  const invalidTipTotal = !Number.isFinite(totalTipAmount) || safeTotalTipCents < 0;
  const invalidAddedLine = addedItems.some(
    (line) =>
      !line.service_id ||
      !line.staff_id ||
      line.parts.length === 0 ||
      line.parts.some(
        (part) => !Number.isFinite(Number(part.amount)) || Number(part.amount) <= 0,
      ),
  );
  const invalidExistingLine = activeLines.some(
    (line) =>
      !line.serviceId ||
      !line.staffId ||
      line.parts.length === 0 ||
      line.parts.some((part) => safeCents(part.amount) <= 0) ||
      lineTotalCents(line) <= 0,
  );
  const allStaffTipsManual =
    staffSummaries.length > 0 && effectiveManualStaffIds.size === staffSummaries.length;
  const manualTipsTooHigh = effectiveManualStaffTipCents > safeTotalTipCents;
  const manualTipsMismatch =
    allStaffTipsManual && effectiveManualStaffTipCents !== safeTotalTipCents;
  const hasChange =
    editedItems.length > 0 ||
    addedItems.length > 0 ||
    hasTipChange ||
    hasManualTipChange;
  const canSave =
    reason.trim().length > 0 &&
    hasChange &&
    !invalidTipTotal &&
    !invalidAddedLine &&
    !invalidExistingLine &&
    !duplicateStaff &&
    !manualTipsTooHigh &&
    !manualTipsMismatch;

  function updateLine(key: string, patch: Partial<EditableLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function updatePart(lineKey: string, partKey: string, amount: string) {
    setLines((current) =>
      current.map((line) =>
        line.key === lineKey
          ? {
              ...line,
              parts: line.parts.map((part) =>
                part.key === partKey ? { ...part, amount } : part,
              ),
            }
          : line,
      ),
    );
  }

  function addPart(line: EditableLine) {
    nextKeyRef.current += 1;
    updateLine(line.key, {
      parts: [
        ...line.parts,
        {
          amount: "0",
          key: `part-${nextKeyRef.current}`,
        },
      ],
    });
  }

  function removePart(line: EditableLine, partKey: string) {
    if (line.parts.length <= 1) {
      return;
    }

    updateLine(line.key, {
      parts: line.parts.filter((part) => part.key !== partKey),
    });
  }

  function removeLine(line: EditableLine) {
    setSelectorTarget(null);
    setMoneyTarget(null);

    if (!line.itemId) {
      setLines((current) => current.filter((currentLine) => currentLine.key !== line.key));
      return;
    }

    updateLine(line.key, { remove: !line.remove });
  }

  function addLine() {
    nextKeyRef.current += 1;
    const lineKey = `new-${nextKeyRef.current}`;
    nextKeyRef.current += 1;

    setLines((current) => [
      ...current,
      {
        itemId: null,
        key: lineKey,
        parts: [{ amount: "0", key: `new-part-${nextKeyRef.current}` }],
        remove: false,
        serviceId: "",
        staffId: "",
      },
    ]);
  }

  function resetEdit() {
    setLines(initialLines);
    setTipTotal(formatNumber(initialTotals.tip_amount));
    setStaffTipDrafts({});
    setReason("");
    setSelectorTarget(null);
    setMoneyTarget(null);
    setIsEditing(false);
    setIsCorrectionMode(false);
    setShowLockedConfirmation(false);
  }

  function startEdit() {
    if (!isBusinessDateLocked) {
      setIsCorrectionMode(false);
      setIsEditing(true);
      return;
    }

    setShowLockedConfirmation(true);
  }

  function continueLockedCorrection() {
    setShowLockedConfirmation(false);
    setIsCorrectionMode(true);
    setIsEditing(true);
    setCorrectionIntent(canApplyFinancialCorrection ? "apply" : "request");
  }

  function setCorrectionIntent(intent: "apply" | "request") {
    if (correctionIntentRef.current) {
      correctionIntentRef.current.value = intent;
    }
  }

  function finishMoneyEdit() {
    if (moneyTarget?.kind === "part") {
      const line = lines.find((currentLine) => currentLine.key === moneyTarget.lineKey);
      const part = line?.parts.find((currentPart) => currentPart.key === moneyTarget.partKey);

      if (line && part) {
        updatePart(line.key, part.key, normalizeMoneyInput(part.amount));
      }
    }

    if (moneyTarget?.kind === "staffTip") {
      const staffId = moneyTarget.staffId;

      setStaffTipDrafts((current) => ({
        ...current,
        [staffId]: normalizeMoneyInput(
          current[staffId] ??
            formatNumber(fromCents(staffTipCentsById.get(staffId) ?? 0)),
        ),
      }));
    }

    if (moneyTarget?.kind === "totalTip") {
      setTipTotal((current) => normalizeMoneyInput(current));
    }

    setMoneyTarget(null);
  }

  function serviceName(line: EditableLine) {
    return (
      servicesById.get(line.serviceId)?.name ??
      originalItemByKey.get(line.key)?.service?.name ??
      "Select service"
    );
  }

  function staffDisplayName(line: EditableLine) {
    return (
      staffById.get(line.staffId)?.display_name ??
      originalItemByKey.get(line.key)?.assigned_staff?.display_name ??
      "Select staff"
    );
  }

  function renderTurnDisplay(line: EditableLine) {
    const display = line.itemId
      ? originalItemByKey.get(line.itemId)?.running_turns
      : null;

    if (!display) {
      return (
        <span className="ml-2 shrink-0 text-xs font-medium text-zinc-400">
          - | -
        </span>
      );
    }

    return (
      <span className="ml-2 shrink-0 text-xs text-zinc-400">
        <span className="font-bold text-zinc-950">{display.big ?? "-"}</span>
        <span className="px-1 text-zinc-300">|</span>
        <span className="font-medium text-zinc-500">{display.small ?? "-"}</span>
      </span>
    );
  }

  function setStaffTip(staffId: string, value: string) {
    setStaffTipDrafts((current) => ({
      ...current,
      [staffId]: value,
    }));
  }

  function updateTotalTip(value: string) {
    setTipTotal(value);
    setStaffTipDrafts({});
  }

  function startTotalTipEdit() {
    if (!canCorrectClosedTicket || !isEditing) {
      return;
    }

    setSelectorTarget(null);
    setMoneyTarget({ kind: "totalTip" });
  }

  function startStaffTipEdit(staffId: string) {
    if (!canCorrectClosedTicket || !isEditing) {
      return;
    }

    setSelectorTarget(null);
    setMoneyTarget({ kind: "staffTip", staffId });
  }

  function staffOptionsForLine(line: EditableLine) {
    const usedByOtherLines = new Set(
      activeLines
        .filter((currentLine) => currentLine.key !== line.key)
        .map((currentLine) => currentLine.staffId)
        .filter(Boolean),
    );

    return staff.map((member) => ({
      disabled: usedByOtherLines.has(member.id),
      id: member.id,
      label: member.display_name,
    }));
  }

  function renderStaffSelector(line: EditableLine) {
    const isOpen =
      selectorTarget?.field === "staff" && selectorTarget.lineKey === line.key;
    const isPlaceholder = !line.staffId;

    return (
      <span className="relative min-w-0">
        <span className="inline-flex max-w-full items-center">
          <button
            className={`min-w-0 max-w-full truncate rounded px-1 py-0.5 text-left font-semibold hover:bg-zinc-100 disabled:hover:bg-transparent ${
              isPlaceholder ? "text-zinc-500" : "text-zinc-950"
            }`}
            disabled={!isEditing || line.remove}
            onClick={() =>
              setSelectorTarget(isOpen ? null : { field: "staff", lineKey: line.key })
            }
            type="button"
          >
            {staffDisplayName(line)}
          </button>
          {renderTurnDisplay(line)}
        </span>
        {isOpen ? (
          <PickerPopover
            items={staffOptionsForLine(line)}
            onSelect={(id) => {
              updateLine(line.key, { staffId: id });
              setStaffTipDrafts((current) => {
                const next = { ...current };
                delete next[line.staffId];
                delete next[id];
                return next;
              });
              setSelectorTarget(null);
            }}
          />
        ) : null}
      </span>
    );
  }

  function renderServiceSelector(line: EditableLine) {
    const isOpen =
      selectorTarget?.field === "service" && selectorTarget.lineKey === line.key;
    const isPlaceholder = !line.serviceId;

    return (
      <span className="relative min-w-0">
        <button
          className={`max-w-full truncate rounded px-1 py-0.5 text-left hover:bg-zinc-100 disabled:hover:bg-transparent ${
            isPlaceholder ? "text-zinc-500" : "text-zinc-800"
          }`}
          disabled={!isEditing || line.remove}
          onClick={() =>
            setSelectorTarget(isOpen ? null : { field: "service", lineKey: line.key })
          }
          type="button"
        >
          {serviceName(line)}
        </button>
        {isOpen ? (
          <PickerPopover
            items={services.map((service) => ({ id: service.id, label: service.name }))}
            onSelect={(id) => {
              updateLine(line.key, { serviceId: id });
              setSelectorTarget(null);
            }}
          />
        ) : null}
      </span>
    );
  }

  function renderParts(line: EditableLine) {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
        {line.parts.map((part, index) => {
          const isPartEditing =
            moneyTarget?.kind === "part" &&
            moneyTarget.lineKey === line.key &&
            moneyTarget.partKey === part.key;

          return (
            <span className="inline-flex items-center gap-1" key={part.key}>
              {index > 0 ? <span className="text-zinc-400">/</span> : null}
              <InlineMoney
                disabled={!isEditing || line.remove}
                isEditing={isPartEditing}
                onChange={(value) => updatePart(line.key, part.key, value)}
                onDone={finishMoneyEdit}
                onStart={() => {
                  setSelectorTarget(null);
                  setMoneyTarget({
                    kind: "part",
                    lineKey: line.key,
                    partKey: part.key,
                  });
                }}
                value={part.amount}
              />
              {isEditing && !line.remove && line.parts.length > 1 ? (
                <button
                  className="rounded px-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-red-700"
                  onClick={() => removePart(line, part.key)}
                  type="button"
                >
                  x
                </button>
              ) : null}
            </span>
          );
        })}
        {isEditing && !line.remove ? (
          <button
            className="rounded border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            onClick={() => addPart(line)}
            type="button"
          >
            + Part
          </button>
        ) : null}
      </span>
    );
  }

  function renderLine(line: EditableLine) {
    const staffTipCents = line.staffId ? staffTipCentsById.get(line.staffId) ?? 0 : 0;
    const staffTipInput = line.staffId
      ? staffTipDrafts[line.staffId] ?? formatNumber(fromCents(staffTipCents))
      : "0";
    const isStaffTipEditing =
      line.staffId &&
      moneyTarget?.kind === "staffTip" &&
      moneyTarget.staffId === line.staffId;

    return (
      <div
        className={`grid items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(120px,0.9fr)_minmax(160px,1fr)_minmax(180px,1.4fr)_110px_110px_64px] ${
          line.remove ? "bg-red-50/50 text-zinc-400" : "bg-white"
        }`}
        key={line.key}
      >
        {isEditing ? (
          renderStaffSelector(line)
        ) : (
          <span className="flex min-w-0 items-center">
            <span className="min-w-0 truncate font-semibold text-zinc-950">
              {staffDisplayName(line)}
            </span>
            {renderTurnDisplay(line)}
          </span>
        )}
        {isEditing ? (
          renderServiceSelector(line)
        ) : (
          <span className="min-w-0 truncate text-zinc-700">{serviceName(line)}</span>
        )}
        {renderParts(line)}
        <span className="font-medium text-zinc-950">
          Total {formatMoney(lineTotal(line))}
        </span>
        {line.staffId ? (
          <InlineMoney
            disabled={!isEditing || line.remove}
            isEditing={Boolean(isStaffTipEditing)}
            onChange={(value) => setStaffTip(line.staffId, value)}
            onDone={finishMoneyEdit}
            onStart={() => startStaffTipEdit(line.staffId)}
            prefix="Tip "
            value={staffTipInput}
          />
        ) : (
          <span className="text-zinc-500">Tip $0.00</span>
        )}
        {isEditing ? (
          <button
            className="justify-self-start rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            onClick={() => removeLine(line)}
            type="button"
          >
            {line.remove ? "Undo" : "Remove"}
          </button>
        ) : null}
      </div>
    );
  }

  function renderCorrectionHistory() {
    const adjustments = ticket.adjustments ?? [];

    if (adjustments.length === 0) {
      return null;
    }

    return (
      <div className="border-t border-zinc-100 bg-zinc-50/60 px-3 py-2 text-xs text-zinc-600">
        <div className="font-semibold text-zinc-800">Correction History</div>
        <ul className="mt-1 space-y-1">
          {adjustments.map((adjustment) => {
            const kind = historyKind(adjustment);
            const isCorrection = kind !== "direct";
            const summary = buildCorrectionChangeSummary(
              adjustment.before_snapshot,
              adjustment.after_snapshot,
            );
            const summaryText =
              summary.length > 0
                ? summary.join("; ")
                : "Details captured in audit snapshot.";
            const actor =
              adjustment.created_by_user?.display_name ??
              adjustment.created_by_user?.email ??
              "Unknown";

            return (
              <li
                className={`leading-5 ${
                  isCorrection
                    ? "rounded bg-amber-50 px-2 py-1 text-amber-950"
                    : "text-zinc-600"
                }`}
                key={adjustment.id}
              >
                <span className="font-medium text-zinc-800">
                  {formatDateTime(adjustment.created_at)}
                </span>
                <span className="px-1 text-zinc-400">|</span>
                {isCorrection ? (
                  <>
                    <span className="font-semibold text-amber-900">
                      {historyBadgeLabel(kind)}
                    </span>
                    <span className="text-amber-900">
                      {" "}
                      for {businessDateCompactLabel}
                    </span>
                    <span className="px-1 text-amber-300">|</span>
                  </>
                ) : null}
                <span>{actor}</span>
                {adjustment.reason ? (
                  <>
                    <span className="px-1 text-zinc-400">|</span>
                    <span>
                      Reason:{" "}
                      <span className={isCorrection ? "text-amber-950" : "text-zinc-800"}>
                        {adjustment.reason}
                      </span>
                    </span>
                  </>
                ) : null}
                <span className="px-1 text-zinc-400">-</span>
                <span className={isCorrection ? "text-amber-950" : "text-zinc-700"}>
                  {historySummaryLabel(kind)}: {summaryText}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const headerTotals = isEditing ? editedTotals : initialTotals;
  const tipDisplay = isEditing ? tipTotal : formatNumber(initialTotals.tip_amount);
  const isTotalTipEditing = moneyTarget?.kind === "totalTip";

  return (
    <article className="border-b border-zinc-200 last:border-b-0">
      <form action={correctClosedPosTicketInline}>
        {isEditing ? (
          <>
            <input name="ticket_id" type="hidden" value={ticket.id} />
            <input name="return_to" type="hidden" value={returnTo} />
            <input name="tip_total" type="hidden" value={normalizeMoneyInput(tipTotal)} />
            <input name="item_updates" type="hidden" value={JSON.stringify(editedItems)} />
            <input name="item_parts" type="hidden" value={JSON.stringify(itemPartsPayload)} />
            <input name="added_items" type="hidden" value={JSON.stringify(addedItems)} />
            <input
              name="staff_tip_overrides"
              type="hidden"
              value={JSON.stringify(staffTipOverrides)}
            />
            {isCorrectionMode ? (
              <input
                defaultValue={
                  canApplyFinancialCorrection ? "apply" : "request"
                }
                name="correction_intent"
                ref={correctionIntentRef}
                type="hidden"
              />
            ) : null}
          </>
        ) : null}
        <div className="grid items-center gap-2 bg-zinc-50 px-3 py-2 text-sm sm:grid-cols-[48px_80px_minmax(150px,1fr)_110px_150px_130px_56px]">
          <span className="font-semibold text-zinc-950">#{dailyNumber}</span>
          <span className="text-zinc-700">{formatTime(ticket.opened_at)}</span>
          <span className="min-w-0 truncate font-medium text-zinc-950">
            {ticket.customer?.name ?? "Walk-in Customer"}
            {ticket.source_booking_id ? (
              <span className="ml-2 rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
                From appointment
              </span>
            ) : null}
          </span>
          <span className="text-zinc-700">
            Total:{" "}
            <span className="font-semibold text-zinc-950">
              {formatMoney(headerTotals.subtotal)}
            </span>
          </span>
          <span className="text-zinc-700">
            After Discount:{" "}
            <span className="font-semibold text-zinc-950">
              {formatMoney(headerTotals.taxable_amount)}
            </span>
          </span>
          <span className="text-zinc-700">
            Tip:{" "}
            <InlineMoney
              className="inline-block hover:underline hover:decoration-dotted"
              disabled={!isEditing}
              isEditing={isTotalTipEditing}
              onChange={updateTotalTip}
              onDone={finishMoneyEdit}
              onStart={startTotalTipEdit}
              value={tipDisplay}
            />
          </span>
          {!isEditing && canCorrectClosedTicket ? (
            <button
              className="justify-self-start rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-950 sm:justify-self-end"
              onClick={startEdit}
              type="button"
            >
              Edit
            </button>
          ) : null}
        </div>
        <div className="divide-y divide-zinc-100">
          {displayedLines.length === 0 ? (
            <div className="px-3 py-2 text-sm text-zinc-500">
              No services recorded.
            </div>
          ) : (
            displayedLines.map((line) => renderLine(line))
          )}
        </div>
        {renderCorrectionHistory()}
        {isEditing ? (
          <div className="border-t border-zinc-200 px-3 py-3">
            {isCorrectionMode ? (
              <div className="mb-3">
                <span className="inline-flex rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                  Correction Mode
                </span>
              </div>
            ) : null}
            <button
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-zinc-50"
              onClick={addLine}
              type="button"
            >
              + Add Staff Line
            </button>
            <div className="mt-3 grid gap-2 text-sm text-zinc-700 md:grid-cols-5">
              <span>Subtotal: {formatMoney(editedTotals.subtotal)}</span>
              <span>Discount: {formatMoney(editedTotals.discount_amount)}</span>
              <span>After Discount: {formatMoney(editedTotals.taxable_amount)}</span>
              <span>Tax: {formatMoney(editedTotals.tax_amount)}</span>
              <span>Total: {formatMoney(editedTotals.total)}</span>
            </div>
            <label className="mt-3 block text-sm font-medium text-zinc-700">
              Correction Reason
              <textarea
                className="mt-1 min-h-20 w-full rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-950"
                name="correction_reason"
                onChange={(event) => setReason(event.target.value)}
                required
                value={reason}
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                {duplicateStaff
                  ? "Each staff member can appear only once on a ticket."
                  : manualTipsTooHigh
                    ? "Manual staff tips cannot exceed total tip."
                    : manualTipsMismatch
                      ? "Manual staff tips must equal total tip when every staff tip is manual."
                      : invalidTipTotal
                        ? "Total tip must be zero or greater."
                        : invalidAddedLine
                          ? "Added lines require staff, service, and parts greater than 0."
                          : invalidExistingLine
                            ? "Active lines require staff, service, and positive parts."
                            : hasChange
                              ? "Ready to save correction."
                              : "Make a change to enable save."}
              </p>
              <div className="flex gap-2">
                <button
                  className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950"
                  onClick={resetEdit}
                  type="button"
                >
                  Cancel
                </button>
                <SaveButton
                  canApplyFinancialCorrection={canApplyFinancialCorrection}
                  canSave={canSave}
                  isCorrectionMode={isCorrectionMode}
                  onCorrectionIntentChange={setCorrectionIntent}
                />
              </div>
            </div>
          </div>
        ) : null}
      </form>
      {showLockedConfirmation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
          <div
            aria-modal="true"
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            role="dialog"
          >
            <h3 className="text-base font-semibold text-zinc-950">
              Locked Business Date
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-700">
              This business date is locked. Your changes will be recorded as a
              financial correction request instead of directly changing the
              original ticket.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950"
                onClick={() => setShowLockedConfirmation(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white"
                onClick={continueLockedCorrection}
                type="button"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
