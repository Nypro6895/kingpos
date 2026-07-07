"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { correctClosedPosTicket } from "@/app/pos-tickets/actions";
import type { PosTicketItemWithRelations } from "@/types/pos-ticket-item";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";

type CorrectionDraft = {
  quantity: string;
  removeItem: boolean;
  serviceId: string;
  staffId: string;
  unitPrice: string;
};

type ClosedTicketCorrectionEditorProps = {
  items: PosTicketItemWithRelations[];
  returnTo: string;
  services: Service[];
  staff: Staff[];
  ticketId: string;
  turnLabels: Record<string, string>;
};

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function numericEqual(left: string, right: number) {
  const parsed = Number(left);

  return Number.isFinite(parsed) && Math.abs(parsed - right) < 0.005;
}

function getInitialDraft(item: PosTicketItemWithRelations): CorrectionDraft {
  return {
    quantity: formatNumber(item.quantity),
    removeItem: false,
    serviceId: item.service_id ?? "",
    staffId: item.assigned_staff_id ?? "",
    unitPrice: formatNumber(item.unit_price),
  };
}

function isChanged(item: PosTicketItemWithRelations, draft: CorrectionDraft) {
  return (
    draft.removeItem ||
    draft.serviceId !== (item.service_id ?? "") ||
    draft.staffId !== (item.assigned_staff_id ?? "") ||
    !numericEqual(draft.quantity, item.quantity) ||
    !numericEqual(draft.unitPrice, item.unit_price)
  );
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

export function ClosedTicketCorrectionEditor({
  items,
  returnTo,
  services,
  staff,
  ticketId,
  turnLabels,
}: ClosedTicketCorrectionEditorProps) {
  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const [drafts, setDrafts] = useState<Record<string, CorrectionDraft>>(() =>
    Object.fromEntries(items.map((item) => [item.id, getInitialDraft(item)])),
  );
  const [reason, setReason] = useState("");
  const groups = useMemo(() => {
    const groupMap = new Map<
      string,
      { items: PosTicketItemWithRelations[]; staffName: string }
    >();

    for (const item of items) {
      const key = item.assigned_staff_id ?? "unassigned";
      const staffName = item.assigned_staff?.display_name ?? "Unassigned";
      const group = groupMap.get(key);

      if (group) {
        group.items.push(item);
      } else {
        groupMap.set(key, { items: [item], staffName });
      }
    }

    return Array.from(groupMap.entries()).map(([key, group]) => ({
      key,
      ...group,
    }));
  }, [items]);
  const changedItemIds = items
    .filter((item) => isChanged(item, drafts[item.id] ?? getInitialDraft(item)))
    .map((item) => item.id);
  const activeItemId = changedItemIds.length === 1 ? changedItemIds[0] : "";
  const activeDraft = activeItemId ? drafts[activeItemId] : null;
  const activeItem = activeItemId ? itemById.get(activeItemId) : null;
  const hasOneChange = changedItemIds.length === 1;
  const hasReason = reason.trim().length > 0;
  const canSave = hasOneChange && hasReason;

  function updateDraft(itemId: string, patch: Partial<CorrectionDraft>) {
    const item = itemById.get(itemId);

    if (!item) {
      return;
    }

    setDrafts((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? getInitialDraft(item)),
        ...patch,
      },
    }));
  }

  return (
    <form action={correctClosedPosTicket} className="mt-3">
      <input name="ticket_id" type="hidden" value={ticketId} />
      <input name="return_to" type="hidden" value={returnTo} />
      <input name="item_id" type="hidden" value={activeItemId} />
      <input
        name="service_id"
        type="hidden"
        value={activeDraft?.serviceId ?? activeItem?.service_id ?? ""}
      />
      <input
        name="assigned_staff_id"
        type="hidden"
        value={activeDraft?.staffId ?? activeItem?.assigned_staff_id ?? ""}
      />
      <input
        name="quantity"
        type="hidden"
        value={activeDraft?.quantity ?? (activeItem ? formatNumber(activeItem.quantity) : "")}
      />
      <input
        name="unit_price"
        type="hidden"
        value={activeDraft?.unitPrice ?? (activeItem ? formatNumber(activeItem.unit_price) : "")}
      />
      {activeDraft?.removeItem ? (
        <input name="remove_item" type="hidden" value="on" />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((group) => (
          <section className="rounded border border-zinc-200 p-3" key={group.key}>
            <p className="font-semibold text-zinc-950">{group.staffName}</p>
            <div className="mt-2 divide-y divide-zinc-100">
              {group.items.map((item) => {
                const draft = drafts[item.id] ?? getInitialDraft(item);
                const changed = isChanged(item, draft);

                return (
                  <div
                    className={`grid gap-2 py-2 text-sm ${
                      draft.removeItem ? "opacity-60" : ""
                    }`}
                    key={item.id}
                  >
                    <div className="grid gap-2 md:grid-cols-[minmax(120px,1fr)_minmax(110px,150px)]">
                      <select
                        aria-label="Service"
                        className="h-8 min-w-0 rounded border border-zinc-300 bg-white px-2 text-xs text-zinc-950"
                        disabled={draft.removeItem}
                        onChange={(event) =>
                          updateDraft(item.id, { serviceId: event.target.value })
                        }
                        value={draft.serviceId}
                      >
                        <option value="">Service</option>
                        {services.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Staff"
                        className="h-8 min-w-0 rounded border border-zinc-300 bg-white px-2 text-xs text-zinc-950"
                        disabled={draft.removeItem}
                        onChange={(event) =>
                          updateDraft(item.id, { staffId: event.target.value })
                        }
                        value={draft.staffId}
                      >
                        <option value="">Unassigned</option>
                        {staff.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.display_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-[60px_90px_1fr_auto] items-center gap-2">
                      <input
                        aria-label="Quantity"
                        className="h-8 rounded border border-zinc-300 px-2 text-xs text-zinc-950"
                        disabled={draft.removeItem}
                        min="0.01"
                        onChange={(event) =>
                          updateDraft(item.id, { quantity: event.target.value })
                        }
                        step="0.01"
                        type="number"
                        value={draft.quantity}
                      />
                      <input
                        aria-label="Amount"
                        className="h-8 rounded border border-zinc-300 px-2 text-xs text-zinc-950"
                        disabled={draft.removeItem}
                        min="0"
                        onChange={(event) =>
                          updateDraft(item.id, { unitPrice: event.target.value })
                        }
                        step="0.01"
                        type="number"
                        value={draft.unitPrice}
                      />
                      <span className="min-w-0 truncate text-xs text-zinc-500">
                        {turnLabels[item.id] ?? ""}
                      </span>
                      <label className="inline-flex items-center gap-1 text-xs text-zinc-700">
                        <input
                          checked={draft.removeItem}
                          onChange={(event) =>
                            updateDraft(item.id, { removeItem: event.target.checked })
                          }
                          type="checkbox"
                        />
                        Remove
                      </label>
                    </div>
                    {changed ? (
                      <p className="text-xs font-medium text-zinc-700">Changed</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-4 border-t border-zinc-200 pt-4">
        <label className="block text-sm font-medium text-zinc-700">
          Correction Reason
          <textarea
            className="mt-2 min-h-20 w-full rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-950"
            name="correction_reason"
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            {changedItemIds.length > 1
              ? "Save one changed line at a time."
              : changedItemIds.length === 1
                ? "Ready to save one line correction."
                : "Make one line change to enable save."}
          </p>
          <SaveButton canSave={canSave} />
        </div>
      </div>
    </form>
  );
}
