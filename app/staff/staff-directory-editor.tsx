"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { SubmitButton } from "@/components/submit-button";

import {
  resetStaffPasscodeFormAction,
  updateStaffDirectoryBatchFormAction,
} from "@/app/staff/actions";
import Link from "next/link";
import { DeleteUnusedButton } from "@/app/settings/delete-unused-button";
import { searchTextMatches } from "@/lib/search-normalization";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { StaffDirectoryMember } from "@/lib/staff";

type BadgeTone = "danger" | "dark" | "neutral" | "success" | "warning";

export type StaffDirectoryStatusBadge = {
  href?: string | null;
  label: string;
  note?: string;
  tone: BadgeTone;
};

export type StaffDirectoryStatus = {
  booking: StaffDirectoryStatusBadge;
  payroll: StaffDirectoryStatusBadge;
};

type StaffDirectoryEditorProps = {
  toolbarActions?: ReactNode;
  activeStaff: StaffDirectoryMember[];
  addHref: string;
  canManageStaff: boolean;
  hasAnyStaff: boolean;
  hiddenStaff: StaffDirectoryMember[];
  profileHrefByStaffId: Record<string, string>;
  query: string;
  statusByStaffId: Record<string, StaffDirectoryStatus>;
};

type RowState = {
  addressLine1: string;
  addressLine2: string;
  avatarUrl: string | null;
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
  postingEnabled: boolean;
  posEnabled: boolean;
  state: string;
};

function clean(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);

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
    avatarUrl: member.staff_profile_avatar_url,
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
    postingEnabled: member.salon_profile_content_posting_enabled,
    posEnabled: member.pos_enabled,
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
    postingEnabled: row.postingEnabled,
    posEnabled: row.posEnabled,
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
      className={`inline-flex min-h-6 w-fit items-center rounded-md border px-2 py-0.5 text-[11px] font-medium md:min-h-7 md:px-2.5 md:py-1 md:text-xs ${toneClass}`}
    >
      {children}
    </span>
  );
}

function StatusBadgeLink({ status }: { status: StaffDirectoryStatusBadge }) {
  if (status.href) {
    return (
      <Link className="inline-flex" href={status.href}>
        <Badge tone={status.tone}><WorkspaceText text={status.label} /></Badge>
      </Link>
    );
  }

  return <Badge tone={status.tone}><WorkspaceText text={status.label} /></Badge>;
}

function StaffStatusAlert({ status }: { status: StaffDirectoryStatusBadge }) {
  return (
    <div className="grid gap-1">
      <StatusBadgeLink status={status} />
      {status.note ? (
        <span className="text-xs text-zinc-500"><WorkspaceText text={status.note} /></span>
      ) : null}
    </div>
  );
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
  const resolvedTitle =
    title ?? (hasAnyStaff ? "No matching staff" : "No staff yet");
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
          <WorkspaceText text="+ Add Staff" />
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
            <input
              name={fieldName("pos_enabled", row.id)}
              readOnly
              value="on"
            />
          ) : null}
          {row.postingEnabled ? (
            <input
              name={fieldName("salon_profile_content_posting_enabled", row.id)}
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
      <WorkspaceText text={label} />
    </label>
  );
}

