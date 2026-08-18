"use client";

import {
  updateStaffPublicTeamBatchAction,
  type PublicTeamBatchUpdate,
} from "@/app/salon-settings/actions";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

export type PublicTeamSettingsMember = {
  avatarUrl: string | null;
  displayName: string;
  id: string;
  isActive: boolean;
  jobTitle: string | null;
  onlineBookingEnabled: boolean;
  ownerPublicEnabled: boolean;
  profileDisplayOrder: number;
  salonProfileContentPostingEnabled: boolean;
  staffPublicConsentStatus: "granted" | "not_requested" | "opted_out";
};

type DraftMember = PublicTeamSettingsMember;

type PublicTeamSettingsEditorProps = {
  canManageSettings: boolean;
  members: PublicTeamSettingsMember[];
};

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function memberSignature(member: DraftMember) {
  return JSON.stringify({
    id: member.id,
    onlineBookingEnabled: member.onlineBookingEnabled,
    ownerPublicEnabled: member.ownerPublicEnabled,
    profileDisplayOrder: member.profileDisplayOrder,
    salonProfileContentPostingEnabled: member.salonProfileContentPostingEnabled,
  });
}

function buildPayload(members: DraftMember[]): PublicTeamBatchUpdate[] {
  return members.map((member) => ({
    onlineBookingEnabled: member.onlineBookingEnabled,
    ownerPublicEnabled: member.ownerPublicEnabled,
    profileDisplayOrder: member.profileDisplayOrder,
    salonProfileContentPostingEnabled: member.salonProfileContentPostingEnabled,
    staffId: member.id,
  }));
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-zinc-700">
      <input
        checked={checked}
        className="mt-0.5 size-4"
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span className="font-medium text-zinc-950">{label}</span>
    </label>
  );
}

