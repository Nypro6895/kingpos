"use client";

import {
  closeCurrentSalonPermanentlyAction,
  disableCurrentSalonAction,
  generateCurrentSalonBackupAction,
  reactivateCurrentSalonAction,
} from "@/app/salon-settings/actions";
import type { SalonClosureReview } from "@/lib/salon-lifecycle";
import type { SalonLifecycleStatus } from "@/lib/salon-lifecycle-rules";
import { useState, useTransition } from "react";

type SalonLifecycleSectionProps = {
  canManageLifecycle: boolean;
  closureReview: SalonClosureReview | null;
  error?: string;
  notice?: string;
  salon: {
    closedAt: string | null;
    disabledAt: string | null;
    lifecycleStatus: SalonLifecycleStatus;
    name: string;
    status: string;
  };
};

function statusLabel(status: SalonLifecycleStatus) {
  if (status === "permanently_closed") {
    return "Permanently closed";
  }

  if (status === "disabled") {
    return "Temporarily disabled";
  }

  return "Active";
}

function formatDateTime(value: string | null) {
  if (!value) {
    return null;
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

function StatusPill({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span
      className={[
        "inline-flex min-h-7 w-fit items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset",
        className,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function StatusRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center">
      <p className="text-xs font-semibold uppercase text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

export function SalonLifecycleSection({
  canManageLifecycle,
  closureReview,
  error,
  notice,
  salon,
}: SalonLifecycleSectionProps) {
  const [backupError, setBackupError] = useState("");
  const [backupNotice, setBackupNotice] = useState("");
  const [backupPending, startBackup] = useTransition();
  const statusTone =
    salon.lifecycleStatus === "active"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : salon.lifecycleStatus === "disabled"
        ? "bg-amber-50 text-amber-700 ring-amber-200"
        : "bg-zinc-100 text-zinc-700 ring-zinc-200";
  const disabledAt = formatDateTime(salon.disabledAt);
  const closedAt = formatDateTime(salon.closedAt);

  function downloadBackup() {
    setBackupError("");
    setBackupNotice("");
    startBackup(async () => {
      const result = await generateCurrentSalonBackupAction();

      if (result.error || !result.signedUrl || !result.filename) {
        setBackupError(result.error ?? "Export could not be prepared.");
        return;
      }

      downloadUrl({
        filename: result.filename,
        url: result.signedUrl,
      });
      setBackupNotice(
        `Private export prepared. This link expires ${formatDateTime(result.expiresAt) ?? "soon"}.`,
      );
    });
  }

  return (
    <section className="scroll-mt-6" id="salon-status">
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            Salon status
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Pause, reactivate, export, or permanently close this salon.
          </p>
        </div>
        <StatusPill
          className={statusTone}
          label={statusLabel(salon.lifecycleStatus)}
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {notice ? (
          <p className="border-b border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {error}
          </p>
        ) : null}

        <div className="divide-y divide-zinc-100">
          <StatusRow
            label="Current state"
            value={statusLabel(salon.lifecycleStatus)}
          />
          <StatusRow label="Disabled" value={disabledAt ?? "-"} />
          <StatusRow label="Closed" value={closedAt ?? "-"} />
        </div>

        <div className="border-t border-zinc-100 px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-zinc-950">
                Backup export
              </h3>
              <p className="mt-1 text-sm leading-6 text-zinc-500">
                Download a private salon export before high-impact changes.
              </p>
            </div>
            <button
              className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60"
              disabled={backupPending}
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

        {salon.lifecycleStatus === "permanently_closed" ? (
          <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-4">
            <h3 className="text-sm font-semibold text-zinc-950">
              Historical access only
            </h3>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              This salon remains available for retained history. Standard
              reactivation is not available.
            </p>
          </div>
        ) : null}

        {salon.lifecycleStatus === "active" ? (
          <form
            action={disableCurrentSalonAction}
            className="grid gap-3 border-t border-amber-100 bg-amber-50/70 px-4 py-4"
          >
            <div>
              <h3 className="text-sm font-semibold text-amber-950">
                Temporarily disable
              </h3>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                Pause new bookings, POS activity, and operational changes. You
                can reactivate later.
              </p>
            </div>
            <textarea
              className="min-h-20 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-amber-500"
              name="disable_reason"
              placeholder="Reason, optional"
            />
            <label className="flex items-start gap-3 text-sm text-amber-950">
              <input
                className="mt-1 size-4 rounded border-amber-300"
                name="disable_acknowledged"
                type="checkbox"
              />
              <span>I understand business activity will pause.</span>
            </label>
            <div>
              <button
                className="min-h-10 rounded-md bg-amber-700 px-4 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canManageLifecycle}
                type="submit"
              >
                Disable salon
              </button>
            </div>
          </form>
        ) : null}

        {salon.lifecycleStatus === "disabled" ? (
          <form
            action={reactivateCurrentSalonAction}
            className="grid gap-3 border-t border-emerald-100 bg-emerald-50/70 px-4 py-4"
          >
            <div>
              <h3 className="text-sm font-semibold text-emerald-950">
                Reactivate salon
              </h3>
              <p className="mt-1 text-sm leading-6 text-emerald-900">
                Resume standard salon workflows once this salon is active
                again.
              </p>
            </div>
            <textarea
              className="min-h-20 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-emerald-500"
              name="reactivate_reason"
              placeholder="Reason, optional"
            />
            <label className="flex items-start gap-3 text-sm text-emerald-950">
              <input
                className="mt-1 size-4 rounded border-emerald-300"
                name="reactivate_acknowledged"
                type="checkbox"
              />
              <span>Resume operational workflows for this salon.</span>
            </label>
            <div>
              <button
                className="min-h-10 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canManageLifecycle}
                type="submit"
              >
                Reactivate salon
              </button>
            </div>
          </form>
        ) : null}

        {salon.lifecycleStatus !== "permanently_closed" ? (
          <div className="border-t border-red-200 bg-red-50/80 px-4 py-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-red-800">
                  Danger Zone
                </p>
                <h3 className="mt-1 text-sm font-semibold text-red-950">
                  Permanently close salon
                </h3>
                <p className="mt-1 text-sm leading-6 text-red-900">
                  This ends the business lifecycle for this salon. Personal
                  Account access and other salons are not deleted.
                </p>
              </div>
              <StatusPill
                className="bg-red-100 text-red-700 ring-red-200"
                label="Protected"
              />
            </div>

            {closureReview ? (
              <div className="mb-3">
                <p className="mb-2 text-xs font-semibold uppercase text-red-900">
                  Operational review
                </p>
                {closureReview.blockingRecords.length > 0 ? (
                  <div className="overflow-hidden rounded-lg border border-red-200 bg-white">
                    {closureReview.blockingRecords.map((record) => (
                      <div
                        className="border-b border-red-100 px-3 py-2 last:border-b-0"
                        key={record.id}
                      >
                        <p className="text-sm font-semibold text-red-950">
                          {record.label}: {record.count}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-red-800">
                          {record.description}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800">
                    No future bookings, pending appointments, or open POS
                    tickets were found.
                  </p>
                )}
              </div>
            ) : null}

            <form
              action={closeCurrentSalonPermanentlyAction}
              className="grid gap-3"
            >
              <label className="flex items-start gap-3 text-sm text-red-950">
                <input
                  className="mt-1 size-4 rounded border-red-300"
                  name="backup_acknowledged"
                  type="checkbox"
                />
                <span>
                  I have downloaded a backup or understand I am continuing
                  without one.
                </span>
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-semibold text-red-950">
                  Type salon name to confirm
                </span>
                <input
                  autoComplete="off"
                  className="min-h-10 rounded-md border border-red-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-red-500"
                  name="confirmation_name"
                />
              </label>
              <textarea
                className="min-h-20 rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-red-500"
                name="closure_reason"
                placeholder="Reason, optional"
              />
              <div>
                <button
                  className="min-h-10 rounded-md bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!canManageLifecycle || closureReview?.canClose === false}
                  type="submit"
                >
                  Permanently close salon
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  );
}