function subscribeMobileLayout(onChange: () => void) {
  const media = window.matchMedia("(max-width: 767px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getMobileLayout() {
  return window.matchMedia("(max-width: 767px)").matches;
}

function DesktopStaffRow({
  canManageStaff,
  dirty,
  editing,
  onToggleEditing,
  onUpdate,
  profileHref,
  row,
  status,
}: {
  canManageStaff: boolean;
  dirty: boolean;
  editing: boolean;
  onToggleEditing: () => void;
  onUpdate: (patch: Partial<RowState>) => void;
  profileHref?: string;
  row: RowState;
  status: StaffDirectoryStatus;
}) {
  const __vt = useWorkspaceTranslation();

  const fullName = getFullName(row);
  const address = getAddress(row);
  const disabled = !editing;
  const alerts = row.isActive
    ? [
        status.booking,
        status.payroll,
        row.passcodeIsDefault
          ? {
              label: "Default PIN",
              note: "Default PIN: 1234",
              tone: "warning" as const,
            }
          : null,
      ].filter((item): item is StaffDirectoryStatusBadge =>
        Boolean(item?.label),
      )
    : [];

  return (
    <tr
      className={classNames(
        !row.isActive && "bg-zinc-50/70",
        dirty && "bg-sky-50/50",
      )}
    >
      <td className="px-4 py-3 align-top">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
            {row.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={__vt("")}
                className="h-full w-full rounded-full object-cover"
                src={row.avatarUrl}
              />
            ) : (
              getInitials(row.displayName)
            )}
          </span>
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                autoComplete="nickname"
                className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-zinc-950 outline-none focus:border-zinc-300 focus:bg-white"
                onChange={(event) =>
                  onUpdate({ displayName: event.target.value })
                }
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
                  onChange={(event) =>
                    onUpdate({ firstName: event.target.value })
                  }
                  placeholder={__vt("First name")}
                  value={row.firstName}
                />
                <input
                  autoComplete="family-name"
                  className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-600 outline-none focus:border-zinc-300 focus:bg-white"
                  onChange={(event) =>
                    onUpdate({ lastName: event.target.value })
                  }
                  placeholder={__vt("Last name")}
                  value={row.lastName}
                />
              </div>
            ) : (
              <p className="mt-0.5 truncate px-1 py-0.5 text-xs text-zinc-500">
                <WorkspaceText text={fullName || "No full name"} />
              </p>
            )}
            {editing ? (
              <input
                autoComplete="organization-title"
                className="mt-1 w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-600 outline-none focus:border-zinc-300 focus:bg-white"
                onChange={(event) => onUpdate({ jobTitle: event.target.value })}
                placeholder={__vt("Role")}
                value={row.jobTitle}
              />
            ) : (
              <p className="mt-0.5 truncate px-1 py-0.5 text-xs text-zinc-500">
                <WorkspaceText text={row.jobTitle || "No role"} />
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        {editing ? (
          <div className="grid gap-1.5">
            <input
              autoComplete="email"
              className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm text-zinc-700 outline-none focus:border-zinc-300 focus:bg-white"
              onChange={(event) => onUpdate({ email: event.target.value })}
              placeholder={__vt("Email")}
              value={row.email}
            />
            <input
              autoComplete="tel"
              className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-sm text-zinc-700 outline-none focus:border-zinc-300 focus:bg-white"
              onChange={(event) => onUpdate({ phone: event.target.value })}
              placeholder={__vt("Phone")}
              value={row.phone}
            />
            <input
              autoComplete="address-line1"
              className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white"
              onChange={(event) =>
                onUpdate({ addressLine1: event.target.value })
              }
              placeholder={__vt("Address line 1")}
              value={row.addressLine1}
            />
            <input
              autoComplete="address-line2"
              className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white"
              onChange={(event) =>
                onUpdate({ addressLine2: event.target.value })
              }
              placeholder={__vt("Address line 2")}
              value={row.addressLine2}
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                autoComplete="address-level2"
                className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white"
                onChange={(event) => onUpdate({ city: event.target.value })}
                placeholder={__vt("City")}
                value={row.city}
              />
              <input
                autoComplete="address-level1"
                className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white"
                onChange={(event) => onUpdate({ state: event.target.value })}
                placeholder={__vt("State")}
                value={row.state}
              />
              <input
                autoComplete="postal-code"
                className="min-h-8 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs text-zinc-500 outline-none focus:border-zinc-300 focus:bg-white"
                onChange={(event) =>
                  onUpdate({ postalCode: event.target.value })
                }
                placeholder={__vt("ZIP")}
                value={row.postalCode}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-1 text-sm text-zinc-700">
            <span><WorkspaceText text={row.email || "No email"} /></span>
            <span><WorkspaceText text={row.phone || "No phone"} /></span>
            <span className="mt-1 truncate text-xs text-zinc-500">
              <WorkspaceText text={address || "No address"} />
            </span>
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="grid gap-1">
          <AccessToggle
            checked={row.isActive}
            disabled={disabled}
            label={__vt("Enable staff")}
            onChange={(isActive) =>
              onUpdate({
                isActive,
                posEnabled: isActive ? row.posEnabled : false,
                onlineBookingEnabled: isActive
                  ? row.onlineBookingEnabled
                  : false,
                postingEnabled: isActive ? row.postingEnabled : false,
              })
            }
          />
          <AccessToggle
            checked={row.onlineBookingEnabled}
            disabled={disabled || !row.isActive}
            label={__vt("Online booking")}
            onChange={(onlineBookingEnabled) =>
              onUpdate({ onlineBookingEnabled })
            }
          />
          <AccessToggle
            checked={row.posEnabled}
            disabled={disabled || !row.isActive}
            label={__vt("Enable POS")}
            onChange={(posEnabled) => onUpdate({ posEnabled })}
          />
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="grid gap-2">
          {alerts.length > 0 ? (
            alerts.map((alert) => (
              <StaffStatusAlert key={alert.label} status={alert} />
            ))
          ) : (
            <span className="text-xs text-zinc-500"><WorkspaceText text="No alerts" /></span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 align-top">
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
              {editing ? <WorkspaceText text="Done" /> : <WorkspaceText text="Edit" />}
            </button>
            {profileHref ? (
              <Link
                className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-950"
                href={profileHref}
              >
                <WorkspaceText text="Profile" />
              </Link>
            ) : null}
            {editing ? (
              <div className="grid gap-1.5">
                <input
                  autoComplete="new-password"
                  className="min-h-9 w-24 rounded-md border border-zinc-300 px-2 text-xs"
                  inputMode="numeric"
                  name={`new_passcode_${row.id}`}
                  pattern="[0-9]{4,8}"
                  placeholder={__vt("4-8 digits")}
                  type="password"
                />
                <SubmitButton pendingLabel="Processing…"
                  className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-950"
                  formAction={resetStaffPasscodeFormAction}
                  name="reset_staff_id"
                  type="submit"
                  value={row.id}
                >
                  <WorkspaceText text="Reset PIN" />
                </SubmitButton>
                <DeleteUnusedButton kind="staff" id={row.id} name={fullName} disabled={dirty} />
              </div>
            ) : null}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function StaffRow({
  canManageStaff,
  dirty,
  editing,
  onToggleEditing,
  onUpdate,
  profileHref,
  row,
  status,
}: {
  canManageStaff: boolean;
  dirty: boolean;
  editing: boolean;
  onToggleEditing: () => void;
  onUpdate: (patch: Partial<RowState>) => void;
  profileHref?: string;
  row: RowState;
  status: StaffDirectoryStatus;
}) {
  const __vt = useWorkspaceTranslation();

  const isMobile = useSyncExternalStore(subscribeMobileLayout, getMobileLayout, () => false);
  if (!isMobile) {
    return <DesktopStaffRow canManageStaff={canManageStaff} dirty={dirty} editing={editing}
      onToggleEditing={onToggleEditing} onUpdate={onUpdate} profileHref={profileHref} row={row} status={status} />;
  }
  const fullName = getFullName(row);
  const address = getAddress(row);
  const disabled = !editing;
  const alerts = row.isActive
    ? [
        status.booking,
        status.payroll,
        row.passcodeIsDefault
          ? {
              label: "Default PIN",
              note: "Default PIN: 1234",
              tone: "warning" as const,
            }
          : null,
      ].filter((item): item is StaffDirectoryStatusBadge =>
        Boolean(item?.label),
      )
    : [];

  const field = (key: keyof RowState, label: string, autoComplete?: string, type = "text") => (
    <label className="grid min-w-0 gap-1 text-xs font-medium text-zinc-600">
      <WorkspaceText text={label} />
      <input
        autoComplete={autoComplete}
        className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
        onChange={(event) => onUpdate({ [key]: event.target.value })}
        type={type}
        value={String(row[key] ?? "")}
      />
    </label>
  );
  const buttonClass = "inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50";

  return (
    <>
      <tr className={classNames(
        "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 p-3 lg:table-row lg:p-0",
        !row.isActive && "bg-zinc-50/70",
        dirty && "bg-sky-50/50",
      )}>
        <td className="min-w-0 lg:px-4 lg:py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-teal-50 text-sm font-semibold text-teal-800">
              {row.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={__vt("")} className="h-full w-full object-cover" src={row.avatarUrl} />
              ) : getInitials(row.displayName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-950"><WorkspaceText text={row.displayName || fullName || "Staff member"} /></p>
              <p className="mt-0.5 truncate text-xs text-zinc-500"><WorkspaceText text={row.jobTitle || row.phone || row.email || (row.isActive ? "Staff member" : "Disabled staff")} /></p>
            </div>
          </div>
        </td>
        <td className="hidden min-w-0 lg:table-cell lg:px-4 lg:py-3">
          <p className="break-all text-xs text-zinc-700">{row.phone || "—"}</p>
          {row.email ? <p className="mt-1 break-all text-xs text-zinc-500">{row.email}</p> : null}
          {address ? <p className="mt-1 text-xs text-zinc-500">{address}</p> : null}
        </td>
        <td className="hidden lg:table-cell lg:px-4 lg:py-3">
          <div className="flex flex-wrap gap-1">
            <Badge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? <WorkspaceText text="Active" /> : <WorkspaceText text="Disabled" />}</Badge>
            {row.isActive && row.posEnabled ? <Badge><WorkspaceText text="POS" /></Badge> : null}
            {row.isActive && row.onlineBookingEnabled ? <Badge><WorkspaceText text="Booking" /></Badge> : null}
          </div>
        </td>
        <td className={classNames("col-span-2 row-start-2 min-w-0 lg:table-cell lg:px-4 lg:py-3", !alerts.length && "hidden")}>
          <div className="flex flex-wrap items-center gap-1.5">
            {alerts.map((alert) => <span key={alert.label} title={__vt(alert.note)}><StatusBadgeLink status={alert} /></span>)}
          </div>
        </td>
        <td className="col-start-2 row-start-1 lg:px-4 lg:py-3">
          {canManageStaff ? <div className="flex items-center justify-end gap-1.5">
            {profileHref ? <Link className={buttonClass} href={profileHref}><WorkspaceText text="Profile" /></Link> : null}
            <button
              aria-expanded={editing}
              aria-controls={`staff-edit-${row.id}`}
              className={classNames(buttonClass, editing && "!border-teal-700 !bg-teal-700 !text-white")}
              onClick={onToggleEditing}
              type="button"
            >{editing ? <WorkspaceText text="Done" /> : <WorkspaceText text="Edit" />}</button>
          </div> : null}
        </td>
      </tr>
      {editing ? <tr className="block bg-zinc-50/70 lg:table-row">
        <td colSpan={5} className="block p-3 lg:table-cell lg:p-4" id={`staff-edit-${row.id}`}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(220px,0.8fr)]">
            <section className="grid content-start gap-3" aria-label={__vt("Staff information")}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500"><WorkspaceText text="Staff information" /></h3>
              {field("displayName", "Display name", "nickname")}
              <div className="grid grid-cols-2 gap-2">{field("firstName", "First name", "given-name")}{field("lastName", "Last name", "family-name")}</div>
              {field("jobTitle", "Role", "organization-title")}
              <div className="grid grid-cols-2 gap-2">{field("phone", "Phone", "tel", "tel")}{field("email", "Email", "email", "email")}</div>
              <details className="rounded-lg border border-zinc-200 bg-white">
                <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-zinc-600"><WorkspaceText text="Address" /><WorkspaceText text={address ? ` · ${address}` : " · Optional"} /></summary>
                <div className="grid gap-2 border-t border-zinc-100 p-3">
                  {field("addressLine1", "Address line 1", "address-line1")}
                  {field("addressLine2", "Address line 2", "address-line2")}
                  <div className="grid grid-cols-3 gap-2">{field("city", "City", "address-level2")}{field("state", "State", "address-level1")}{field("postalCode", "ZIP", "postal-code")}</div>
                </div>
              </details>
            </section>
            <section className="grid content-start gap-3" aria-label={__vt("Staff access")}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500"><WorkspaceText text="Access & permissions" /></h3>
              <div className="grid gap-1 rounded-lg border border-zinc-200 bg-white p-3">
                <AccessToggle checked={row.isActive} disabled={disabled} label={__vt("Enable staff")} onChange={(isActive) => onUpdate({ isActive, posEnabled: isActive ? row.posEnabled : false, onlineBookingEnabled: isActive ? row.onlineBookingEnabled : false, postingEnabled: isActive ? row.postingEnabled : false })} />
                <AccessToggle checked={row.onlineBookingEnabled} disabled={disabled || !row.isActive} label={__vt("Online booking")} onChange={(onlineBookingEnabled) => onUpdate({ onlineBookingEnabled })} />
                <AccessToggle checked={row.posEnabled} disabled={disabled || !row.isActive} label={__vt("Enable POS")} onChange={(posEnabled) => onUpdate({ posEnabled })} />
              </div>
              {alerts.length ? <div className="grid gap-2">{alerts.map((alert) => <StaffStatusAlert key={alert.label} status={alert} />)}</div> : null}
            </section>
            <section className="grid content-start gap-3" aria-label={__vt("Staff security")}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500"><WorkspaceText text="Security" /></h3>
              <div className="rounded-lg border border-zinc-200 bg-white p-3">
                <label className="grid gap-1 text-xs font-medium text-zinc-600" htmlFor={`pin-${row.id}`}><WorkspaceText text="New PIN" /></label>
                <div className="mt-2 flex gap-2">
                  <input id={`pin-${row.id}`} autoComplete="new-password" className="h-10 min-w-0 w-full rounded-lg border border-zinc-200 px-3 text-sm" inputMode="numeric" name={`new_passcode_${row.id}`} pattern="[0-9]{4,8}" placeholder={__vt("4–8 digits")} type="password" />
                  <SubmitButton pendingLabel="Processing…" className={`${buttonClass} shrink-0`} formAction={resetStaffPasscodeFormAction} name="reset_staff_id" type="submit" value={row.id}><WorkspaceText text="Reset PIN" /></SubmitButton>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-rose-100 bg-white px-3 py-1">
                <span className="text-xs text-zinc-500"><WorkspaceText text="Remove unused staff" /></span>
                <DeleteUnusedButton kind="staff" id={row.id} name={fullName || row.displayName} disabled={dirty} />
              </div>
            </section>
          </div>
          <p className="mt-3 text-xs text-zinc-500"><WorkspaceText text={dirty ? "Changes are ready to save. Use Save staff changes below." : "Update details and permissions, then save your changes."} /></p>
        </td>
      </tr> : null}
    </>
  );
}

function StaffTable({
  canManageStaff,
  dirtyIds,
  editingIds,
  onToggleEditing,
  onUpdate,
  profileHrefByStaffId,
  rows,
  statusByStaffId,
}: {
  canManageStaff: boolean;
  dirtyIds: Set<string>;
  editingIds: Set<string>;
  onToggleEditing: (staffId: string) => void;
  onUpdate: (staffId: string, patch: Partial<RowState>) => void;
  profileHrefByStaffId: Record<string, string>;
  rows: RowState[];
  statusByStaffId: Record<string, StaffDirectoryStatus>;
}) {
  return (
    <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="block w-full divide-y divide-zinc-200 text-left text-sm md:table md:min-w-[900px]">
        <thead className="hidden bg-zinc-50 text-xs font-medium uppercase text-zinc-500 md:table-header-group">
          <tr>
            <th className="w-[32%] px-4 py-3" scope="col">
              <WorkspaceText text="Staff profile" />
            </th>
            <th className="w-[28%] px-4 py-3" scope="col">
              <WorkspaceText text="Contact" />
            </th>
            <th className="w-[16%] px-4 py-3" scope="col">
              <WorkspaceText text="Access" />
            </th>
            <th className="w-[16%] px-4 py-3" scope="col">
              <WorkspaceText text="Status" />
            </th>
            <th className="w-[8%] px-4 py-3" scope="col">
              <WorkspaceText text="Edit" />
            </th>
          </tr>
        </thead>
        <tbody className="block divide-y divide-zinc-100 md:table-row-group">
          {rows.map((row) => (
            <StaffRow
              canManageStaff={canManageStaff}
              dirty={dirtyIds.has(row.id)}
              editing={editingIds.has(row.id)}
              key={row.id}
              onToggleEditing={() => onToggleEditing(row.id)}
              onUpdate={(patch) => onUpdate(row.id, patch)}
              profileHref={
                canManageStaff ? profileHrefByStaffId[row.id] : undefined
              }
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
  toolbarActions,
  activeStaff,
  addHref,
  canManageStaff,
  hasAnyStaff,
  hiddenStaff,
  profileHrefByStaffId,
  query,
  statusByStaffId,
}: StaffDirectoryEditorProps) {
  const __vt = useWorkspaceTranslation();

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
  const [search, setSearch] = useState(query);
  const matchingIds = new Set(
    [...activeStaff, ...hiddenStaff]
      .filter((member) =>
        searchTextMatches(
          [
            member.display_name,
            member.first_name,
            member.last_name,
            member.email,
            member.phone,
            member.job_title,
            member.connected_user?.display_name,
            member.connected_user?.email,
            member.connected_user?.phone,
          ],
          search,
        ),
      )
      .map((member) => member.id),
  );
  const activeRows = rows.filter(
    (row) => !row.initiallyHidden && matchingIds.has(row.id),
  );
  const hiddenRows = rows.filter(
    (row) => row.initiallyHidden && matchingIds.has(row.id),
  );
  const searchProfileHrefs = Object.fromEntries(
    Object.entries(profileHrefByStaffId).map(([id, href]) => {
      const [path, queryString] = href.split("?");
      const params = new URLSearchParams(queryString);
      if (search.trim()) params.set("q", search.trim());
      else params.delete("q");
      return [id, `${path}?${params}`];
    }),
  );
  const dirtyIds = new Set(
    rows
      .filter((row) => rowSignature(row) !== initialSignatures.get(row.id))
      .map((row) => row.id),
  );
  const hasDirtyRows = dirtyIds.size > 0;

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

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3 md:hidden"><h1 className="text-lg font-semibold tracking-tight text-zinc-950"><WorkspaceText text="Staff" /></h1><span className="text-xs text-zinc-500">{activeStaff.length} <WorkspaceText text="active ·" /> {hiddenStaff.length} <WorkspaceText text="hidden" /></span></div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 md:flex-nowrap border-b border-zinc-200 pb-3">
        <div className="relative min-w-0 basis-full sm:basis-auto sm:flex-1 sm:max-w-sm md:flex-1">
          <label className="sr-only" htmlFor="staff-search"><WorkspaceText text="Search staff" /></label>
          <input id="staff-search" type="search"
            className="h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white pl-3 pr-8 text-sm outline-none focus:border-teal-600"
            placeholder={__vt("Search staff…")} value={search} onChange={(event) => setSearch(event.target.value)} />
          {search ? <button type="button" aria-label={__vt("Clear staff search")} className="absolute inset-y-0 right-0 w-8 text-zinc-500" onClick={() => setSearch("")}>×</button> : null}
        </div>
        {toolbarActions}
      </div>
      {search ? (
        <p role="status" className="mt-2 text-xs text-zinc-500">
          {matchingIds.size} <WorkspaceText text="matching staff" />
        </p>
      ) : null}
      <form
        action={updateStaffDirectoryBatchFormAction}
        className={classNames("mt-3 min-w-0 grid gap-3", canManageStaff && hasDirtyRows && "pb-24 md:pb-0")}
      >
        <input name="q" type="hidden" value={search} />
        <HiddenInputs rows={rows.filter(row => dirtyIds.has(row.id))} />
        {activeRows.length > 0 ? (
          <StaffTable
            canManageStaff={canManageStaff}
            dirtyIds={dirtyIds}
            editingIds={editingIds}
            onToggleEditing={toggleEditing}
            onUpdate={updateRow}
            profileHrefByStaffId={searchProfileHrefs}
            rows={activeRows}
            statusByStaffId={statusByStaffId}
          />
        ) : (
          <EmptyState
            addHref={addHref}
            canManageStaff={canManageStaff}
            description={__vt(hiddenRows.length > 0
                ? "Open the hidden staff list below to restore staff."
                : undefined)}
            hasAnyStaff={hasAnyStaff}
            title={__vt(hiddenRows.length > 0 ? "No enabled staff" : undefined)}
          />
        )}
        {hiddenStaff.length > 0 ? <details
          open={search.trim() ? true : undefined}
          className="rounded-lg border border-zinc-200 bg-white"
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-950">
            <WorkspaceText text="Hidden staff list (" />{hiddenRows.length})
          </summary>
          <div className="border-t border-zinc-200 p-4">
            {hiddenRows.length > 0 ? (
              <StaffTable
                canManageStaff={canManageStaff}
                dirtyIds={dirtyIds}
                editingIds={editingIds}
                onToggleEditing={toggleEditing}
                onUpdate={updateRow}
                profileHrefByStaffId={searchProfileHrefs}
                rows={hiddenRows}
                statusByStaffId={statusByStaffId}
              />
            ) : (
              <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
                <WorkspaceText text="No hidden staff." />
              </p>
            )}
          </div>
        </details> : null}
        {canManageStaff && hasDirtyRows ? (
          <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-white p-3 shadow-lg md:static md:justify-end md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none">
            {hasDirtyRows ? (
              <span className="text-xs font-medium text-sky-700">
                <WorkspaceText text="Unsaved changes" />
              </span>
            ) : (
              <span className="text-xs text-zinc-500"><WorkspaceText text="Saved" /></span>
            )}
            <SubmitButton pendingLabel="Saving…"
              className={classNames(
                "inline-flex min-h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition",
                hasDirtyRows
                  ? "bg-zinc-950 text-white"
                  : "border border-zinc-300 bg-white text-zinc-500",
              )}
              disabled={!hasDirtyRows}
              type="submit"
            >
              <WorkspaceText text="Save staff changes" />
            </SubmitButton>
          </div>
        ) : null}
      </form>
    </>
  );
}