export function PublicTeamSettingsEditor({
  canManageSettings,
  members,
}: PublicTeamSettingsEditorProps) {
  const router = useRouter();
  const [savedMembers, setSavedMembers] = useState<DraftMember[]>(members);
  const [draftMembers, setDraftMembers] = useState<DraftMember[]>(members);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const savedSignatures = useMemo(
    () => new Map(savedMembers.map((member) => [member.id, memberSignature(member)])),
    [savedMembers],
  );
  const dirtyCount = draftMembers.filter(
    (member) => savedSignatures.get(member.id) !== memberSignature(member),
  ).length;
  const hasDirtyChanges = dirtyCount > 0;

  useEffect(() => {
    if (!hasDirtyChanges) {
      return;
    }

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasDirtyChanges]);

  function updateMember(
    memberId: string,
    patch: Partial<
      Pick<
        DraftMember,
        | "onlineBookingEnabled"
        | "ownerPublicEnabled"
        | "profileDisplayOrder"
        | "salonProfileContentPostingEnabled"
      >
    >,
  ) {
    setMessage("");
    setDraftMembers((current) =>
      current.map((member) =>
        member.id === memberId ? { ...member, ...patch } : member,
      ),
    );
  }

  function applyAll(
    updater: (member: DraftMember) => Partial<DraftMember> | null,
  ) {
    setMessage("");
    setDraftMembers((current) =>
      current.map((member) => {
        const patch = updater(member);
        return patch ? { ...member, ...patch } : member;
      }),
    );
  }

  function cancel() {
    setMessage("Changes discarded.");
    setDraftMembers(savedMembers);
  }

  function save() {
    if (!canManageSettings || !hasDirtyChanges || isPending) {
      return;
    }

    startTransition(async () => {
      const result = await updateStaffPublicTeamBatchAction(
        buildPayload(draftMembers),
      );

      if (result.error) {
        setMessage(result.error);
        return;
      }

      setSavedMembers(draftMembers);
      setMessage(
        result.updatedCount === 1
          ? "1 staff setting saved."
          : `${result.updatedCount} staff settings saved.`,
      );
      router.refresh();
    });
  }

  if (members.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-white p-5 text-sm text-zinc-600">
        No staff profiles found for this salon.
      </p>
    );
  }

  return (
    <div className="mt-4 grid gap-4">
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
          disabled={!canManageSettings}
          onClick={() =>
            applyAll((member) =>
              member.isActive
                ? { salonProfileContentPostingEnabled: true }
                : null,
            )
          }
          type="button"
        >
          Allow all active staff to post
        </button>
        <button
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
          disabled={!canManageSettings}
          onClick={() =>
            applyAll(() => ({ salonProfileContentPostingEnabled: false }))
          }
          type="button"
        >
          Disable posting for all
        </button>
        <button
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
          disabled={!canManageSettings}
          onClick={() =>
            applyAll((member) =>
              member.isActive && member.staffPublicConsentStatus !== "opted_out"
                ? { ownerPublicEnabled: true }
                : null,
            )
          }
          type="button"
        >
          Show all eligible staff
        </button>
        <button
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
          disabled={!canManageSettings}
          onClick={() => applyAll(() => ({ ownerPublicEnabled: false }))}
          type="button"
        >
          Hide all staff
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="hidden grid-cols-[minmax(13rem,1.3fr)_repeat(4,minmax(8rem,.8fr))] gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 lg:grid">
          <span>Staff</span>
          <span>Public</span>
          <span>Booking</span>
          <span>Posting</span>
          <span>Order</span>
        </div>
        <div className="divide-y divide-zinc-200">
          {draftMembers.map((member) => {
            const consentLabel =
              member.staffPublicConsentStatus === "granted"
                ? "Staff consented"
                : member.staffPublicConsentStatus === "opted_out"
                  ? "Staff opted out"
                  : "Consent not requested";
            const effectivePublic =
              member.isActive &&
              member.ownerPublicEnabled &&
              member.staffPublicConsentStatus === "granted";
            const rowDirty =
              savedSignatures.get(member.id) !== memberSignature(member);

            return (
              <div
                className="grid gap-4 p-4 lg:grid-cols-[minmax(13rem,1.3fr)_repeat(4,minmax(8rem,.8fr))] lg:items-center"
                key={member.id}
              >
                <div className="flex min-w-0 items-start gap-3">
                  {member.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={`${member.displayName} public profile`}
                      className="h-12 w-12 shrink-0 rounded-full border border-zinc-200 object-cover"
                      src={member.avatarUrl}
                    />
                  ) : (
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-zinc-950 text-xs font-semibold text-white">
                      {initialsFor(member.displayName)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-zinc-950">
                        {member.displayName}
                      </p>
                      {rowDirty ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          Unsaved
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      {member.jobTitle ?? "Staff"} /{" "}
                      {member.isActive ? "Active" : "Inactive"}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-zinc-600">
                      {effectivePublic ? "Visible publicly" : "Hidden publicly"} /{" "}
                      {consentLabel}
                    </p>
                  </div>
                </div>

                <Toggle
                  checked={member.ownerPublicEnabled}
                  disabled={
                    !canManageSettings ||
                    member.staffPublicConsentStatus === "opted_out"
                  }
                  label="Show on public profile"
                  onChange={(checked) =>
                    updateMember(member.id, { ownerPublicEnabled: checked })
                  }
                />
                <Toggle
                  checked={member.onlineBookingEnabled}
                  disabled={!canManageSettings || !member.isActive}
                  label="Direct booking"
                  onChange={(checked) =>
                    updateMember(member.id, { onlineBookingEnabled: checked })
                  }
                />
                <Toggle
                  checked={member.salonProfileContentPostingEnabled}
                  disabled={!canManageSettings || !member.isActive}
                  label="Allow Salon Profile posting"
                  onChange={(checked) =>
                    updateMember(member.id, {
                      salonProfileContentPostingEnabled: checked,
                    })
                  }
                />
                <label className="grid gap-1 text-sm text-zinc-700">
                  <span className="font-medium text-zinc-950">Display order</span>
                  <input
                    className="max-w-28 rounded-md border border-zinc-300 px-2 py-1 text-sm"
                    disabled={!canManageSettings}
                    onChange={(event) =>
                      updateMember(member.id, {
                        profileDisplayOrder:
                          Number.parseInt(event.currentTarget.value, 10) || 0,
                      })
                    }
                    type="number"
                    value={member.profileDisplayOrder}
                  />
                </label>
              </div>
            );
          })}
        </div>
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-10px_30px_rgba(24,24,27,.08)] backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zinc-600">
            {hasDirtyChanges
              ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}`
              : message || "No unsaved changes"}
          </p>
          <div className="flex gap-2">
            <button
              className="min-h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-950 disabled:opacity-50"
              disabled={!hasDirtyChanges || isPending}
              onClick={cancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canManageSettings || !hasDirtyChanges || isPending}
              onClick={save}
              type="button"
            >
              {isPending ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
        {message && hasDirtyChanges ? (
          <p className="mt-2 text-sm text-red-700">{message}</p>
        ) : null}
      </div>
    </div>
  );
}
