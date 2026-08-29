"use client";

import {
  cancelAccountDeletionAction,
  createOwnerTransferInviteAction,
  generateAccountDeletionBackupAction,
  requestAccountDeletionAction,
} from "@/app/account/actions";
import type { AccountDeletionImpact } from "@/lib/account-deletion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

type AccountDeletionPanelProps = {
  impact: AccountDeletionImpact | null;
  loadError?: string;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function daysRemaining(value: string | null) {
  if (!value) {
    return null;
  }

  const ms = new Date(value).getTime() - Date.now();

  if (!Number.isFinite(ms)) {
    return null;
  }

  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function downloadUrl(input: {
  filename: string;
  url: string;
}) {
  const link = document.createElement("a");

  link.href = input.url;
  link.download = input.filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function SalonImpactList({
  salons,
}: {
  salons: AccountDeletionImpact["ownedSalons"];
}) {
  if (salons.length === 0) {
    return (
      <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
        No owned salons were found for this account.
      </p>
    );
  }

  return (
    <ul className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {salons.map((salon) => (
        <li
          className="border-b border-zinc-100 px-3 py-2 last:border-b-0"
          key={salon.id}
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-zinc-950">{salon.name}</p>
            <p className="text-xs font-semibold uppercase text-zinc-500">
              {salon.lifecycleStatus.replace("_", " ")}
            </p>
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            {salon.hasOtherOwner
              ? "Another active Owner is present."
              : salon.lifecycleStatus === "permanently_closed"
                ? "Already permanently closed."
                : "You are currently the last active Owner."}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function AccountDeletionPanel({
  impact,
  loadError,
}: AccountDeletionPanelProps) {
  const router = useRouter();
  const [backupError, setBackupError] = useState("");
  const [backupNotice, setBackupNotice] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [continueWithoutTransfer, setContinueWithoutTransfer] = useState(false);
  const [error, setError] = useState(loadError ?? "");
  const [message, setMessage] = useState("");
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [transferEmails, setTransferEmails] = useState<Record<string, string>>({});
  const [transferMessages, setTransferMessages] = useState<Record<string, string>>({});
  const [transferUrls, setTransferUrls] = useState<Record<string, string>>({});
  const [backupPending, startBackup] = useTransition();
  const [requestPending, startRequest] = useTransition();
  const [cancelPending, startCancel] = useTransition();
  const [transferPending, startTransfer] = useTransition();

  if (!impact) {
    return (
      <section className="scroll-mt-6" id="delete-account">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {loadError ?? "Account deletion status could not be loaded."}
        </div>
      </section>
    );
  }

  const deletionState = impact.deletionState;
  const remaining = daysRemaining(deletionState.deletionScheduledFor);
  const lastOwnerCount = impact.lastOwnerOperationalSalons.length;
  const ownedSalonCount = impact.ownedSalons.length;
  const busy = backupPending || requestPending || cancelPending || transferPending;

  function downloadBackup() {
    setBackupError("");
    setBackupNotice("");
    startBackup(async () => {
      const result = await generateAccountDeletionBackupAction();

      if (result.error || !result.signedUrl || !result.filename) {
        setBackupError(result.error ?? "Export could not be prepared.");
        return;
      }

      downloadUrl({
        filename: result.filename,
        url: result.signedUrl,
      });
      setBackupNotice(
        `Private export prepared. This link expires ${formatDateTime(result.expiresAt)}.`,
      );
    });
  }

  function cancelDeletion() {
    setError("");
    setMessage("");
    startCancel(async () => {
      const result = await cancelAccountDeletionAction();

      if (result.error !== null) {
        setError(result.error);
        return;
      }

      setMessage(result.message ?? "Account deletion cancelled.");
      router.refresh();
    });
  }

  function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    startRequest(async () => {
      const result = await requestAccountDeletionAction({
        backup_acknowledged: backupAcknowledged,
        confirmation,
        continue_without_transfer: continueWithoutTransfer,
        reason,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      setMessage(result.message ?? "Account deletion scheduled.");
      router.refresh();
    });
  }

  function createTransferInvite(salonId: string) {
    setError("");
    setTransferMessages((current) => ({ ...current, [salonId]: "" }));
    setTransferUrls((current) => ({ ...current, [salonId]: "" }));
    startTransfer(async () => {
      const result = await createOwnerTransferInviteAction({
        mode: "transfer_ownership",
        recipient_email: transferEmails[salonId] ?? "",
        salon_id: salonId,
      });

      if (result.error !== null) {
        const errorMessage = result.error;

        setTransferMessages((current) => ({
          ...current,
          [salonId]: errorMessage,
        }));
        return;
      }

      const successMessage =
        result.message ?? "Owner transfer invite created.";
      const inviteUrl = result.inviteUrl ?? "";

      setTransferMessages((current) => ({
        ...current,
        [salonId]: successMessage,
      }));
      setTransferUrls((current) => ({
        ...current,
        [salonId]: inviteUrl,
      }));
      router.refresh();
    });
  }

  return (
    <section className="scroll-mt-6" id="delete-account">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            Danger Zone
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Backup, ownership transfer, and personal account deletion controls.
          </p>
        </div>
        <span className="inline-flex min-h-7 w-fit items-center rounded-full bg-red-50 px-2.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200">
          Protected
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-red-200 bg-white">
        <div className="border-b border-red-100 bg-red-50 px-4 py-4">
          <h3 className="text-sm font-semibold text-red-950">
            Delete personal account
          </h3>
          <p className="mt-1 text-sm leading-6 text-red-900">
            Personal identity enters a deletion lifecycle. Business records may
            be retained for operational, audit, tax, payroll, booking, or legal
            reasons.
          </p>
        </div>

        {deletionState.isPendingDeletion ? (
          <div className="grid gap-3 bg-amber-50 px-4 py-4">
            <div>
              <h3 className="text-sm font-semibold text-amber-950">
                Account deletion scheduled
              </h3>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                Requested {formatDateTime(deletionState.deletionRequestedAt)}.
                Scheduled for {formatDateTime(deletionState.deletionScheduledFor)}
                {remaining === null ? "." : `, with ${remaining} day${remaining === 1 ? "" : "s"} remaining.`}
              </p>
            </div>
            <p className="text-sm leading-6 text-amber-900">
              Cancelling does not reopen permanently closed salons and does not
              reactivate disabled salons.
            </p>
            <div>
              <button
                className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
                disabled={busy}
                onClick={cancelDeletion}
                type="button"
              >
                {cancelPending ? "Cancelling..." : "Cancel account deletion"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="border-b border-zinc-100 px-4 py-4">
              <h3 className="text-sm font-semibold text-zinc-950">
                Ownership transfer review
              </h3>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                {ownedSalonCount === 0
                  ? "No salon ownership is attached to this Personal Account."
                  : `${ownedSalonCount} owned salon${ownedSalonCount === 1 ? "" : "s"} found. ${lastOwnerCount} require transfer or no-transfer closure before deletion can be scheduled.`}
              </p>
              <div className="mt-3">
                <SalonImpactList salons={impact.ownedSalons} />
              </div>
            </div>

            {lastOwnerCount > 0 ? (
              <div className="border-b border-red-100 bg-red-50/80 px-4 py-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-red-950">
                    Last-owner salons
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-red-900">
                    Transfer ownership before deleting, or continue without
                    transfer and permanently close these salons.
                  </p>
                </div>
                <SalonImpactList salons={impact.lastOwnerOperationalSalons} />
                <div className="mt-3 grid gap-3">
                  {impact.lastOwnerOperationalSalons.map((salon) => (
                    <div
                      className="rounded-lg border border-red-200 bg-white p-3"
                      key={`transfer-${salon.id}`}
                    >
                      <p className="text-sm font-semibold text-zinc-950">
                        Transfer {salon.name}
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <input
                          autoComplete="email"
                          className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
                          onChange={(event) => {
                            const recipientEmail = event.currentTarget.value;

                            setTransferEmails((current) => ({
                              ...current,
                              [salon.id]: recipientEmail,
                            }));
                          }}
                          placeholder="recipient@example.com"
                          type="email"
                          value={transferEmails[salon.id] ?? ""}
                        />
                        <button
                          className="min-h-11 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
                          disabled={busy}
                          onClick={() => createTransferInvite(salon.id)}
                          type="button"
                        >
                          {transferPending ? "Creating..." : "Create invite"}
                        </button>
                      </div>
                      {transferMessages[salon.id] ? (
                        <p
                          className={`mt-2 text-sm font-semibold ${
                            transferUrls[salon.id]
                              ? "text-emerald-700"
                              : "text-red-900"
                          }`}
                        >
                          {transferMessages[salon.id]}
                        </p>
                      ) : null}
                      {transferUrls[salon.id] ? (
                        <a
                          className="mt-2 block break-all text-sm font-semibold text-zinc-950 underline-offset-4 hover:underline"
                          href={transferUrls[salon.id]}
                        >
                          {transferUrls[salon.id]}
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
                <Link
                  className="mt-3 inline-flex text-sm font-semibold text-red-950 underline-offset-4 hover:underline"
                  href="/business-terms#ownership-transfer"
                >
                  Review ownership transfer terms
                </Link>
              </div>
            ) : null}

            <div className="border-b border-zinc-100 px-4 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950">
                    Backup export
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">
                    Download a private export before scheduling deletion.
                  </p>
                </div>
                <button
                  className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60"
                  disabled={busy}
                  onClick={downloadBackup}
                  type="button"
                >
                  {backupPending ? "Preparing..." : "Download backup"}
                </button>
              </div>
              {backupNotice ? (
                <p className="mt-3 text-sm font-semibold text-emerald-700">
                  {backupNotice}
                </p>
              ) : null}
              {backupError ? (
                <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                  {backupError}
                </p>
              ) : null}
            </div>

            <form
              className="grid gap-4 bg-red-50/70 px-4 py-4"
              onSubmit={requestDeletion}
            >
              {ownedSalonCount > 0 ? (
                <label className="flex items-start gap-3 text-sm text-zinc-700">
                  <input
                    checked={backupAcknowledged}
                    className="mt-1 size-4 rounded border-zinc-300"
                    onChange={(event) =>
                      setBackupAcknowledged(event.currentTarget.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    I have downloaded a backup or understand I am continuing
                    without one.
                  </span>
                </label>
              ) : null}

              {lastOwnerCount > 0 ? (
                <label className="flex items-start gap-3 text-sm text-red-900">
                  <input
                    checked={continueWithoutTransfer}
                    className="mt-1 size-4 rounded border-red-300"
                    onChange={(event) =>
                      setContinueWithoutTransfer(event.currentTarget.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    Continue without transfer and permanently close my
                    last-owner salons.
                  </span>
                </label>
              ) : null}

              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-red-950">
                  Type DELETE to confirm
                </span>
                <input
                  autoComplete="off"
                  className="min-h-11 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-zinc-950 outline-none focus:border-red-500"
                  onChange={(event) => setConfirmation(event.currentTarget.value)}
                  value={confirmation}
                />
              </label>

              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-red-950">
                  Reason, optional
                </span>
                <textarea
                  className="min-h-20 rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-red-500"
                  onChange={(event) => setReason(event.currentTarget.value)}
                  value={reason}
                />
              </label>

              <div>
                <button
                  className="min-h-10 rounded-md bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-wait disabled:opacity-60"
                  disabled={busy}
                  type="submit"
                >
                  {requestPending ? "Scheduling..." : "Request account deletion"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {message}
        </p>
      ) : null}
    </section>
  );
}
