"use client";

import { createOwnerTransferInviteAction } from "@/app/account/actions";
import type { SalonOwnerRoster } from "@/lib/owner-transfer";
import { ActionDialog } from "@/app/action-dialog";
import { leaveSalonOwnershipAction } from "./ownership-actions";
import Link from "next/link";
import { SHOW_ROLE_PERMISSION_CATALOGS } from "@/lib/role-catalog-visibility";
import { useState, useTransition, type FormEvent } from "react";

type OwnerInviteMode = "add_co_owner" | "transfer_ownership";

type SalonOwnershipSectionProps = {
  canManageOwnership: boolean;
  ownerRoster: SalonOwnerRoster | null;
  permissionsHref: string;
  rolesHref: string;
  salon: {
    id: string;
    name: string;
  };
};

export function SalonOwnershipSection({
  canManageOwnership,
  ownerRoster,
  permissionsHref,
  rolesHref,
  salon,
}: SalonOwnershipSectionProps) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<OwnerInviteMode>("add_co_owner");
  const [note, setNote] = useState("");
  const [relinquishOnAccept, setRelinquishOnAccept] = useState(true);
  const [isPending, startTransition] = useTransition();

  function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    startTransition(async () => {
      const result = await createOwnerTransferInviteAction({
        message: note,
        mode,
        recipient_email: email,
        relinquish_on_accept:
          mode === "transfer_ownership" ? relinquishOnAccept : false,
        salon_id: salon.id,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      setEmail("");
      setNote("");
      setMessage(result.message ?? "Owner invitation created.");
    });
  }

  return (
    <section className="scroll-mt-6" id="ownership-admins">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            Ownership & admins
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Owner invitations and ownership transfer for this salon.
          </p>
        </div>
        <span className="inline-flex min-h-7 w-fit items-center rounded-full bg-amber-50 px-2.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
          Owner only
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {SHOW_ROLE_PERMISSION_CATALOGS ? <div className="grid border-b border-zinc-100 md:grid-cols-2">
          <Link
            className="flex min-h-16 items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 transition hover:bg-zinc-50 md:border-b-0 md:border-r"
            href={rolesHref}
          >
            <span>
              <span className="block text-sm font-semibold text-zinc-950">
                Roles
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-zinc-500">
                Owner, admin, manager, and staff role records.
              </span>
            </span>
            <span className="text-sm font-semibold text-zinc-500">Open</span>
          </Link>
          <Link
            className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 transition hover:bg-zinc-50"
            href={permissionsHref}
          >
            <span>
              <span className="block text-sm font-semibold text-zinc-950">
                Permissions
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-zinc-500">
                Access categories for booking, staff, POS, payroll, and reports.
              </span>
            </span>
            <span className="text-sm font-semibold text-zinc-500">Open</span>
          </Link>
        </div>

        : null}
        {ownerRoster ? (
          <div className="border-b border-zinc-100 px-4 py-4">
            <h3 className="text-sm font-semibold text-zinc-950">Current owners ({ownerRoster.owners.length})</h3>
            <p className="mt-1 text-sm text-zinc-500">Each Owner can manage this salon and leave their own ownership when another active Owner remains.</p>
            <ul className="mt-3 divide-y divide-zinc-100">
              {ownerRoster.owners.map((owner) => (
                <li key={owner.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">{owner.name || owner.email || "Owner"}{owner.isCurrentUser ? " (You)" : ""}</p>
                    {owner.email ? <p className="break-all text-sm text-zinc-500">{owner.email}</p> : null}
                  </div>
                  <span className="text-xs font-semibold text-zinc-500">{owner.status === "active" ? "Active Owner" : "Pending account deletion"}</span>
                </li>
              ))}
            </ul>
            <button type="button" disabled={isPending || !ownerRoster.canLeave}
              className="mt-3 min-h-10 rounded-md border border-red-200 px-4 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => { setLeaveError(""); setConfirmLeave(true); }}>Leave ownership</button>
            {!ownerRoster.canLeave ? <p className="mt-2 text-sm text-amber-700">You are the last active Owner. Invite another Owner and wait for acceptance before leaving.</p> : null}
            {leaveError ? <p role="alert" className="mt-2 text-sm text-red-700">{leaveError}</p> : null}
            <ActionDialog open={confirmLeave} onClose={() => setConfirmLeave(false)} title={`Leave ownership of ${salon.name}?`}
              description="Your Owner access to this salon will be removed. The remaining Owner will continue managing the salon. Your personal account and salon records will be kept."
              secondaryAction={{ label: "Cancel" }}
              primaryAction={{ label: "Leave ownership", onClick: () => {
                startTransition(async () => {
                  const result = await leaveSalonOwnershipAction(salon.id);
                  if (result?.error) setLeaveError(result.error);
                });
              } }} />
          </div>
        ) : null}
        <form className="grid gap-4 px-4 py-4" onSubmit={createInvite}>
          <div>
            <h3 className="text-sm font-semibold text-zinc-950">
              Owner invitation
            </h3>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              Send an invitation for {salon.name}. The recipient can accept or ignore it in My Place.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-700">
                Invite type
              </span>
              <select
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                disabled={!canManageOwnership || isPending}
                onChange={(event) =>
                  setMode(event.currentTarget.value as OwnerInviteMode)
                }
                value={mode}
              >
                <option value="add_co_owner">Add co-owner</option>
                <option value="transfer_ownership">Transfer ownership</option>
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-700">
                Recipient email
              </span>
              <input
                autoComplete="email"
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
                disabled={!canManageOwnership || isPending}
                onChange={(event) => setEmail(event.currentTarget.value)}
                placeholder="owner@example.com"
                type="email"
                value={email}
              />
            </label>
          </div>

          {mode === "transfer_ownership" ? (
            <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <input
                checked={relinquishOnAccept}
                className="mt-1 size-4 rounded border-amber-300"
                disabled={!canManageOwnership || isPending}
                onChange={(event) =>
                  setRelinquishOnAccept(event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>
                Remove my owner access after the recipient accepts this transfer.
              </span>
            </label>
          ) : null}

          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-zinc-700">
              Message, optional
            </span>
            <textarea
              className="min-h-20 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
              disabled={!canManageOwnership || isPending}
              onChange={(event) => setNote(event.currentTarget.value)}
              value={note}
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-500">
              The invite expires after 14 days.
            </p>
            <button
              className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canManageOwnership || isPending}
              type="submit"
            >
              {isPending ? "Creating..." : "Create invite"}
            </button>
          </div>

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
              {error}
            </p>
          ) : null}
          {message ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <p className="font-semibold">{message}</p>

            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
