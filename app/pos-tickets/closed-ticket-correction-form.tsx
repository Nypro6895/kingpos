"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { correctClosedPosTicketInline } from "@/app/pos-tickets/actions";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import type { PosTicketWithRelations } from "@/types/pos-ticket";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";

type EditableLine = {
  itemId: string | null;
  key: string;
  quantity: string;
  remove: boolean;
  serviceId: string;
  staffId: string;
  unitPrice: string;
};

type SelectorTarget = {
  field: "service" | "staff";
  lineKey: string;
} | null;

type MoneyTarget =
  | { kind: "amount"; lineKey: string }
  | { kind: "lineTip"; lineKey: string }
  | { kind: "totalTip" }
  | null;

type DailyPosTicketCardProps = {
  canEdit: boolean;
  dailyNumber: number;
  returnTo: string;
  services: Service[];
  staff: Staff[];
  ticket: PosTicketWithRelations;
  turnLabels: Record<string, string>;
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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function toMoneyNumber(value: string) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

function normalizeMoneyInput(value: string) {
  return formatNumber(Math.max(0, roundMoney(toMoneyNumber(value))));
}

function numericEqual(left: string, right: number) {
  return Math.abs(toMoneyNumber(left) - right) < 0.005;
}

function lineTotal(line: EditableLine) {
  return roundMoney(toMoneyNumber(line.quantity) * toMoneyNumber(line.unitPrice));
}

function getInitialLines(ticket: PosTicketWithRelations): EditableLine[] {
  return (ticket.ticket_items ?? []).map((item) => ({
    itemId: item.id,
    key: item.id,
    quantity: "1",
    remove: false,
    serviceId: item.service_id ?? "",
    staffId: item.assigned_staff_id ?? "",
    unitPrice: formatNumber(item.line_total),
  }));
}

function getTicketItemTip(
  ticket: PosTicketWithRelations,
  item: PosTicketWithRelations["ticket_items"][number],
  totalTipAmount: number,
) {
  if (totalTipAmount <= 0) {
    return 0;
  }

  const earning = ticket.staff_earnings?.find(
    (staffEarning) => staffEarning.staff_id === item.assigned_staff_id,
  );

  if (!earning || earning.service_total <= 0) {
    return 0;
  }

  return roundMoney((earning.tip_amount * item.line_total) / earning.service_total);
}

function SaveButton({ canSave }: { canSave: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
      disabled={!canSave || pending}
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
  items: Array<{ id: string; label: string }>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="absolute left-0 top-full z-20 mt-1 max-h-56 min-w-52 overflow-auto rounded border border-zinc-200 bg-white py-1 shadow-lg">
      {items.map((item) => (
        <button
          className="block w-full px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100"
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

export function DailyPosTicketCard({
  canEdit,
  dailyNumber,
  returnTo,
  services,
  staff,
  ticket,
  turnLabels,
}: DailyPosTicketCardProps) {
  const initialTotals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items: ticket.ticket_items ?? [],
    taxRate: ticket.tax_rate,
    tipType: ticket.tip_type,
    tipValue: ticket.tip_value,
  });
  const [isEditing, setIsEditing] = useState(false);
  const [selectorTarget, setSelectorTarget] = useState<SelectorTarget>(null);
  const [moneyTarget, setMoneyTarget] = useState<MoneyTarget>(null);
  const initialLines = useMemo(() => getInitialLines(ticket), [ticket]);
  const initialLineByKey = useMemo(
    () => new Map(initialLines.map((line) => [line.key, line])),
    [initialLines],
  );
  const originalItemByKey = useMemo(
    () => new Map((ticket.ticket_items ?? []).map((item) => [item.id, item])),
    [ticket.ticket_items],
  );
  const initialLineTipByKey = useMemo(
    () =>
      new Map(
        (ticket.ticket_items ?? []).map((item) => [
          item.id,
          getTicketItemTip(ticket, item, initialTotals.tip_amount),
        ]),
      ),
    [initialTotals.tip_amount, ticket],
  );
  const servicesById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );
  const staffById = useMemo(
    () => new Map(staff.map((member) => [member.id, member])),
    [staff],
  );
  const serviceOptions = useMemo(
    () => services.map((service) => ({ id: service.id, label: service.name })),
    [services],
  );
  const staffOptions = useMemo(
    () => staff.map((member) => ({ id: member.id, label: member.display_name })),
    [staff],
  );
  const [lines, setLines] = useState<EditableLine[]>(initialLines);
  const [tipTotal, setTipTotal] = useState(formatNumber(initialTotals.tip_amount));
  const [lineTipDrafts, setLineTipDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const activeLines = lines.filter((line) => !line.remove);
  const activeLineByKey = new Map(activeLines.map((line) => [line.key, line]));
  const totalTipAmount = toMoneyNumber(tipTotal);
  const manualLineTipTotal = activeLines.reduce((total, line) => {
    const draft = lineTipDrafts[line.key];

    return draft === undefined ? total : total + toMoneyNumber(draft);
  }, 0);
  const nonManualLineTotal = activeLines.reduce((total, line) => {
    if (lineTipDrafts[line.key] !== undefined || !line.staffId) {
      return total;
    }

    return total + lineTotal(line);
  }, 0);
  const remainingTip = Math.max(0, totalTipAmount - manualLineTipTotal);
  const lineTipValue = (line: EditableLine) => {
    const draft = lineTipDrafts[line.key];

    if (draft !== undefined) {
      return Math.max(0, toMoneyNumber(draft));
    }

    if (!line.staffId || remainingTip <= 0 || nonManualLineTotal <= 0) {
      return 0;
    }

    return roundMoney((remainingTip * lineTotal(line)) / nonManualLineTotal);
  };
  const staffSummaryMap = new Map<string, { serviceTotal: number }>();

  for (const line of activeLines) {
    if (!line.staffId) {
      continue;
    }

    const existing = staffSummaryMap.get(line.staffId) ?? { serviceTotal: 0 };
    existing.serviceTotal = roundMoney(existing.serviceTotal + lineTotal(line));
    staffSummaryMap.set(line.staffId, existing);
  }

  const staffSummaries = Array.from(staffSummaryMap.entries()).map(
    ([staffId, summary]) => ({
      staffId,
      ...summary,
    }),
  );
  const manualStaffIds = new Set(
    activeLines
      .filter((line) => line.staffId && lineTipDrafts[line.key] !== undefined)
      .map((line) => line.staffId),
  );
  const staffTipOverrides = staffSummaries
    .filter((summary) => manualStaffIds.has(summary.staffId))
    .map((summary) => ({
      is_manual: true,
      staff_id: summary.staffId,
      tip_amount: roundMoney(
        activeLines
          .filter((line) => line.staffId === summary.staffId)
          .reduce((total, line) => total + lineTipValue(line), 0),
      ),
    }));
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
        !numericEqual(line.unitPrice, toMoneyNumber(initial.unitPrice))
      );
    })
    .map((line) => ({
      item_id: line.itemId,
      quantity: 1,
      remove: line.remove,
      service_id: line.serviceId || null,
      staff_id: line.staffId || null,
      unit_price: toMoneyNumber(line.unitPrice),
    }));
  const addedItems = lines
    .filter((line) => !line.itemId && !line.remove)
    .map((line) => ({
      quantity: 1,
      service_id: line.serviceId,
      staff_id: line.staffId,
      unit_price: toMoneyNumber(line.unitPrice),
    }));
  const hasTipChange = !numericEqual(tipTotal, initialTotals.tip_amount);
  const hasManualTipChange = Object.entries(lineTipDrafts).some(([lineKey, value]) => {
    const line = activeLineByKey.get(lineKey);

    if (!line) {
      return false;
    }

    return !numericEqual(value, initialLineTipByKey.get(lineKey) ?? 0);
  });
  const invalidTipTotal = !Number.isFinite(totalTipAmount) || totalTipAmount < 0;
  const invalidAddedLine = addedItems.some(
    (line) => !line.service_id || !line.staff_id || line.unit_price <= 0,
  );
  const invalidExistingLine = activeLines.some(
    (line) => line.itemId && (!line.serviceId || !line.staffId || lineTotal(line) < 0),
  );
  const allStaffTipsManual =
    staffSummaries.length > 0 && staffTipOverrides.length === staffSummaries.length;
  const manualStaffTipTotal = staffTipOverrides.reduce(
    (total, override) => total + override.tip_amount,
    0,
  );
  const manualTipsTooHigh = toCents(manualLineTipTotal) > toCents(totalTipAmount);
  const manualTipsMismatch =
    allStaffTipsManual && toCents(manualStaffTipTotal) !== toCents(totalTipAmount);
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
    !manualTipsTooHigh &&
    !manualTipsMismatch;

  function updateLine(key: string, patch: Partial<EditableLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
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
    setLines((current) => [
      ...current,
      {
        itemId: null,
        key: `new-${Date.now()}-${current.length}`,
        quantity: "1",
        remove: false,
        serviceId: "",
        staffId: "",
        unitPrice: "0",
      },
    ]);
  }

  function resetEdit() {
    setLines(initialLines);
    setTipTotal(formatNumber(initialTotals.tip_amount));
    setLineTipDrafts({});
    setReason("");
    setSelectorTarget(null);
    setMoneyTarget(null);
    setIsEditing(false);
  }

  function finishMoneyEdit() {
    if (moneyTarget?.kind === "amount") {
      const line = lines.find((currentLine) => currentLine.key === moneyTarget.lineKey);

      if (line) {
        updateLine(line.key, { unitPrice: normalizeMoneyInput(line.unitPrice) });
      }
    }

    if (moneyTarget?.kind === "lineTip") {
      const line = lines.find((currentLine) => currentLine.key === moneyTarget.lineKey);

      if (line) {
        setLineTipDrafts((current) => ({
          ...current,
          [line.key]: normalizeMoneyInput(current[line.key] ?? "0"),
        }));
      }
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

  function staffName(line: EditableLine) {
    return (
      staffById.get(line.staffId)?.display_name ??
      originalItemByKey.get(line.key)?.assigned_staff?.display_name ??
      "Select staff"
    );
  }

  function setLineTip(line: EditableLine, value: string) {
    setLineTipDrafts((current) => ({
      ...current,
      [line.key]: value,
    }));
  }

  function renderSelector({
    disabled,
    field,
    line,
  }: {
    disabled?: boolean;
    field: "service" | "staff";
    line: EditableLine;
  }) {
    const isOpen =
      selectorTarget?.field === field && selectorTarget.lineKey === line.key;
    const options = field === "service" ? serviceOptions : staffOptions;
    const label = field === "service" ? serviceName(line) : staffName(line);
    const isPlaceholder =
      (field === "service" && !line.serviceId) || (field === "staff" && !line.staffId);

    return (
      <span className="relative min-w-0">
        <button
          className={`max-w-full truncate rounded px-1 py-0.5 text-left hover:bg-zinc-100 disabled:hover:bg-transparent ${
            isPlaceholder ? "text-zinc-500" : "text-zinc-800"
          }`}
          disabled={disabled}
          onClick={() =>
            setSelectorTarget(isOpen ? null : { field, lineKey: line.key })
          }
          type="button"
        >
          {label}
        </button>
        {isOpen ? (
          <PickerPopover
            items={options}
            onSelect={(id) => {
              updateLine(
                line.key,
                field === "service" ? { serviceId: id } : { staffId: id },
              );
              setSelectorTarget(null);
            }}
          />
        ) : null}
      </span>
    );
  }

  function renderLine(line: EditableLine) {
    const isRemoved = line.remove;
    const lineTip = lineTipValue(line);
    const lineTipInput = lineTipDrafts[line.key] ?? formatNumber(lineTip);
    const isAmountEditing =
      moneyTarget?.kind === "amount" && moneyTarget.lineKey === line.key;
    const isLineTipEditing =
      moneyTarget?.kind === "lineTip" && moneyTarget.lineKey === line.key;

    return (
      <div
        className={`grid gap-2 px-3 py-1.5 text-sm sm:grid-cols-[116px_minmax(140px,180px)_minmax(180px,1fr)_100px_108px_64px] ${
          isRemoved ? "bg-red-50/40 text-zinc-400" : ""
        }`}
        key={line.key}
      >
        <span className="font-medium text-zinc-700">
          {line.itemId ? (turnLabels[line.itemId] ?? "") : ""}
        </span>
        {isEditing ? (
          renderSelector({ disabled: isRemoved, field: "staff", line })
        ) : (
          <span className="min-w-0 truncate font-medium text-zinc-800">
            {staffName(line)}
          </span>
        )}
        {isEditing ? (
          renderSelector({ disabled: isRemoved, field: "service", line })
        ) : (
          <span className="min-w-0 truncate text-zinc-700">{serviceName(line)}</span>
        )}
        <InlineMoney
          disabled={!isEditing || isRemoved}
          isEditing={isAmountEditing}
          onChange={(value) => updateLine(line.key, { unitPrice: value })}
          onDone={finishMoneyEdit}
          onStart={() => setMoneyTarget({ kind: "amount", lineKey: line.key })}
          value={line.unitPrice}
        />
        <InlineMoney
          disabled={!isEditing || isRemoved}
          isEditing={isLineTipEditing}
          onChange={(value) => setLineTip(line, value)}
          onDone={finishMoneyEdit}
          onStart={() => setMoneyTarget({ kind: "lineTip", lineKey: line.key })}
          prefix="Tip: "
          value={lineTipInput}
        />
        {isEditing ? (
          <button
            className="justify-self-start rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            onClick={() => removeLine(line)}
            type="button"
          >
            {isRemoved ? "Undo" : "Remove"}
          </button>
        ) : null}
      </div>
    );
  }

  const cardRows = isEditing ? lines : initialLines;
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
            <input name="added_items" type="hidden" value={JSON.stringify(addedItems)} />
            <input
              name="staff_tip_overrides"
              type="hidden"
              value={JSON.stringify(staffTipOverrides)}
            />
          </>
        ) : null}
        <div className="grid items-center gap-2 bg-zinc-50 px-3 py-2 text-sm sm:grid-cols-[48px_80px_minmax(150px,1fr)_110px_150px_130px_56px]">
          <span className="font-semibold text-zinc-950">#{dailyNumber}</span>
          <span className="text-zinc-700">{formatTime(ticket.opened_at)}</span>
          <span className="min-w-0 truncate font-medium text-zinc-950">
            {ticket.customer?.name ?? "Walk-in Customer"}
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
            {isEditing ? (
              <InlineMoney
                className="inline-block"
                isEditing={isTotalTipEditing}
                onChange={setTipTotal}
                onDone={finishMoneyEdit}
                onStart={() => setMoneyTarget({ kind: "totalTip" })}
                value={tipDisplay}
              />
            ) : (
              <span className="font-semibold text-zinc-950">
                {formatMoney(initialTotals.tip_amount)}
              </span>
            )}
          </span>
          {!isEditing && canEdit && ticket.status === "closed" ? (
            <button
              className="justify-self-start rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-950 sm:justify-self-end"
              onClick={() => setIsEditing(true)}
              type="button"
            >
              Edit
            </button>
          ) : null}
        </div>
        <div className="divide-y divide-zinc-100">
          {cardRows.length === 0 ? (
            <div className="px-3 py-2 text-sm text-zinc-500">
              No services recorded.
            </div>
          ) : (
            cardRows.map((line) => renderLine(line))
          )}
        </div>
        {isEditing ? (
          <div className="border-t border-zinc-200 px-3 py-3">
            <button
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-zinc-50"
              onClick={addLine}
              type="button"
            >
              + Add Staff/Service Line
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
                {manualTipsTooHigh
                  ? "Manual staff tips cannot exceed total tip."
                  : manualTipsMismatch
                    ? "Manual staff tips must equal total tip when every staff tip is manual."
                    : invalidTipTotal
                      ? "Total tip must be zero or greater."
                      : invalidAddedLine
                        ? "Added lines require staff, service, and amount greater than 0."
                        : invalidExistingLine
                          ? "Active lines require staff and service."
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
                <SaveButton canSave={canSave} />
              </div>
            </div>
          </div>
        ) : null}
      </form>
    </article>
  );
}
