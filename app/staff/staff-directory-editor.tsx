"use client";

import {
  resetStaffPasscodeFormAction,
  updateStaffDirectoryBatchFormAction,
} from "@/app/staff/actions";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { StaffDirectoryMember } from "@/lib/staff";

type BadgeTone = "danger" | "dark" | "neutral" | "success" | "warning";

export type StaffDirectoryStatusBadge = {
  href?: string | null;
  label: string;
  tone: BadgeTone;
};

export type StaffDirectoryStatus = {
  booking: StaffDirectoryStatusBadge;
  payroll: StaffDirectoryStatusBadge;
};

type StaffDirectoryEditorProps = {
  activeStaff: StaffDirectoryMember[];
  addHref: string;
  canManageStaff: boolean;
  hasAnyStaff: boolean;
  hiddenStaff: StaffDirectoryMember[];
  query: string;
  statusByStaffId: Record<string, StaffDirectoryStatus>;
};

type RowState = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  displayName: string;
  email: string;
  firstName: string;
  id: string;
  initiallyHidden: boolean;
  isActive: boolean;
  jobTitle: string;
  lastName: string;
  onlineBookingEnabled: boolean;
  passcodeIsDefault: boolean;
  phone: string;
  postalCode: string;
  posEnabled: boolean;
  profileEnabled: boolean;
  state: string;
};

function clean(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function getInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part[0]?.toUpperCase()).join("") || "ST";
}

function getFullName(row: Pick<RowState, "firstName" | "lastName">) {
  return [row.firstName, row.lastName].filter(Boolean).join(" ");
}

