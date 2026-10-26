"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
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
  children: React.ReactNode;
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
  const __vt = useWorkspaceTranslation();

  return (
    <article className="content-surface border-zinc-200 bg-white rounded-none border-y shadow-none">
      <div className="grid gap-3 border-b border-zinc-100 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-950">
              {readable(recoveryCase.requestType)}
            </h2>
            <Badge className={statusTone(recoveryCase.status)}>
              <WorkspaceText text={readable(recoveryCase.status)} />
            </Badge>
            <Badge className={riskTone(recoveryCase.riskLevel)}>
              {readable(recoveryCase.riskLevel)}
            </Badge>
            {recoveryCase.recoveryCodeVerified ? (
              <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">
                <WorkspaceText text="Recovery code verified" />
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
          <p><WorkspaceText text="Created" /> <WorkspaceText text={formatDateTime(recoveryCase.createdAt)} /></p>
          <p><WorkspaceText text="Updated" /> <WorkspaceText text={formatDateTime(recoveryCase.updatedAt)} /></p>
        </div>
      </div>

      <div className="grid gap-4 px-4 py-4 lg:grid-cols-2">
        <div className="grid gap-3">
          <div className="content-surface border-zinc-200 bg-zinc-50 p-3 rounded-none border-y shadow-none">
            <h3 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Account" /></h3>
            <dl className="mt-2 grid gap-1 text-sm text-zinc-600">
              <div><WorkspaceText text="Email:" /> {recoveryCase.user?.email ?? "-"}</div>
              <div><WorkspaceText text="Profile phone:" /> {recoveryCase.user?.phone ?? "-"}</div>
              <div><WorkspaceText text="Status:" /> <WorkspaceText text={recoveryCase.user?.status ?? "-"} /></div>
              <div>
                <WorkspaceText text="Recovery code:" />{" "}
                <WorkspaceText text={recoveryCase.recoveryCodeVerified ? "verified" : "not used"} />
              </div>
              <div>
                <WorkspaceText text="Last login:" /> <WorkspaceText text={formatDateTime(recoveryCase.user?.last_login_at)} />
              </div>
              <div><WorkspaceText text="Recovery email:" /> {recoveryCase.preferences?.recoveryEmail ?? "-"}</div>
              <div><WorkspaceText text="Recovery phone:" /> {recoveryCase.preferences?.recoveryPhone ?? "-"}</div>
              <div>
                <WorkspaceText text="SMS alerts:" />{" "}
                <WorkspaceText text={recoveryCase.preferences?.smsLoginAlertsEnabled
                  ? "on"
                  : "off"} />
              </div>
            </dl>
          </div>

          <div className="content-surface border-zinc-200 bg-zinc-50 p-3 rounded-none border-y shadow-none">
            <h3 className="text-sm font-semibold text-zinc-950">
              <WorkspaceText text="Request details" />
            </h3>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              <WorkspaceText text={recoveryCase.details || "No details provided."} />
            </p>
            <p className="mt-2 text-sm text-zinc-600">
              <WorkspaceText text="Contact:" /> {recoveryCase.contactEmail ?? "-"} /{" "}
              {recoveryCase.contactPhone ?? "-"}
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="content-surface border-zinc-200 bg-zinc-50 p-3 rounded-none border-y shadow-none">
            <h3 className="text-sm font-semibold text-zinc-950">
              <WorkspaceText text="Recent sessions" />
            </h3>
            <CaseList
              empty="No login sessions found."
              items={recoveryCase.sessions.map((session) => (
                <li
                  className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600"
                  key={session.id}
                >
                  <p className="font-semibold text-zinc-950">
                    <WorkspaceText text={session.deviceLabel} />
                  </p>
                  <p>
                    <WorkspaceText text={session.locationLabel} /> -{" "}
                    <WorkspaceText text={formatDateTime(session.lastSeenAt)} />
                  </p>
                  <p>
                    <WorkspaceText text={session.revokedAt ? "Revoked" : "Active"} />
                    <WorkspaceText text={session.trustedAt ? " - trusted" : ""} />
                  </p>
                </li>
              ))}
            />
          </div>

          <div className="content-surface border-zinc-200 bg-zinc-50 p-3 rounded-none border-y shadow-none">
            <h3 className="text-sm font-semibold text-zinc-950">
              <WorkspaceText text="Recent activity" />
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
                    <WorkspaceText text={activity.deviceLabel} /> - <WorkspaceText text={activity.locationLabel} />
                  </p>
                  <p><WorkspaceText text={formatDateTime(activity.createdAt)} /></p>
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
              <span className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Status" /></span>
              <select
                className={inputClassName}
                defaultValue={recoveryCase.status}
                name="status"
              >
                <option value="open"><WorkspaceText text="Open" /></option>
                <option value="reviewing"><WorkspaceText text="Reviewing" /></option>
                <option value="needs_info"><WorkspaceText text="Needs info" /></option>
                <option value="approved"><WorkspaceText text="Approved" /></option>
                <option value="denied"><WorkspaceText text="Denied" /></option>
                <option value="resolved"><WorkspaceText text="Resolved" /></option>
                <option value="cancelled"><WorkspaceText text="Cancelled" /></option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Priority" /></span>
              <select
                className={inputClassName}
                defaultValue={recoveryCase.priority}
                name="priority"
              >
                <option value="low"><WorkspaceText text="Low" /></option>
                <option value="normal"><WorkspaceText text="Normal" /></option>
                <option value="high"><WorkspaceText text="High" /></option>
                <option value="urgent"><WorkspaceText text="Urgent" /></option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Risk" /></span>
              <select
                className={inputClassName}
                defaultValue={recoveryCase.riskLevel}
                name="risk_level"
              >
                <option value="unknown"><WorkspaceText text="Unknown" /></option>
                <option value="low"><WorkspaceText text="Low" /></option>
                <option value="medium"><WorkspaceText text="Medium" /></option>
                <option value="high"><WorkspaceText text="High" /></option>
                <option value="critical"><WorkspaceText text="Critical" /></option>
              </select>
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-zinc-950">
              <WorkspaceText text="Internal note" />
            </span>
            <textarea
              className={textareaClassName}
              name="note"
              placeholder={__vt("Verification steps, evidence, decision reason...")}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-zinc-950">
              <WorkspaceText text="Resolution summary" />
            </span>
            <textarea
              className={textareaClassName}
              defaultValue={recoveryCase.resolutionSummary ?? ""}
              name="resolution_summary"
              placeholder={__vt("Visible resolution summary for this case.")}
            />
          </label>
          <div>
            <button className={primaryButtonClassName} disabled={isBusy} type="submit">
              <WorkspaceText text={isBusy ? "Saving..." : "Save review"} />
            </button>
          </div>
        </form>

        <div className="grid gap-3">
          <form className="grid gap-2" onSubmit={(event) => onSecure(event, recoveryCase.id)}>
            <input name="request_id" type="hidden" value={recoveryCase.id} />
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-950">
                <WorkspaceText text="Secure account note" />
              </span>
              <textarea
                className={textareaClassName}
                name="note"
                placeholder={__vt("Why sessions and trusted devices are being revoked.")}
              />
            </label>
            <button className={dangerButtonClassName} disabled={isBusy} type="submit">
              <WorkspaceText text={isBusy ? "Securing..." : "Secure account"} />
            </button>
          </form>

          <form className="grid gap-2" onSubmit={(event) => onStatus(event, recoveryCase.id)}>
            <input name="request_id" type="hidden" value={recoveryCase.id} />
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-950">
                <WorkspaceText text="Account status" />
              </span>
              <select
                className={inputClassName}
                defaultValue={recoveryCase.user?.status ?? "active"}
                name="user_status"
              >
                <option value="active"><WorkspaceText text="Active" /></option>
                <option value="suspended"><WorkspaceText text="Suspended" /></option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-zinc-950">
                <WorkspaceText text="Status note" />
              </span>
              <textarea
                className={textareaClassName}
                name="note"
                placeholder={__vt("Reason for suspend or restore.")}
              />
            </label>
            <button className={secondaryButtonClassName} disabled={isBusy} type="submit">
              <WorkspaceText text={isBusy ? "Updating..." : "Update account status"} />
            </button>
          </form>
        </div>
      </div>

      <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-4">
        <h3 className="text-sm font-semibold text-zinc-950">
          <WorkspaceText text="Support audit" />
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
                <WorkspaceText text={readable(event.fromStatus)} /> <WorkspaceText text="to" /> <WorkspaceText text={readable(event.toStatus)} /> -{" "}
                <WorkspaceText text={formatDateTime(event.createdAt)} />
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
    <div className="settings-style"><div className="grid gap-5">
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
          <WorkspaceText text={error} />
        </p>
      ) : null}
      {message ? (
        <p
          className="content-surface border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 rounded-none border-y shadow-none"
          role="status"
        >
          <WorkspaceText text={message} />
        </p>
      ) : null}

      <section className="content-surface grid gap-3 border-border-subtle bg-white p-4 sm:grid-cols-4 rounded-none border-y shadow-none">
        <div className="content-surface border-zinc-200 p-3 rounded-none border-y shadow-none">
          <p className="text-xs font-semibold uppercase text-zinc-500"><WorkspaceText text="Total" /></p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {overview.stats.total}
          </p>
        </div>
        <div className="content-surface border-zinc-200 p-3 rounded-none border-y shadow-none">
          <p className="text-xs font-semibold uppercase text-zinc-500"><WorkspaceText text="Open" /></p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {overview.stats.open}
          </p>
        </div>
        <div className="content-surface border-zinc-200 p-3 rounded-none border-y shadow-none">
          <p className="text-xs font-semibold uppercase text-zinc-500">
            <WorkspaceText text="Reviewing" />
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {overview.stats.reviewing}
          </p>
        </div>
        <div className="content-surface border-zinc-200 p-3 rounded-none border-y shadow-none">
          <p className="text-xs font-semibold uppercase text-zinc-500">
            <WorkspaceText text="High risk" />
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
          <WorkspaceText text="No recovery cases are waiting for review." />
        </p>
      )}
    </div></div>
  );
}
