"use client";

import { staffHasPersonalAccount } from "@/lib/staff-legal-name";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { SubmitButton } from "@/components/submit-button";

import {
  resetStaffPasscodeFormAction,
  saveStaffDirectoryEntryAction,
} from "@/app/staff/actions";
import Link from "next/link";
import { DeleteUnusedButton } from "@/app/settings/delete-unused-button";
import { searchTextMatches } from "@/lib/search-normalization";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
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
  personalLegalName: boolean;
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
    personalLegalName: staffHasPersonalAccount(member),
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
          <input name={fieldName("first_name", row.id)} readOnly value={row.firstName} />
          <input name={fieldName("last_name", row.id)} readOnly value={row.lastName} />
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

function AccessToggle({ checked, disabled, label, onChange }: {
  checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void;
}) {
  return <label className="flex min-h-11 items-center gap-1 text-xs text-zinc-800">
    <WorkspaceText text={label} />
    <input checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)}
      className="relative h-[18px] w-6 shrink-0 appearance-none rounded-full bg-zinc-300 before:absolute before:left-0.5 before:top-0.5 before:size-3.5 before:rounded-full before:bg-white checked:bg-teal-700 checked:before:translate-x-1.5 disabled:opacity-40" role="switch" type="checkbox" />
  </label>;
}

function StaffEditFields({ children, onPendingChange }: { children: ReactNode; onPendingChange: (pending: boolean) => void }) {
  const { pending } = useFormStatus();
  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);
  return <fieldset disabled={pending} className="grid min-w-0 gap-1 border-0 p-0">{children}</fieldset>;
}