function getAddress(row: RowState) {
  return [
    row.addressLine1,
    row.addressLine2,
    [row.city, row.state, row.postalCode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
}

function rowFromMember(
  member: StaffDirectoryMember,
  initiallyHidden: boolean,
): RowState {
  return {
    addressLine1: clean(member.address_line1),
    addressLine2: clean(member.address_line2),
    city: clean(member.city),
    displayName: clean(member.display_name),
    email: clean(member.email) || clean(member.connected_user?.email),
    firstName: clean(member.first_name),
    id: member.id,
    initiallyHidden,
    isActive: member.is_active,
    jobTitle: clean(member.job_title),
    lastName: clean(member.last_name),
    onlineBookingEnabled: member.online_booking_enabled,
    passcodeIsDefault: member.passcode_is_default === true,
    phone: clean(member.phone) || clean(member.connected_user?.phone),
    postalCode: clean(member.postal_code),
    posEnabled: member.pos_enabled,
    profileEnabled:
      member.owner_public_enabled ||
      member.salon_profile_content_posting_enabled,
    state: clean(member.state),
  };
}

function rowSignature(row: RowState) {
  return JSON.stringify({
    addressLine1: row.addressLine1.trim(),
    addressLine2: row.addressLine2.trim(),
    city: row.city.trim(),
    displayName: row.displayName.trim(),
    email: row.email.trim(),
    firstName: row.firstName.trim(),
    isActive: row.isActive,
    jobTitle: row.jobTitle.trim(),
    lastName: row.lastName.trim(),
    onlineBookingEnabled: row.onlineBookingEnabled,
    phone: row.phone.trim(),
    postalCode: row.postalCode.trim(),
    posEnabled: row.posEnabled,
    profileEnabled: row.profileEnabled,
    state: row.state.trim(),
  });
}

function classNames(...values: Array<false | null | string | undefined>) {
  return values.filter(Boolean).join(" ");
}

function fieldName(field: string, staffId: string) {
  return `${field}_${staffId}`;
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  const toneClass = {
    danger: "border-rose-200 bg-rose-50 text-rose-700",
    dark: "border-zinc-950 bg-zinc-950 text-white",
    neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
  }[tone];

  return (
    <span
      className={`inline-flex min-h-7 w-fit items-center rounded-md border px-2.5 py-1 text-xs font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}

function StatusBadgeLink({ status }: { status: StaffDirectoryStatusBadge }) {
  if (status.href) {
    return (
      <Link className="inline-flex" href={status.href}>
        <Badge tone={status.tone}>{status.label}</Badge>
      </Link>
    );
  }

  return <Badge tone={status.tone}>{status.label}</Badge>;
}

function EmptyState({
  addHref,
  canManageStaff,
  description,
  hasAnyStaff,
  title,
}: {
  addHref: string;
  canManageStaff: boolean;
  description?: string;
  hasAnyStaff: boolean;
  title?: string;
}) {
  const resolvedTitle = title ?? (hasAnyStaff ? "No matching staff" : "No staff yet");
  const resolvedDescription =
    description ??
    (hasAnyStaff
      ? "Try a different search."
      : "Create your first staff member for this salon.");

  return (
    <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
      <h2 className="text-lg font-semibold text-zinc-950">{resolvedTitle}</h2>
      <p className="mt-2 text-sm text-zinc-600">{resolvedDescription}</p>
      {!hasAnyStaff && canManageStaff ? (
        <Link
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          href={addHref}
        >
          + Add Staff
        </Link>
      ) : null}
    </div>
  );
}

function HiddenInputs({ rows }: { rows: RowState[] }) {
  return (
    <>
      {rows.map((row) => (
        <div hidden key={row.id}>
          <input name="staff_id" readOnly value={row.id} />
          <input
            name={fieldName("display_name", row.id)}
            readOnly
            value={row.displayName}
          />
          <input
            name={fieldName("full_name", row.id)}
            readOnly
            value={getFullName(row)}
          />
          <input name={fieldName("email", row.id)} readOnly value={row.email} />
          <input name={fieldName("phone", row.id)} readOnly value={row.phone} />
          <input
            name={fieldName("job_title", row.id)}
            readOnly
            value={row.jobTitle}
          />
          <input
            name={fieldName("address_line1", row.id)}
            readOnly
            value={row.addressLine1}
          />
          <input
            name={fieldName("address_line2", row.id)}
            readOnly
            value={row.addressLine2}
          />
          <input name={fieldName("city", row.id)} readOnly value={row.city} />
          <input name={fieldName("state", row.id)} readOnly value={row.state} />
          <input
            name={fieldName("postal_code", row.id)}
            readOnly
            value={row.postalCode}
          />
          {row.isActive ? (
            <input name={fieldName("is_active", row.id)} readOnly value="on" />
          ) : null}
          {row.onlineBookingEnabled ? (
            <input
              name={fieldName("online_booking_enabled", row.id)}
              readOnly
              value="on"
            />
          ) : null}
          {row.posEnabled ? (
            <input name={fieldName("pos_enabled", row.id)} readOnly value="on" />
          ) : null}
          {row.profileEnabled ? (
            <input
              name={fieldName("owner_public_enabled", row.id)}
              readOnly
              value="on"
            />
          ) : null}
        </div>
      ))}
    </>
  );
}

function AccessToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-8 items-center gap-2 text-sm font-medium text-zinc-800">
      <input
        checked={checked}
        className="size-4 rounded border-zinc-300"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function StaffRow({
  canManageStaff,
  dirty,
  editing,
  onToggleEditing,
  onUpdate,
  row,
  status,
}: {
  canManageStaff: boolean;
  dirty: boolean;
  editing: boolean;
  onToggleEditing: () => void;
  onUpdate: (patch: Partial<RowState>) => void;
  row: RowState;
  status: StaffDirectoryStatus;
}) {
  const fullName = getFullName(row);
  const address = getAddress(row);
  const disabled = !editing;
  const alerts = row.isActive
    ? [
        status.booking,
        status.payroll,
        row.passcodeIsDefault
          ? { label: "Default PIN", tone: "warning" as const }
          : null,
      ].filter((item): item is StaffDirectoryStatusBadge => Boolean(item?.label))
    : [];

  return (
    <tr className={classNames(!row.isActive && "bg-zinc-50/70", dirty && "bg-sky-50/50")}>
      <td className="px-4 py-4 align-top">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
            {getInitials(row.displayName)}
          </span>
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                autoComplete="nickname"
                className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-zinc-950 outline-none focus:border-zinc-300 focus:bg-white"
                onChange={(event) => onUpdate({ displayName: event.target.value })}
                value={row.displayName}
              />
            ) : (
              <p className="truncate px-1 py-0.5 text-sm font-semibold text-zinc-950">
                {row.displayName}
              </p>
            )}
            {editing ? (
              <div className="mt-1 grid grid-cols-2 gap-2">
                <input
                  autoComplete="given-name"
                  className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-600 outline-none focus:border-zinc-300 focus:bg-white"
                  onChange={(event) => onUpdate({ firstName: event.target.value })}
                  placeholder="First name"
                  value={row.firstName}
                />
                <input
                  autoComplete="family-name"
                  className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-600 outline-none focus:border-zinc-300 focus:bg-white"
                  onChange={(event) => onUpdate({ lastName: event.target.value })}
                  placeholder="Last name"
                  value={row.lastName}
                />
              </div>
            ) : (
              <p className="mt-0.5 truncate px-1 py-0.5 text-xs text-zinc-500">
                {fullName || "No full name"}
              </p>
            )}
            {editing ? (
              <input
                autoComplete="organization-title"
                className="mt-1 w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-600 outline-none focus:border-zinc-300 focus:bg-white"
                onChange={(event) => onUpdate({ jobTitle: event.target.value })}
                placeholder="Role"
                value={row.jobTitle}
              />
            ) : (
              <p className="mt-0.5 truncate px-1 py-0.5 text-xs text-zinc-500">
                {row.jobTitle || "No role"}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-4 align-top">
        {editing ? (
          <div className="grid gap-1.5">
            <input
              autoComplete="email"
              className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm text-zinc-700 outline-none focus:border-zinc-300 focus:bg-white"
              onChange={(event) => onUpdate({ email: event.target.value })}
              placeholder="Email"
              value={row.email}
            />
            <input
              autoComplete="tel"
              className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm text-zinc-700 outline-none focus:border-zinc-300 focus:bg-white"
              onChange={(event) => onUpdate({ phone: event.target.value })}
              placeholder="Phone"
              value={row.phone}
            />
            <input
              autoComplete="address-line1"
              className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white"
              onChange={(event) => onUpdate({ addressLine1: event.target.value })}
              placeholder="Address line 1"
              value={row.addressLine1}
            />
            <input
              autoComplete="address-line2"
              className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white"
              onChange={(event) => onUpdate({ addressLine2: event.target.value })}
              placeholder="Address line 2"
              value={row.addressLine2}
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                autoComplete="address-level2"
                className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white"
                onChange={(event) => onUpdate({ city: event.target.value })}
                placeholder="City"
                value={row.city}
              />
              <input
                autoComplete="address-level1"
                className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white"
                onChange={(event) => onUpdate({ state: event.target.value })}
                placeholder="State"
                value={row.state}
              />
              <input
                autoComplete="postal-code"
                className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white"
                onChange={(event) => onUpdate({ postalCode: event.target.value })}
                placeholder="ZIP"
                value={row.postalCode}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-1 text-sm text-zinc-700">
            <span>{row.email || "No email"}</span>
            <span>{row.phone || "No phone"}</span>
            <span className="mt-1 truncate text-xs text-zinc-500">
              {address || "No address"}
            </span>
          </div>
        )}
      </td>
      <td className="px-4 py-4 align-top">
        <div className="grid gap-1">
          <AccessToggle
            checked={row.isActive}
            disabled={disabled}
            label="Enable staff"
            onChange={(isActive) =>
              onUpdate({
                isActive,
                posEnabled: isActive ? row.posEnabled : false,
                profileEnabled: isActive ? row.profileEnabled : false,
              })
            }
          />
          <AccessToggle
            checked={row.profileEnabled}
            disabled={disabled || !row.isActive}
            label="Enable profile"
            onChange={(profileEnabled) => onUpdate({ profileEnabled })}
          />
          <AccessToggle
            checked={row.posEnabled}
            disabled={disabled || !row.isActive}
            label="Enable POS"
            onChange={(posEnabled) => onUpdate({ posEnabled })}
          />
        </div>
      </td>
      <td className="px-4 py-4 align-top">
        <div className="grid gap-2">
          {alerts.length > 0 ? (
            alerts.map((alert) => (
              <StatusBadgeLink key={alert.label} status={alert} />
            ))
          ) : (
            <span className="text-xs text-zinc-500">No alerts</span>
          )}
        </div>
      </td>
      <td className="px-4 py-4 align-top">
        {canManageStaff ? (
          <div className="grid gap-2">
            <button
              className={classNames(
                "inline-flex min-h-9 items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium",
                editing
                  ? "bg-zinc-950 text-white"
                  : "border border-zinc-300 bg-white text-zinc-950",
              )}
              onClick={onToggleEditing}
              type="button"
            >
              {editing ? "Done" : "Edit"}
            </button>
            {editing ? (
              <div className="grid gap-1.5">
                <input
                  autoComplete="new-password"
                  className="min-h-9 w-24 rounded-md border border-zinc-300 px-2 text-xs"
                  inputMode="numeric"
                  name={`new_passcode_${row.id}`}
                  pattern="[0-9]{4,8}"
                  placeholder="4-8 digits"
                  type="password"
                />
                <button
                  className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-950"
                  formAction={resetStaffPasscodeFormAction}
                  name="reset_staff_id"
                  type="submit"
                  value={row.id}
                >
                  Reset PIN
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function StaffTable({
  canManageStaff,
  dirtyIds,
  editingIds,
  onToggleEditing,
  onUpdate,
  rows,
  statusByStaffId,
}: {
  canManageStaff: boolean;
  dirtyIds: Set<string>;
  editingIds: Set<string>;
  onToggleEditing: (staffId: string) => void;
  onUpdate: (staffId: string, patch: Partial<RowState>) => void;
  rows: RowState[];
  statusByStaffId: Record<string, StaffDirectoryStatus>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
      <table className="w-full min-w-[900px] divide-y divide-zinc-200 text-left text-sm">
        <thead className="bg-zinc-50 text-xs font-medium uppercase text-zinc-500">
          <tr>
            <th className="w-[32%] px-4 py-3" scope="col">
              Staff profile
            </th>
            <th className="w-[28%] px-4 py-3" scope="col">
              Contact
            </th>
            <th className="w-[16%] px-4 py-3" scope="col">
              Access
            </th>
            <th className="w-[16%] px-4 py-3" scope="col">
              Status
            </th>
            <th className="w-[8%] px-4 py-3" scope="col">
              Edit
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <StaffRow
              canManageStaff={canManageStaff}
              dirty={dirtyIds.has(row.id)}
              editing={editingIds.has(row.id)}
              key={row.id}
              onToggleEditing={() => onToggleEditing(row.id)}
              onUpdate={(patch) => onUpdate(row.id, patch)}
              row={row}
              status={
                statusByStaffId[row.id] ?? {
                  booking: { label: "", tone: "neutral" },
                  payroll: { label: "", tone: "neutral" },
                }
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StaffDirectoryEditor({
  activeStaff,
  addHref,
  canManageStaff,
  hasAnyStaff,
  hiddenStaff,
  query,
  statusByStaffId,
}: StaffDirectoryEditorProps) {
  const initialRows = useMemo(
    () => [
      ...activeStaff.map((member) => rowFromMember(member, false)),
      ...hiddenStaff.map((member) => rowFromMember(member, true)),
    ],
    [activeStaff, hiddenStaff],
  );
  const initialSignatures = useMemo(
    () =>
      new Map(initialRows.map((row) => [row.id, rowSignature(row)] as const)),
    [initialRows],
  );
  const [rows, setRows] = useState(initialRows);
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const activeRows = rows.filter((row) => !row.initiallyHidden);
  const hiddenRows = rows.filter((row) => row.initiallyHidden);
  const dirtyIds = new Set(
    rows
      .filter((row) => rowSignature(row) !== initialSignatures.get(row.id))
      .map((row) => row.id),
  );
  const hasDirtyRows = dirtyIds.size > 0;
  const hasVisibleRows = activeRows.length > 0 || hiddenRows.length > 0;

  function updateRow(staffId: string, patch: Partial<RowState>) {
    setRows((current) =>
      current.map((row) => (row.id === staffId ? { ...row, ...patch } : row)),
    );
  }

  function toggleEditing(staffId: string) {
    setEditingIds((current) => {
      const next = new Set(current);

      if (next.has(staffId)) {
        next.delete(staffId);
      } else {
        next.add(staffId);
      }

      return next;
    });
  }

  if (!hasVisibleRows) {
    return (
      <EmptyState
        addHref={addHref}
        canManageStaff={canManageStaff}
        hasAnyStaff={hasAnyStaff}
      />
    );
  }

  return (
    <form
      action={updateStaffDirectoryBatchFormAction}
      className="mt-4 grid gap-4"
    >
      <input name="q" type="hidden" value={query} />
      <HiddenInputs rows={rows} />
      {activeRows.length > 0 ? (
        <StaffTable
          canManageStaff={canManageStaff}
          dirtyIds={dirtyIds}
          editingIds={editingIds}
          onToggleEditing={toggleEditing}
          onUpdate={updateRow}
          rows={activeRows}
          statusByStaffId={statusByStaffId}
        />
      ) : (
        <EmptyState
          addHref={addHref}
          canManageStaff={canManageStaff}
          description={
            hiddenRows.length > 0
              ? "Open the hidden staff list below to restore staff."
              : undefined
          }
          hasAnyStaff={hasAnyStaff}
          title={hiddenRows.length > 0 ? "No enabled staff" : undefined}
        />
      )}
      <details className="rounded-lg border border-zinc-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-950">
          Hidden staff list ({hiddenRows.length})
        </summary>
        <div className="border-t border-zinc-200 p-4">
          {hiddenRows.length > 0 ? (
            <StaffTable
              canManageStaff={canManageStaff}
              dirtyIds={dirtyIds}
              editingIds={editingIds}
              onToggleEditing={toggleEditing}
              onUpdate={updateRow}
              rows={hiddenRows}
              statusByStaffId={statusByStaffId}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
              No hidden staff.
            </p>
          )}
        </div>
      </details>
      {canManageStaff ? (
        <div className="flex items-center justify-end gap-3">
          {hasDirtyRows ? (
            <span className="text-xs font-medium text-sky-700">
              Unsaved changes
            </span>
          ) : (
            <span className="text-xs text-zinc-500">Saved</span>
          )}
          <button
            className={classNames(
              "inline-flex min-h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition",
              hasDirtyRows
                ? "bg-zinc-950 text-white"
                : "border border-zinc-300 bg-white text-zinc-500",
            )}
            disabled={!hasDirtyRows}
            type="submit"
          >
            Save staff changes
          </button>
        </div>
      ) : null}
    </form>
  );
}
