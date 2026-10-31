"use client";
import { visibleTicketAdjustments, type TicketAdjustmentEventAction } from "@/lib/pos-ticket-adjustment-history";
import { WorkspaceText } from "@/components/workspace-language";
import { CustomerName } from "@/components/customer-name";
import {TicketHistoryDisclosure,type TicketLegacyHistoryEntry} from "./ticket-history-disclosure";
import {FinancialHistoryProvider} from "@/app/payroll/inline-financial-history";
import type {PosTicketTimelineItem} from "@/types/pos-ticket-timeline";

import { useMemo, useRef, useState,type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  correctClosedPosTicketInline as ownerCorrectClosedPosTicketInline,
  submitLockedStaffFinancialCorrection as ownerSubmitLockedStaffFinancialCorrection,
} from "@/app/pos-tickets/actions";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import type {
  PosTicketDiscountType,
  PosTicketStatus,
  PosTicketTipType,
} from "@/types/pos-ticket";

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

type TicketCorrectionAction = (formData: FormData) => Promise<void>;

export type TicketCorrectionFormActions = {
  correctClosedTicket: TicketCorrectionAction;
  submitLockedStaffFinancialCorrection?: TicketCorrectionAction;
};

export type TicketCorrectionServiceOption = {
  id: string;
  name: string;
};

export type TicketCorrectionStaffOption = {
  display_name: string;
  id: string;
};

export type EditablePosTicket = {
  salon_id?: string;
  ticket_number?: string;
  workspace_revision?: number;
  adjustments?: Array<{
    action: "item_corrected" | "item_removed" | "item_replaced";
    event_action?: TicketAdjustmentEventAction;
    financial_input_event_id?: string | null;
    financial_before_values?: Record<string,unknown> | null;
    financial_after_values?: Record<string,unknown> | null;
    after_snapshot: unknown;
    before_snapshot: unknown;
    created_at: string;
    created_by: string | null;
    created_by_user: {
      display_name: string | null;
      email: string | null;
      id: string;
    } | null;
    id: string;
    reason: string;
    ticket_id: string;
  }>;
  customer: {
    email: string | null;
    id: string;
    name: string;
    phone: string | null;
  } | null;
  discount_type: PosTicketDiscountType;
  discount_value: number;
  id: string;
  opened_at: string;
  source_booking_id: string | null;
  staff_earnings?: Array<{
    manual_tip_amount: number | null;
    staff_id: string;
    tip_amount: number;
    tip_is_manual: boolean;
  }>;
  status: PosTicketStatus;
  tax_rate: number;
  ticket_items: Array<{
    assigned_staff: {
      display_name: string;
      id: string;
      job_title?: string | null;
    } | null;
    assigned_staff_id: string | null;
    created_at: string;
    id: string;
    line_total: number;
    running_turns?: {
      big: number | null;
      small: number | null;
    };
    service: {
      id: string;
      name: string;
    } | null;
    service_id: string | null;
    service_name_snapshot?: string | null;
    turn_parts?: Array<{
      amount: number;
      created_at?: string;
      id: string;
      staff_id?: string;
      ticket_id?: string;
      ticket_item_id?: string;
      turn_index: number;
      turn_type: "large" | "small";
      work_date?: string;
    }>;
  }>;
  tip_type: PosTicketTipType;
  tip_value: number;
};

type DailyPosTicketCardProps = {
  actions?: TicketCorrectionFormActions;
  businessDateCompactLabel: string;
  canApplyFinancialCorrection: boolean;
  canEdit: boolean;
  dailyNumber: number;
  isBusinessDateLocked: boolean;
  requireServiceForActiveLines?: boolean;
  returnTo: string;
  services: TicketCorrectionServiceOption[];
  staff: TicketCorrectionStaffOption[];
  ticket: EditablePosTicket;
  timeZone?: string;
};

type TicketHistoryAdjustment = NonNullable<
  EditablePosTicket["adjustments"]
>[number];