function StaffRow({ busy, onPendingChange, canManageStaff, dirty, editing, onToggleEditing, onCancel, onSaved, onUpdate, profileHref, query, row, status }: {
  busy: boolean; onPendingChange: (pending: boolean) => void;
  canManageStaff: boolean; dirty: boolean; editing: boolean; onToggleEditing: () => void;
  onCancel: () => void; onSaved: () => void; onUpdate: (patch: Partial<RowState>) => void;
  profileHref?: string; query: string; row: RowState; status: StaffDirectoryStatus;
}) {
  const __vt = useWorkspaceTranslation();
  const address = getAddress(row);
  const fullName = getFullName(row);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const field = (key: keyof RowState, label: string, autoComplete?: string, type = "text") => (
    <label className="flex min-h-10 min-w-0 items-center gap-2 text-xs text-zinc-600">
      <span className={classNames("shrink-0", key !== "firstName" && key !== "lastName" && "w-16")}><WorkspaceText text={label} /></span>
      <input autoComplete={autoComplete} readOnly={row.personalLegalName && (key === "firstName" || key === "lastName")} className="h-9 min-w-0 w-full rounded bg-zinc-100 px-2 text-base text-zinc-950 outline-none focus:ring-2 focus:ring-teal-600/30"
        onChange={(event) => onUpdate({ [key]: event.target.value })} type={type} value={String(row[key] ?? "")} />
    </label>
  );
  const buttonClass = "inline-flex min-h-11 items-center justify-center rounded px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-100";
  const alerts = [status.booking, status.payroll].filter((item) => item.label);
  async function save(formData: FormData) {
    setSaving(true);
    setSaveError("");
    try {
      const result = await saveStaffDirectoryEntryAction(formData);
      if (result.ok) onSaved();
      else setSaveError(result.message);
    } catch {
      setSaveError("Staff changes could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }
  return <>
    <tr className={classNames("mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 bg-white px-3 py-2 first:mt-0 md:mt-0 md:table-row", !row.isActive && "!bg-zinc-50")}>
      <td className="min-w-0 md:px-3 md:py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-teal-50 text-xs font-semibold text-teal-800">
            {row.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" className="size-full object-cover" src={row.avatarUrl} />
            ) : getInitials(row.displayName)}
          </span>
          <div className="min-w-0"><p className="truncate text-sm font-semibold text-zinc-950"><WorkspaceText text={row.displayName || fullName || "Staff member"} /></p>
            <p className="truncate text-xs text-zinc-500 md:hidden">{row.phone || row.email}</p></div>
        </div>
      </td>
      <td className="hidden min-w-0 md:table-cell md:px-3 md:py-2"><p className="break-all text-xs text-zinc-600">{row.phone || row.email || "—"}</p></td>
      <td className="hidden md:table-cell md:px-3 md:py-2"><div className="flex flex-wrap gap-1">
        <Badge tone={row.isActive ? "success" : "neutral"}><WorkspaceText text={row.isActive ? "Active" : "Disabled"} /></Badge>
        {row.isActive && row.onlineBookingEnabled ? <Badge><WorkspaceText text="Booking" /></Badge> : null}
        {row.isActive && row.posEnabled ? <Badge><WorkspaceText text="POS" /></Badge> : null}
      </div></td>
      <td className={classNames("col-span-2 row-start-2 md:table-cell md:px-3 md:py-2", !alerts.length && "hidden")}><div className="flex flex-wrap gap-1">{alerts.map((alert) => <StatusBadgeLink key={alert.label} status={alert} />)}</div></td>
      <td className="col-start-2 row-start-1 md:px-3 md:py-2">{canManageStaff ? <div className="flex justify-end gap-1">
        {profileHref ? <Link className={buttonClass} href={profileHref}><WorkspaceText text="Profile" /></Link> : null}
        <button aria-expanded={editing} aria-controls={`staff-edit-${row.id}`} className={buttonClass} disabled={busy || saving} onClick={onToggleEditing} type="button"><WorkspaceText text="Edit" /></button>
      </div> : null}</td>
    </tr>
    {editing ? <tr className="block bg-white md:table-row"><td colSpan={5} className="block px-3 pb-3 md:table-cell" id={`staff-edit-${row.id}`}>
      <form action={save} className="max-w-xl" aria-label={__vt("Edit staff")}>
        <input name="q" type="hidden" value={query} />
        <input name="reset_staff_id" type="hidden" value={row.id} /><HiddenInputs rows={[row]} />
        <StaffEditFields onPendingChange={onPendingChange}>
          {field("displayName", "Nickname", "nickname")}
          <div className="flex min-w-0 items-center gap-2"><span className="w-16 shrink-0 text-xs text-zinc-600"><WorkspaceText text="Legal name" /></span>
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">{field("firstName", "First", "given-name")}{field("lastName", "Last", "family-name")}</div>
          </div>
          {row.personalLegalName ? <p className="pl-[4.5rem] text-xs text-zinc-500"><WorkspaceText text="Legal name is managed by this person in Personal." /></p> : null}
          {field("phone", "Phone", "tel", "tel")}
          {field("email", "Email", "email", "email")}
          <div className="flex min-w-0 items-start gap-2"><span className="w-16 shrink-0 py-3 text-xs text-zinc-600"><WorkspaceText text="Address" /></span>
            <details className="min-w-0 flex-1"><summary className="min-h-10 cursor-pointer py-3 text-xs text-zinc-500"><WorkspaceText text={address || "Add address · Optional"} /></summary>
              <div className="grid gap-1">{field("addressLine1", "Address line 1", "address-line1")}{field("addressLine2", "Address line 2", "address-line2")}{field("city", "City", "address-level2")}{field("state", "State", "address-level1")}{field("postalCode", "ZIP", "postal-code")}</div>
            </details>
          </div>
          <div className="flex min-w-0 items-center gap-2"><label className="w-16 shrink-0 text-xs text-zinc-600" htmlFor={`pin-${row.id}`}><WorkspaceText text="PIN" /></label>
            <input id={`pin-${row.id}`} autoComplete="new-password" className="h-9 min-w-0 flex-1 rounded bg-zinc-100 px-2 text-base placeholder:text-xs" inputMode="numeric" name={`new_passcode_${row.id}`} pattern="[0-9]{4,8}" placeholder={__vt(row.passcodeIsDefault ? "Default 1234" : "4–8 digits")} type="password" />
            <SubmitButton pendingLabel="Processing…" className={buttonClass} formAction={resetStaffPasscodeFormAction}><WorkspaceText text="Reset" /></SubmitButton>
          </div>
          <div className="flex min-w-0 items-center gap-2"><span className="w-16 shrink-0 text-xs text-zinc-600"><WorkspaceText text="Status" /></span><div className="flex min-w-0 flex-1 flex-wrap justify-between gap-x-1">
            <AccessToggle checked={row.isActive} disabled={false} label="Staff" onChange={(isActive) => onUpdate({ isActive, posEnabled: isActive ? row.posEnabled : false, onlineBookingEnabled: isActive ? row.onlineBookingEnabled : false, postingEnabled: isActive ? row.postingEnabled : false })} />
            <AccessToggle checked={row.onlineBookingEnabled} disabled={!row.isActive} label="Booking" onChange={(onlineBookingEnabled) => onUpdate({ onlineBookingEnabled })} />
            <AccessToggle checked={row.posEnabled} disabled={!row.isActive} label="POS" onChange={(posEnabled) => onUpdate({ posEnabled })} />
          </div></div>
          {saveError ? <p role="alert" className="text-xs text-red-700"><WorkspaceText text={saveError} /></p> : null}
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <div className="mr-auto"><DeleteUnusedButton kind="staff" id={row.id} name={fullName || row.displayName} disabled={dirty} /></div>
            <button className={buttonClass} onClick={onCancel} type="button"><WorkspaceText text="Cancel" /></button>
            <SubmitButton pendingLabel="Saving…" className={`${buttonClass} !bg-teal-700 !text-white disabled:opacity-40`} disabled={!dirty}><WorkspaceText text="Save" /></SubmitButton>
          </div>
        </StaffEditFields>
      </form>
    </td></tr> : null}
  </>;
}

function StaffTable({
  busy,
  onPendingChange,
  canManageStaff,
  dirtyIds,
  editingIds,
  onToggleEditing,
  onUpdate,
  onCancel,
  onSaved,
  query,
  profileHrefByStaffId,
  rows,
  statusByStaffId,
}: {
  busy: boolean;
  onPendingChange: (pending: boolean) => void;
  canManageStaff: boolean;
  dirtyIds: Set<string>;
  editingIds: Set<string>;
  onToggleEditing: (staffId: string) => void;
  onUpdate: (staffId: string, patch: Partial<RowState>) => void;
  onCancel: (staffId: string) => void;
  onSaved: (staffId: string) => void;
  query: string;
  profileHrefByStaffId: Record<string, string>;
  rows: RowState[];
  statusByStaffId: Record<string, StaffDirectoryStatus>;
}) {
  return (
    <div className="min-w-0 max-w-full">
      <table className="block w-full text-left text-sm md:table">
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
        <tbody className="block bg-zinc-100 md:table-row-group md:bg-white">
          {rows.map((row) => (
            <StaffRow
              busy={busy}
              onPendingChange={onPendingChange}
              canManageStaff={canManageStaff}
              dirty={dirtyIds.has(row.id)}
              editing={editingIds.has(row.id)}
              key={row.id}
              onToggleEditing={() => onToggleEditing(row.id)}
              query={query}
              onCancel={() => onCancel(row.id)}
              onSaved={() => onSaved(row.id)}
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
  const [savedRows, setSavedRows] = useState(initialRows);
  const initialSignatures = useMemo(
    () =>
      new Map(savedRows.map((row) => [row.id, rowSignature(row)] as const)),
    [savedRows],
  );
  const [rows, setRows] = useState(initialRows);
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(query);
  const [busy, setBusy] = useState(false);
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

  function updateRow(staffId: string, patch: Partial<RowState>) {
    setRows((current) =>
      current.map((row) => (row.id === staffId ? { ...row, ...patch } : row)),
    );
  }

  function cancelEditing(staffId: string) {
    const original = savedRows.find((row) => row.id === staffId);
    if (original) setRows((current) => current.map((row) => row.id === staffId ? { ...original } : row));
    setEditingIds(new Set());
  }

  function saved(staffId: string) {
    const updated = rows.find((row) => row.id === staffId);
    if (updated) {
      const persisted = { ...updated, initiallyHidden: !updated.isActive };
      setSavedRows((current) => current.map((row) => row.id === staffId ? persisted : row));
      setRows((current) => current.map((row) => row.id === staffId ? persisted : row));
    }
    setEditingIds(new Set());
  }

  function toggleEditing(staffId: string) {
    if (busy) return;
    const currentId = [...editingIds][0];
    if (currentId) {
      if (dirtyIds.has(currentId) && !window.confirm(__vt("Discard unsaved changes?"))) return;
      cancelEditing(currentId);
    }
    setEditingIds(currentId === staffId ? new Set() : new Set([staffId]));
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3 md:hidden"><h1 className="text-lg font-semibold tracking-tight text-zinc-950"><WorkspaceText text="Staff" /></h1><span className="text-xs text-zinc-500">{activeStaff.length} <WorkspaceText text="active ·" /> {hiddenStaff.length} <WorkspaceText text="hidden" /></span></div>
      <div className="flex min-w-0 items-center gap-2 border-b border-zinc-200 pb-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <label className="sr-only" htmlFor="staff-search"><WorkspaceText text="Search staff" /></label>
          <input id="staff-search" type="search" disabled={busy}
            className="h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-white pl-3 pr-8 text-sm outline-none focus:border-teal-600"
            placeholder={__vt("Search staff…")} value={search} onChange={(event) => setSearch(event.target.value)} />
          {search ? <button type="button" aria-label={__vt("Clear staff search")} disabled={busy} className="absolute inset-y-0 right-0 w-8 text-zinc-500" onClick={() => setSearch("")}>×</button> : null}
        </div>
        {toolbarActions}
      </div>
      {search ? (
        <p role="status" className="mt-2 text-xs text-zinc-500">
          {matchingIds.size} <WorkspaceText text="matching staff" />
        </p>
      ) : null}
      <div className="mt-3 min-w-0 grid gap-3">
        {activeRows.length > 0 ? (
          <StaffTable
            busy={busy}
            onPendingChange={setBusy}
            canManageStaff={canManageStaff}
            dirtyIds={dirtyIds}
            editingIds={editingIds}
            onToggleEditing={toggleEditing}
            onCancel={cancelEditing}
            onSaved={saved}
            query={search}
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
        {rows.some((row) => row.initiallyHidden) ? <details
          open={search.trim() ? true : undefined}
          className="bg-white"
        >
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-950">
            <WorkspaceText text="Hidden staff list (" />{hiddenRows.length})
          </summary>
          <div className="border-t border-zinc-200 p-4">
            {hiddenRows.length > 0 ? (
              <StaffTable
                busy={busy}
                onPendingChange={setBusy}
                canManageStaff={canManageStaff}
                dirtyIds={dirtyIds}
                editingIds={editingIds}
                onToggleEditing={toggleEditing}
                onCancel={cancelEditing}
                onSaved={saved}
                query={search}
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
      </div>
    </>
  );
}
