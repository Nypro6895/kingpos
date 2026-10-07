"use client";

import {
  secureRecoveryBackOfficeAccountAction,
  updateRecoveryBackOfficeCaseAction,
  updateRecoveryBackOfficeUserStatusAction,
} from "@/app/settings/recovery-back-office/actions";
import type {
  RecoveryBackOfficeCase,
  RecoveryBackOfficeOverview,
} from "@/lib/account-security-backoffice";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type RecoveryBackOfficePanelProps = {
  overview: Extract<RecoveryBackOfficeOverview, { authorized: true }>;
  onSaved?: () => void | Promise<void>;
};

type PendingKey =
  | `case:${string}`
  | `secure:${string}`
  | `status:${string}`
  | null;

const inputClassName =
  "min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10";
const textareaClassName =
  "min-h-20 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10";
const primaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60";
const secondaryButtonClassName =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60";
const dangerButtonClassName =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-wait disabled:opacity-60";

function formatDateTime(value: string | null | undefined) {
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

function readable(value: string | null | undefined) {
  return value?.replace(/_/g, " ") ?? "-";
}

function statusTone(value: string) {
  if (value === "approved" || value === "resolved") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  if (value === "denied" || value === "cancelled") {
    return "bg-zinc-100 text-zinc-600 ring-zinc-200";
  }

  if (value === "needs_info") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  return "bg-sky-50 text-sky-700 ring-sky-200";
}

function riskTone(value: string) {
  if (value === "critical" || value === "high") {
    return "bg-red-50 text-red-700 ring-red-200";
  }

  if (value === "medium") {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }

  return "bg-zinc-100 text-zinc-600 ring-zinc-200";
}

function Badge({
  children,
  className,
}: {
  children: string;
  className: string;
}) {
  return (
    <span
      className={[
        "inline-flex min-h-6 w-fit items-center rounded-full px-2.5 text-xs font-semibold capitalize ring-1 ring-inset",
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function CaseList({
  empty,
  items,
}: {
  empty: string;
  items: React.ReactNode[];
}) {
  if (items.length === 0) {
    return (
      <p className="content-surface border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 rounded-none border-y shadow-none">
        {empty}
      </p>
    );
  }

  return <ul className="grid gap-2">{items}</ul>;
}

function RecoveryCaseCard({
  isBusy,
  onSecure,
  onStatus,
  onUpdate,
  recoveryCase,
}: {
  isBusy: boolean;
  onSecure: (event: FormEvent<HTMLFormElement>, requestId: string) => void;
  onStatus: (event: FormEvent<HTMLFormElement>, requestId: string) => void;
  onUpdate: (event: FormEvent<HTMLFormElement>, requestId: string) => void;
  recoveryCase: RecoveryBackOfficeCase;
}) {
  return (
    <article className="content-surface border-zinc-200 bg-white rounded-none border-y shadow-none">
      <div className="grid gap-3 border-b border-zinc-100 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-950">
              {readable(recoveryCase.requestType)}
            </h2>
            <Badge className={statusTone(recoveryCase.status)}>
              {readable(recoveryCase.status)}
            </Badge>
            <Badge className={riskTone(recoveryCase.riskLevel)}>
              {readable(recoveryCase.riskLevel)}
            </Badge>
            {recoveryCase.recoveryCodeVerified ? (
              <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">
                Recovery code verified
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            {recoveryCase.user?.display_name ??
              recoveryCase.user?.email ??
              recoveryCase.userId}
          </p>
        </div>
        <div className="text-left text-sm leading-6 text-zinc-600 lg:text-right">
          <p>Created {formatDateTime(recoveryCase.createdAt)}</p>
          <p>Updated {formatDateTime(recoveryCase.updatedAt)}</p>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 lg:grid-cols-2">
        <div className="grid gap-3">
          <div className="content-surface border-zinc-200 bg-zinc-50 p-3 rounded-none border-y shadow-none">
            <h3 className="text-sm font-semibold text-zinc-950">Account</h3>
            <dl className="mt-2 grid gap-1 text-sm text-zinc-600">
              <div>Email: {recoveryCase.user?.email ?? "-"}</div>
              <div>Profile phone: {recoveryCase.user?.phone ?? "-"}</div>
              <div>Status: {recoveryCase.user?.status ?? "-"}</div>
              <div>
                Recovery code:{" "}
                {recoveryCase.recoveryCodeVerified ? "verified" : "not used"}
              </div>
              <div>
                Last login: {formatDateTime(recoveryCase.user?.last_login_at)}
              </div>
              <div>Recovery email: {recoveryCase.preferences?.recoveryEmail ?? "-"}</div>
              <div>Recovery phone: {recoveryCase.preferences?.recoveryPhone ?? "-"}</div>
              <div>
                SMS alerts:{" "}
                {recoveryCase.preferences?.smsLoginAlertsEnabled
                  ? "on"
                  : "off"}
              </div>
            </dl>
          </div>

          <div className="content-surface border-zinc-200 bg-zinc-50 p-3 rounded-none border-y shadow-none">
            <h3 className="text-sm font-semibold text-zinc-950">
              Request details
            </h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              {recoveryCase.details || "No details provided."}
            </p>
            <p className="mt-2 text-sm text-zinc-600">
              Contact: {recoveryCase.contactEmail ?? "-"} /{" "}
              {recoveryCase.contactPhone ?? "-"}
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="content-surface border-zinc-200 bg-zinc-50 p-3 rounded-none border-y shadow-none">
            <h3 className="text-sm font-semibold text-zinc-950">
              Recent sessions
            </h3>
            <CaseList
              empty="No login sessions found."
              items={recoveryCase.sessions.map((session) => (
                <li
                  className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600"
                  key={session.id}
                >
                  <p className="font-semibold text-zinc-950">
                    {session.deviceLabel}
                  </p>
                  <p>
                    {session.locationLabel} -{" "}
                    {formatDateTime(session.lastSeenAt)}
                  </p>
                  <p>
                    {session.revokedAt ? "Revoked" : "Active"}
                    {session.trustedAt ? " - trusted" : ""}
                  </p>
                </li>
              ))}
            />
          </div>

          <div className="content-surface border-zinc-200 bg-zinc-50 p-3 rounded-none border-y shadow-none">
            <h3 className="text-sm font-semibold text-zinc-950">
              Recent activity
            </h3>
            <CaseList
              empty="No activity found."
              items={recoveryCase.activity.map((activity) => (
                <li
                  className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600"
                  key={activity.id}
                >
                  <p className="font-semibold text-zinc-950">
                    {readable(activity.activityType)}
                  </p>
                  <p>
                    {activity.deviceLabel} - {activity.locationLabel}
                  </p>
                  <p>{formatDateTime(activity.createdAt)}</p>
                </li>
              ))}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-t border-zinc-100 px-4 py-4 lg:grid-cols-2">
        <form className="grid gap-3" onSubmit={(event) => onUpdate(event, recoveryCase.id)}>
          <input name="request_id" type="hidden" value={recoveryCase.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-950">Status</span>
              <select
                className={inputClassName}
                defaultValue={recoveryCase.status}
                name="status"
              >
                <option value="open">Open</option>
                <option value="reviewing">Reviewing</option>
                <option value="needs_info">Needs info</option>
                <option value="approved">Approved</option>
                <option value="denied">Denied</option>
                <option value="resolved">Resolved</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-950">Priority</span>
              <select
                className={inputClassName}
                defaultValue={recoveryCase.priority}
                name="priority"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-950">Risk</span>
              <select
                className={inputClassName}
                defaultValue={recoveryCase.riskLevel}
                name="risk_level"
              >
                <option value="unknown">Unknown</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-zinc-950">
              Internal note
            </span>
            <textarea
              className={textareaClassName}
              name="note"
              placeholder="Verification steps, evidence, decision reason..."
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-zinc-950">
              Resolution summary
            </span>
            <textarea
              className={textareaClassName}
              defaultValue={recoveryCase.resolutionSummary ?? ""}
              name="resolution_summary"
              placeholder="Visible resolution summary for this case."
            />
          </label>
          <div>
            <button className={primaryButtonClassName} disabled={isBusy} type="submit">
              {isBusy ? "Saving..." : "Save review"}
            </button>
          </div>
        </form>

        <div className="grid gap-3">
          <form className="grid gap-2" onSubmit={(event) => onSecure(event, recoveryCase.id)}>
            <input name="request_id" type="hidden" value={recoveryCase.id} />
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-950">
                Secure account note
              </span>
              <textarea
                className={textareaClassName}
                name="note"
                placeholder="Why sessions and trusted devices are being revoked."
              />
            </label>
            <button className={dangerButtonClassName} disabled={isBusy} type="submit">
              {isBusy ? "Securing..." : "Secure account"}
            </button>
          </form>

          <form className="grid gap-2" onSubmit={(event) => onStatus(event, recoveryCase.id)}>
            <input name="request_id" type="hidden" value={recoveryCase.id} />
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-950">
                Account status
              </span>
              <select
                className={inputClassName}
                defaultValue={recoveryCase.user?.status ?? "active"}
                name="user_status"
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-950">
                Status note
              </span>
              <textarea
                className={textareaClassName}
                name="note"
                placeholder="Reason for suspend or restore."
              />
            </label>
            <button className={secondaryButtonClassName} disabled={isBusy} type="submit">
              {isBusy ? "Updating..." : "Update account status"}
            </button>
          </form>
        </div>
      </div>

      <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-4">
        <h3 className="text-sm font-semibold text-zinc-950">
          Support audit
        </h3>
        <CaseList
          empty="No support events have been recorded."
          items={recoveryCase.events.map((event) => (
            <li
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600"
              key={event.id}
            >
              <p className="font-semibold text-zinc-950">
                {readable(event.eventType)}
              </p>
              <p>
                {readable(event.fromStatus)} to {readable(event.toStatus)} -{" "}
                {formatDateTime(event.createdAt)}
              </p>
              {event.note ? <p className="mt-1">{event.note}</p> : null}
            </li>
          ))}
        />
      </div>
    </article>
  );
}

export function RecoveryBackOfficePanel({
  overview,
  onSaved,
}: RecoveryBackOfficePanelProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingKey, setPendingKey] = useState<PendingKey>(null);

  async function runAction(
    key: Exclude<PendingKey, null>,
    action: () => Promise<{ error: string | null; message?: string }>,
  ) {
    setError("");
    setMessage("");
    setPendingKey(key);

    try {
      const result = await action();

      if (result.error) {
        setError(result.error);
        return;
      }

      setMessage(result.message ?? "Saved.");
      if (onSaved) await onSaved(); else router.refresh();
    } catch {
      setError("Recovery back-office action could not be completed.");
    } finally {
      setPendingKey(null);
    }
  }

  function updateCase(event: FormEvent<HTMLFormElement>, requestId: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void runAction(`case:${requestId}`, () =>
      updateRecoveryBackOfficeCaseAction(formData),
    );
  }

  function secureAccount(event: FormEvent<HTMLFormElement>, requestId: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void runAction(`secure:${requestId}`, () =>
      secureRecoveryBackOfficeAccountAction(formData),
    );
  }

  function updateUserStatus(
    event: FormEvent<HTMLFormElement>,
    requestId: string,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void runAction(`status:${requestId}`, () =>
      updateRecoveryBackOfficeUserStatusAction(formData),
    );
  }

  return (
    <div className="grid gap-5">
      {overview.loadWarning ? (
        <p className="content-surface border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 rounded-none border-y shadow-none">
          {overview.loadWarning}
        </p>
      ) : null}
      {error ? (
        <p
          className="content-surface border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 rounded-none border-y shadow-none"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="content-surface border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 rounded-none border-y shadow-none"
          role="status"
        >
          {message}
        </p>
      ) : null}

      <section className="content-surface grid gap-3 border-border-subtle bg-white p-4 sm:grid-cols-4 rounded-none border-y shadow-none">
        <div className="content-surface border-zinc-200 p-3 rounded-none border-y shadow-none">
          <p className="text-xs font-semibold uppercase text-zinc-500">Total</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {overview.stats.total}
          </p>
        </div>
        <div className="content-surface border-zinc-200 p-3 rounded-none border-y shadow-none">
          <p className="text-xs font-semibold uppercase text-zinc-500">Open</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {overview.stats.open}
          </p>
        </div>
        <div className="content-surface border-zinc-200 p-3 rounded-none border-y shadow-none">
          <p className="text-xs font-semibold uppercase text-zinc-500">
            Reviewing
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {overview.stats.reviewing}
          </p>
        </div>
        <div className="content-surface border-zinc-200 p-3 rounded-none border-y shadow-none">
          <p className="text-xs font-semibold uppercase text-zinc-500">
            High risk
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {overview.stats.highRisk}
          </p>
        </div>
      </section>

      {overview.cases.length > 0 ? (
        <div className="grid gap-4">
          {overview.cases.map((recoveryCase) => (
            <RecoveryCaseCard
              isBusy={
                pendingKey === `case:${recoveryCase.id}` ||
                pendingKey === `secure:${recoveryCase.id}` ||
                pendingKey === `status:${recoveryCase.id}`
              }
              key={recoveryCase.id}
              onSecure={secureAccount}
              onStatus={updateUserStatus}
              onUpdate={updateCase}
              recoveryCase={recoveryCase}
            />
          ))}
        </div>
      ) : (
        <p className="content-surface border-zinc-300 bg-white px-4 py-6 text-sm font-semibold text-zinc-600 rounded-none border-y shadow-none">
          No recovery cases are waiting for review.
        </p>
      )}
    </div>
  );
}