const OWNER_TICKET_CORRECTION_ACTIONS: Required<TicketCorrectionFormActions> = {
  correctClosedTicket: ownerCorrectClosedPosTicketInline,
  submitLockedStaffFinancialCorrection:
    ownerSubmitLockedStaffFinancialCorrection,
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatTime(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}

function formatDate(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    ...(timeZone ? { timeZone } : {}),
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string, timeZone?: string) {
  return `${formatTime(value, timeZone)} | ${formatDate(value, timeZone)}`;
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

function getInitialLines(ticket: EditablePosTicket): EditableLine[] {
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

function getInitialStaffTips(ticket: EditablePosTicket, totalTipAmount: number) {
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

function getInitialManualStaffTips(ticket: EditablePosTicket) {
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
  correctClosedTicketAction,
  isCorrectionMode,
  onCorrectionIntentChange,
  submitLockedStaffFinancialCorrectionAction,
}: {
  canApplyFinancialCorrection: boolean;
  canSave: boolean;
  correctClosedTicketAction: TicketCorrectionAction;
  isCorrectionMode: boolean;
  onCorrectionIntentChange: (intent: "apply" | "request") => void;
  submitLockedStaffFinancialCorrectionAction: TicketCorrectionAction;
}) {
  const { pending } = useFormStatus();

  if (isCorrectionMode) {
    return (
      <>
        {canApplyFinancialCorrection ? (
          <button
            className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
            disabled={!canSave || pending}
            formAction={submitLockedStaffFinancialCorrectionAction}
            onClick={() => onCorrectionIntentChange("request")}
            type="submit"
          >
            <WorkspaceText text={pending ? "Submitting..." : "Submit Correction Request"} />
          </button>
        ) : null}
        <button
          className="min-h-11 flex-1 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
          disabled={!canSave || pending}
          formAction={submitLockedStaffFinancialCorrectionAction}
          onClick={() =>
            onCorrectionIntentChange(
              canApplyFinancialCorrection ? "apply" : "request",
            )
          }
          type="submit"
        >
          <WorkspaceText text={pending
            ? canApplyFinancialCorrection
              ? "Applying..."
              : "Submitting..."
            : canApplyFinancialCorrection
              ? "Apply Correction"
              : "Submit Correction Request"} />
        </button>
      </>
    );
  }

  return (
    <button
      className="min-h-11 flex-1 rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
      disabled={!canSave || pending}
      formAction={correctClosedTicketAction}
      type="submit"
    >
      <WorkspaceText text={pending ? "Saving..." : "Save"} />
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
          <WorkspaceText text={item.label} />
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
        className={`h-11 w-20 max-w-full rounded border border-zinc-300 px-1 text-base font-medium text-zinc-950 ${className}`}
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
  service_name_snapshot?: string | null;
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
  return item.assigned_staff?.display_name ?? "Staff member";
}

function snapshotServiceName(item: SnapshotItem) {
  return item.service_name_snapshot ?? item.service?.name ?? "Service";
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
  const discountAmount=(value:SnapshotTicket)=>calculateTicketTotals({
    discountType:value.discount_type,discountValue:value.discount_value,
    items:activeSnapshotItems(value).map(item=>({line_total:snapshotLineTotal(item)})),
  }).discount_amount;
  const beforeDiscount=discountAmount(beforeTicket),afterDiscount=discountAmount(afterTicket);
  if(!centsEqual(beforeDiscount,afterDiscount)) lines.push(`Discount ${formatMoney(beforeDiscount)} -> ${formatMoney(afterDiscount)}`);

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
        `${namesByStaffId.get(earning.staff_id) ?? "Staff member"} tip ${formatMoney(
          previousTip,
        )} -> ${formatMoney(nextTip)}`,
      );
    }
  }

  return lines.length > 0
    ? lines
    : ["Details captured in audit snapshot."];
}

export function ticketLegacyHistoryEntries(ticket:EditablePosTicket,timeZone="UTC"):TicketLegacyHistoryEntry[]{
 const businessDate=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(ticket.opened_at));
 return visibleTicketAdjustments(ticket.adjustments??[]).map(adjustment=>{
  const kind=historyKind(adjustment),before=adjustment.financial_before_values,after=adjustment.financial_after_values;
  return {id:adjustment.id,eventId:adjustment.financial_input_event_id,createdAt:adjustment.created_at,
   actor:adjustment.created_by_user?.display_name??adjustment.created_by_user?.email??"Unknown",note:adjustment.reason,
   summary:[...(kind!=="direct"?[historyBadgeLabel(kind)]:[]),...buildCorrectionChangeSummary(adjustment.before_snapshot,adjustment.after_snapshot).map(line=>line.replaceAll(" -> "," → "))],
   change:before&&after&&adjustment.financial_input_event_id?{id:adjustment.financial_input_event_id,salon_id:ticket.salon_id??"",staff_id:null,source_table:"ticket",source_id:ticket.id,ticket_id:ticket.id,
    event_action:"updated",period_start:businessDate,period_end:businessDate,before_values:before,after_values:after,actor_id:adjustment.created_by,
    actor_name:adjustment.created_by_user?.display_name??adjustment.created_by_user?.email??"Unknown",note:adjustment.reason,created_at:adjustment.created_at,business_timezone:timeZone}:undefined};
 });
}

/** The detail route uses the original header as the single inline entry. */
export function TicketDetailInlineHistory({ticket,salonId,businessDate,timeZone,children,timeline=[]}:{ticket:EditablePosTicket;salonId:string;businessDate:string;timeZone:string;children:ReactNode;timeline?:PosTicketTimelineItem[]}){
 const facts=timeline.length?<ul className="space-y-2 border-t border-zinc-100 bg-white px-3 py-3 text-xs text-zinc-600" aria-label="Recorded ticket details">{timeline.map(item=><li key={item.id}><strong><WorkspaceText text={item.label}/></strong> · <WorkspaceText text={formatDateTime(item.timestamp,timeZone)}/> · {item.user}{item.note&&<p className="mt-1">{item.note}</p>}</li>)}</ul>:undefined;
 return <FinancialHistoryProvider salonId={salonId} surface="today" start={businessDate} end={businessDate}>
  <TicketHistoryDisclosure ticketId={ticket.id} legacyEntries={ticketLegacyHistoryEntries(ticket,timeZone)} timeZone={timeZone} additionalDetails={facts}>{children}</TicketHistoryDisclosure>
 </FinancialHistoryProvider>;
}

export function DailyPosTicketCard({
  actions,
  businessDateCompactLabel,
  canApplyFinancialCorrection,
  canEdit,
  dailyNumber,
  requireServiceForActiveLines = true,
  returnTo,
  services,
  staff,
  ticket: serverTicket,
  timeZone,
}: DailyPosTicketCardProps) {
  const [editSnapshot,setEditSnapshot]=useState<EditablePosTicket|null>(null);
  const ticket=editSnapshot??serverTicket;
  const correctionActions = actions ?? OWNER_TICKET_CORRECTION_ACTIONS;
  const lockedCorrectionAction =
    correctionActions.submitLockedStaffFinancialCorrection ??
    correctionActions.correctClosedTicket;
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
  const [discountType,setDiscountType]=useState(ticket.discount_type);
  const [discountValue,setDiscountValue]=useState(formatNumber(ticket.discount_value));
  const [requestId,setRequestId]=useState("");
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
    discountType,
    discountValue: toMoneyNumber(discountValue),
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
      (requireServiceForActiveLines && !line.service_id) ||
      !line.staff_id ||
      line.parts.length === 0 ||
      line.parts.some(
        (part) => !Number.isFinite(Number(part.amount)) || Number(part.amount) <= 0,
      ),
  );
  const invalidExistingLine = activeLines.some(
    (line) =>
      (requireServiceForActiveLines && !line.serviceId && !originalItemByKey.has(line.key)) ||
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
    hasManualTipChange || discountType!==ticket.discount_type || !centsEqual(discountValue,ticket.discount_value);
  const invalidDiscount=!Number.isFinite(toMoneyNumber(discountValue)) || toMoneyNumber(discountValue)<0 ||
    (discountType==="percentage" ? toMoneyNumber(discountValue)>100 : safeCents(discountValue)>safeCents(editedTotals.subtotal));
  const canSave =
    reason.trim().length > 0 &&
    hasChange &&
    !invalidTipTotal && !invalidDiscount && Boolean(requestId) &&
    !invalidAddedLine &&
    !invalidExistingLine &&
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
    setEditSnapshot(null);
    setLines(initialLines);
    setTipTotal(formatNumber(initialTotals.tip_amount));
    setDiscountType(ticket.discount_type);
    setDiscountValue(formatNumber(ticket.discount_value));
    setRequestId("");
    setStaffTipDrafts({});
    setReason("");
    setSelectorTarget(null);
    setMoneyTarget(null);
    setIsEditing(false);
    setIsCorrectionMode(false);
    setShowLockedConfirmation(false);
  }

  function startEdit() {
    setLines(getInitialLines(serverTicket));
    setTipTotal(formatNumber(initialTotals.tip_amount));
    setDiscountType(serverTicket.discount_type);
    setDiscountValue(formatNumber(serverTicket.discount_value));
    setRequestId(crypto.randomUUID());
    setEditSnapshot(serverTicket);
    setIsCorrectionMode(false);
    setIsEditing(true);
  }

  function continueLockedCorrection() {
    setEditSnapshot(serverTicket);
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
      originalItemByKey.get(line.key)?.service_name_snapshot ??
        (originalItemByKey.get(line.key)?.service_id === null ? "Custom service" : "Select service")
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

  function staffOptionsForLine() {
    return staff.map((member) => ({
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
            className={`min-w-0 min-h-11 max-w-full truncate rounded px-1 py-0.5 text-left underline decoration-zinc-300 underline-offset-4 font-semibold hover:bg-zinc-100 disabled:hover:bg-transparent ${
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
        </span>
        {isOpen ? (
          <PickerPopover
            items={staffOptionsForLine()}
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
          className={`min-h-11 max-w-full truncate rounded px-1 py-0.5 text-left underline decoration-zinc-300 underline-offset-4 hover:bg-zinc-100 disabled:hover:bg-transparent ${
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
      <div key={line.key} data-receipt-line className={`px-4 py-1 text-sm sm:px-3 ${line.remove ? "bg-red-50/50 text-zinc-400" : "bg-white"}`}>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(64px,auto)_36px] items-center gap-1">
          {renderStaffSelector(line)}
          {renderServiceSelector(line)}
          <div className="min-w-0 justify-self-end tabular-nums underline decoration-zinc-300 underline-offset-4">{renderParts(line)}</div>
          <button aria-label={line.remove ? "Undo" : "Remove"} title={line.remove ? "Undo" : "Remove"}
            className="flex h-11 w-9 items-center justify-center text-lg text-red-500"
            onClick={() => removeLine(line)} type="button">
            {line.remove ? <WorkspaceText text="Undo" /> : <span aria-hidden="true">&#8854;</span>}
          </button>
        </div>
        <details className="text-xs text-zinc-500">
          <summary className="w-fit cursor-pointer py-1"><WorkspaceText text="More" /></summary>
          <div className="flex flex-wrap items-center gap-3 pb-2">
            {renderTurnDisplay(line)}
            {!line.remove ? <button className="min-h-11 rounded border border-zinc-200 px-3 text-zinc-700" onClick={() => addPart(line)} type="button"><WorkspaceText text="+ Part" /></button> : null}
            {line.staffId && activeLines.find(active=>active.staffId===line.staffId)?.key===line.key ? <InlineMoney disabled={line.remove} isEditing={Boolean(isStaffTipEditing)}
              onChange={(value) => setStaffTip(line.staffId, value)} onDone={finishMoneyEdit}
              onStart={() => startStaffTipEdit(line.staffId)} prefix="Tip " value={staffTipInput} /> : null}
          </div>
        </details>
      </div>
    );
  }

  const historyEntries=ticketLegacyHistoryEntries(ticket,timeZone);
  function renderCorrectionHistory() {
    return <TicketHistoryDisclosure ticketId={ticket.id} legacyEntries={historyEntries} timeZone={timeZone} inlineOnly/>;
  }

  const isTotalTipEditing = moneyTarget?.kind === "totalTip";

  return (
    <article className="border-b border-zinc-200" data-business-date-label={businessDateCompactLabel}>
      <form action={correctionActions.correctClosedTicket}>
        {isEditing ? (
          <>
            <input name="ticket_id" type="hidden" value={ticket.id} />
            <input name="return_to" type="hidden" value={returnTo} />
            <input name="expected_revision" type="hidden" value={ticket.workspace_revision??0} />
            <input name="request_id" type="hidden" value={requestId} />
            <input name="discount_type" type="hidden" value={discountType} />
            <input name="discount_value" type="hidden" value={normalizeMoneyInput(discountValue)} />
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
        {!isEditing ? (
          <TicketHistoryDisclosure ticketId={ticket.id} legacyEntries={historyEntries} timeZone={timeZone}>
          <div className="px-4 py-3 text-sm text-zinc-950 sm:px-3" data-compact-ticket>
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 font-semibold">#{dailyNumber}</span>
              <span className="shrink-0 text-xs text-zinc-600"><WorkspaceText text={formatTime(ticket.opened_at, timeZone)} /></span>
              <span className="min-w-0 flex-1 truncate"><CustomerName name={ticket.customer?.name} /></span>
              {ticket.source_booking_id ? <span className="shrink-0 text-xs text-sky-800"><WorkspaceText text="From appointment" /></span> : null}
              {canCorrectClosedTicket ? (
                <button type="button" aria-label="Edit" title="Edit" onClick={event=>{event.preventDefault();event.stopPropagation();startEdit();}}
                  className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-zinc-600">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m16 3 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1 1-6Z" /></svg>
                </button>
              ) : null}
            </div>
            <div className="my-2 space-y-1">
              {displayedLines.length === 0 ? <WorkspaceText text="No services recorded." /> : displayedLines.map(line => (
                <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-baseline gap-2">
                  <span className="min-w-0 break-words font-semibold">{staffDisplayName(line)}</span>
                  <span className="min-w-0 break-words text-zinc-600">{serviceName(line)}</span>
                  <span className="tabular-nums">{formatMoney(lineTotal(line))}</span>
                </div>
              ))}
            </div>
            <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums text-zinc-600">
              <span><WorkspaceText text="Tip" /> {formatMoney(initialTotals.tip_amount)}</span>
              <span><WorkspaceText text="Discount" /> {formatMoney(initialTotals.discount_amount)}</span>
              <span className="font-semibold text-zinc-950"><WorkspaceText text="Total" /> {formatMoney(initialTotals.total)}</span>
            </div>
          </div>
          </TicketHistoryDisclosure>
        ) : (<>
        <div data-receipt-header className="flex min-w-0 items-center gap-3 border-b border-zinc-200 px-4 py-4 text-sm sm:px-3">
          <span className="shrink-0 font-semibold text-zinc-950">#{dailyNumber}</span>
          <span className="shrink-0 text-zinc-600"><WorkspaceText text={formatTime(ticket.opened_at, timeZone)} /></span>
          <span className="min-w-0 flex-1 truncate text-right text-zinc-700"><CustomerName name={ticket.customer?.name} /></span>
          {ticket.source_booking_id ? <span className="text-xs text-sky-800"><WorkspaceText text="From appointment" /></span> : null}
        </div>
        <div className="divide-y divide-zinc-100">
          {displayedLines.length === 0 ? (
            <div className="px-3 py-2 text-sm text-zinc-500">
              <WorkspaceText text="No services recorded." />
            </div>
          ) : (
            displayedLines.map((line) => renderLine(line))
          )}
        </div>
        </>)}
        {isEditing ? (
          <div className="px-4 pb-4 text-sm sm:px-3" data-receipt-editor>
            {isCorrectionMode ? (
              <div className="mb-3">
                <span className="inline-flex rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                  <WorkspaceText text="Correction Mode" />
                </span>
              </div>
            ) : null}
            <button
              className="min-h-11 w-full border-b border-zinc-200 py-3 text-left font-medium text-orange-600 hover:text-orange-700"
              onClick={addLine}
              type="button"
            >
              <WorkspaceText text="+ Add staff / service" />
            </button>
            <div className="space-y-3 py-4 tabular-nums text-zinc-600" data-receipt-adjustments>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label htmlFor={`discount-${ticket.id}`}><WorkspaceText text="Discount" /></label>
                <div className="flex items-center gap-2">
                  <select className="min-h-11 rounded border border-zinc-300 bg-white px-2 text-base" aria-label="Discount type" value={discountType} onChange={event=>setDiscountType(event.target.value as PosTicketDiscountType)}>
                    <option value="fixed_amount">$</option><option value="percentage">%</option>
                  </select>
                  <input id={`discount-${ticket.id}`} className="min-h-11 w-24 rounded border border-zinc-300 px-2 text-right text-base" inputMode="decimal" value={discountValue} onChange={event=>setDiscountValue(event.target.value)} onBlur={()=>setDiscountValue(normalizeMoneyInput(discountValue))} />
                </div>
              </div>
              {toMoneyNumber(tipTotal) > 0 || isTotalTipEditing ? (
                <div className="flex items-center justify-between gap-3"><WorkspaceText text="Tip" />
                  <InlineMoney isEditing={isTotalTipEditing} onChange={updateTotalTip} onDone={finishMoneyEdit} onStart={startTotalTipEdit} value={tipTotal} />
                </div>
              ) : (
                <details className="text-xs"><summary className="w-fit cursor-pointer"><WorkspaceText text="Tip" /></summary>
                  <div className="flex justify-end"><InlineMoney isEditing={isTotalTipEditing} onChange={updateTotalTip} onDone={finishMoneyEdit} onStart={startTotalTipEdit} value={tipTotal} /></div>
                </details>
              )}
              {editedTotals.tax_amount > 0 ? <div className="flex justify-between gap-3"><WorkspaceText text="Tax" /><span>{formatMoney(editedTotals.tax_amount)}</span></div> : null}
            </div>
            <div className="flex justify-between gap-3 border-t border-zinc-200 py-4 text-lg font-semibold tabular-nums text-zinc-950" data-receipt-total>
              <WorkspaceText text="Total" /><span>{formatMoney(editedTotals.total)}</span>
            </div>
            <label className="mt-3 block text-sm font-medium text-zinc-700">
              <WorkspaceText text="Reason" />
              <textarea
                className="mt-2 min-h-20 w-full rounded-lg border border-zinc-300 px-3 py-2 text-base text-zinc-950"
                name="correction_reason"
                onChange={(event) => setReason(event.target.value)}
                required
                value={reason}
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className={hasChange ? "text-xs text-zinc-500" : "sr-only"} aria-live="polite">
                <WorkspaceText text={manualTipsTooHigh
                    ? "Manual staff tips cannot exceed total tip."
                    : manualTipsMismatch
                      ? "Manual staff tips must equal total tip when every staff tip is manual."
                      : invalidDiscount
                        ? "Discount must be within the service total, or 0–100%."
                      : invalidTipTotal
                        ? "Total tip must be zero or greater."
                        : invalidAddedLine
                          ? requireServiceForActiveLines
                            ? "Added lines require staff, service, and parts greater than 0."
                            : "Added lines require staff and parts greater than 0."
                          : invalidExistingLine
                            ? requireServiceForActiveLines
                              ? "Active lines require staff, service, and positive parts."
                              : "Active lines require staff and positive parts."
                            : hasChange
                              ? "Ready to save correction."
                              : "Make a change to enable save."} />
              </p>
              <div className="flex w-full flex-wrap gap-3">
                <button
                  className="min-h-11 rounded-lg px-5 py-2 text-sm font-medium text-zinc-700"
                  onClick={resetEdit}
                  type="button"
                >
                  <WorkspaceText text="Cancel" />
                </button>
                <SaveButton
                  canApplyFinancialCorrection={canApplyFinancialCorrection}
                  canSave={canSave}
                  correctClosedTicketAction={correctionActions.correctClosedTicket}
                  isCorrectionMode={isCorrectionMode}
                  onCorrectionIntentChange={setCorrectionIntent}
                  submitLockedStaffFinancialCorrectionAction={lockedCorrectionAction}
                />
              </div>
            </div>
          </div>
        ) : null}
      </form>
      {isEditing ? renderCorrectionHistory() : null}
      {showLockedConfirmation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
          <div
            aria-modal="true"
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            role="dialog"
          >
            <h3 className="text-base font-semibold text-zinc-950">
              <WorkspaceText text="Locked Business Date" />
            </h3>
            <p className="mt-3 text-sm leading-6 text-zinc-700">
              <WorkspaceText text="This business date is locked. Your changes will be recorded as a financial correction request instead of directly changing the original ticket." />
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950"
                onClick={() => setShowLockedConfirmation(false)}
                type="button"
              >
                <WorkspaceText text="Cancel" />
              </button>
              <button
                className="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white"
                onClick={continueLockedCorrection}
                type="button"
              >
                <WorkspaceText text="Continue" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
