"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import {
  beginPhoneMfaEnrollmentAction,
  beginTotpEnrollmentAction,
  changeAccountPasswordAction,
  createRecoveryRequestAction,
  disableMfaFactorAction,
  generateRecoveryCodesAction,
  removeTrustedDeviceAction,
  secureMyAccountAction,
  trustCurrentDeviceAction,
  updateLoginSecurityPreferencesAction,
  verifyPhoneMfaEnrollmentAction,
  verifyTotpEnrollmentAction,
  type LoginSecurityActionResult,
  type PhoneMfaEnrollmentActionResult,
  type TotpEnrollmentActionResult,
} from "@/app/settings/login-security/actions";
import type {
  AccountLoginSession,
  AccountMfaFactor,
  LoginSecurityOverview,
} from "@/lib/account-security";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

type PendingKey =
  | "mfa-begin"
  | "mfa-disable"
  | "mfa-phone-begin"
  | "mfa-phone-verify"
  | "mfa-verify"
  | "password"
  | "preferences"
  | "recovery-codes"
  | "recovery-request"
  | "secure-account"
  | "trust-current"
  | "trusted-remove";

type QuickDialog =
  | "mfa"
  | "password"
  | "recovery-codes"
  | "recovery-contact"
  | "recovery-request"
  | "secure-account";

type TotpEnrollment = Extract<
  TotpEnrollmentActionResult,
  { error: null }
>["enrollment"];
type PhoneMfaEnrollment = Extract<
  PhoneMfaEnrollmentActionResult,
  { error: null }
>["enrollment"];

type LoginSecurityQuickEditorProps = {
  detailHref?: string;
  overview: LoginSecurityOverview | null;
  variant?: "drawer" | "page";
  passwordOnly?: boolean;
};

const inputClassName =
  "min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10";
const textareaClassName =
  "min-h-24 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10";
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

function relativeTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const ms = Date.now() - new Date(value).getTime();

  if (!Number.isFinite(ms) || ms < 0) {
    return formatDateTime(value);
  }

  const minutes = Math.floor(ms / 60000);

  if (minutes < 1) {
    return "Active now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} hr ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function maskPhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");

  if (digits.length < 4) {
    return value ?? "No phone";
  }

  return `*** *** ${digits.slice(-4)}`;
}

function factorLabel(factor: AccountMfaFactor) {
  if (factor.friendlyName) {
    return factor.friendlyName;
  }

  return factor.factorType === "phone" ? "Phone SMS" : "Authenticator app";
}

function statusBadgeClass(tone: "danger" | "neutral" | "success" | "warning") {
  return {
    danger: "bg-red-50 text-red-700 ring-red-200",
    neutral: "bg-zinc-100 text-zinc-600 ring-zinc-200",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warning: "bg-amber-50 text-amber-700 ring-amber-200",
  }[tone];
}

function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "danger" | "neutral" | "success" | "warning";
}) {
  return (
    <span
      className={[
        "inline-flex min-h-7 max-w-full items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset",
        statusBadgeClass(tone),
      ].join(" ")}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold text-zinc-950"><WorkspaceText text={label} /></span>
      {children}
    </label>
  );
}

function QuickDialogShell({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  const __vt = useWorkspaceTranslation();

  return (
    <div
      className="fixed inset-0 z-[140] grid place-items-end bg-zinc-950/35 px-0 sm:place-items-center sm:px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-label={__vt(title)}
        aria-modal="true"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl outline-none sm:max-w-lg sm:rounded-xl sm:p-5"
        role="dialog"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-zinc-950"><WorkspaceText text={title} /></h3>
          <button
            className="min-h-10 rounded-md px-3 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            onClick={onClose}
            type="button"
          >
            <WorkspaceText text="Close" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function QuickActionRow({
  actionLabel,
  children,
  description,
  disabled,
  href,
  label,
  onAction,
  status,
  tone = "neutral",
  compact = false,
}: {
  compact?: boolean;
  actionLabel?: string;
  children?: ReactNode;
  description: string;
  disabled?: boolean;
  href?: string;
  label: string;
  onAction?: () => void;
  status: string;
  tone?: "danger" | "neutral" | "success" | "warning";
}) {
  return (
    <div className="border-b border-zinc-100 px-4 py-3 last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-zinc-950"><WorkspaceText text={label} /></p>
            {!compact?<StatusBadge tone={tone}><WorkspaceText text={status} /></StatusBadge>:null}
          </div>
          {!compact?<p className="mt-1 text-sm leading-6 text-zinc-500">{description}</p>:null}
        </div>
        {href ? (
          <Link className={secondaryButtonClassName} href={href}>
            <WorkspaceText text={actionLabel ?? "Open"} />
          </Link>
        ) : onAction ? (
          <button
            className={
              tone === "danger" ? dangerButtonClassName : secondaryButtonClassName
            }
            disabled={disabled}
            onClick={onAction}
            type="button"
          >
            <WorkspaceText text={actionLabel ?? "Edit"} />
          </button>
        ) : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

function QuickSwitch({
  checked,
  disabled,
  label,
  note,
  onToggle,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  note: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-left transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onToggle}
      role="switch"
      type="button"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-950">
          <WorkspaceText text={label} />
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-zinc-500">
          {note}
        </span>
      </span>
      <span
        className={[
          "relative h-7 w-12 rounded-full p-1 transition",
          checked ? "bg-zinc-950" : "bg-zinc-300",
        ].join(" ")}
      >
        <span
          className={[
            "block h-5 w-5 rounded-full bg-white shadow-sm transition",
            checked ? "translate-x-5" : "translate-x-0",
          ].join(" ")}
        />
      </span>
    </button>
  );
}

function SessionMiniList({
  detailHref,
  sessions,
}: {
  detailHref: string;
  sessions: AccountLoginSession[];
}) {
  const preview = sessions.slice(0, 2);

  if (preview.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
        <WorkspaceText text="No active sessions were found." />
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {preview.map((session) => (
        <div
          className="grid gap-2 border-b border-zinc-100 px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          key={session.id ?? "current-session"}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-zinc-950">
                <WorkspaceText text={session.deviceLabel} />
              </p>
              {session.isCurrent ? (
                <StatusBadge tone="success"><WorkspaceText text="Current" /></StatusBadge>
              ) : null}
              {session.trustedAt ? (
                <StatusBadge tone="neutral"><WorkspaceText text="Trusted" /></StatusBadge>
              ) : null}
            </div>
            <p className="mt-1 truncate text-xs font-semibold text-zinc-500">
              <WorkspaceText text={session.locationLabel} /> - <WorkspaceText text={relativeTime(session.lastSeenAt)} />
            </p>
          </div>
          <Link
            className="min-h-9 rounded-md px-2 text-sm font-semibold text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            href={detailHref}
          >
            <WorkspaceText text="Detail" />
          </Link>
        </div>
      ))}
    </div>
  );
}

export function LoginSecurityQuickEditor({
  detailHref = "/settings/login-security",
  overview,
  variant = "drawer",
  passwordOnly = false,
}: LoginSecurityQuickEditorProps) {
  const __vt = useWorkspaceTranslation();

  const router = useRouter();
  const [dialog, setDialog] = useState<QuickDialog | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingKey, setPendingKey] = useState<PendingKey | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollment | null>(
    null,
  );
  const [phoneMfaEnrollment, setPhoneMfaEnrollment] =
    useState<PhoneMfaEnrollment | null>(null);
  const [preferences, setPreferences] = useState(() => ({
    loginAlertsEnabled: overview?.preferences.loginAlertsEnabled ?? true,
    recoveryEmail: overview?.preferences.recoveryEmail ?? "",
    recoveryPhone: overview?.preferences.recoveryPhone ?? "",
    smsLoginAlertsEnabled:
      overview?.preferences.smsLoginAlertsEnabled ?? Boolean(overview?.account.phone),
  }));

  if (!overview) {
    return (
      <div className="settings-style"><div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
        <WorkspaceText text="Login security could not be loaded in this session." />
      </div></div>
    );
  }

  const hasVerifiedMfa = overview.mfa.factors.some(
    (factor) => factor.status === "verified",
  );
  const currentSession = overview.sessions.find((session) => session.isCurrent);
  const currentTrustedDevice =
    overview.trustedDevices.find((device) => device.isCurrent) ?? null;
  const currentDeviceTrusted = Boolean(
    currentSession?.trustedAt || currentTrustedDevice,
  );
  const verifiedFactors = overview.mfa.factors.filter(
    (factor) => factor.status === "verified",
  );
  const mfaStatus = hasVerifiedMfa
    ? `${verifiedFactors.length} enabled`
    : "Not enabled";
  const recoveryContactStatus =
    preferences.recoveryEmail || preferences.recoveryPhone ? "Saved" : "Missing";
  const isBusy = pendingKey !== null;

  async function runAction(
    key: PendingKey,
    action: () => Promise<LoginSecurityActionResult>,
    options: {
      onError?: () => void;
      onSuccess?: (result: LoginSecurityActionResult) => void;
      refresh?: boolean;
    } = {},
  ) {
    setError("");
    setMessage("");
    setPendingKey(key);

    try {
      const result = await action();

      if (result.redirectTo) {
        router.replace(result.redirectTo);
        router.refresh();
        return;
      }

      if (result.error !== null) {
        setError(result.error);
        options.onError?.();
        return;
      }

      options.onSuccess?.(result);
      setMessage(result.message ?? "Saved.");

      if (options.refresh !== false) {
        router.refresh();
      }
    } catch {
      setError("This action could not be completed. Check your connection and try again.");
      options.onError?.();
    } finally {
      setPendingKey(null);
    }
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    void runAction("password", async () => {
      const result = await changeAccountPasswordAction(formData);

      if (result.error === null) {
        form.reset();
      }

      return result;
    }, {
      onSuccess: () => setDialog(null),
    });
  }

  function submitRecoveryContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const next = {
      loginAlertsEnabled: preferences.loginAlertsEnabled,
      recoveryEmail: String(formData.get("recovery_email") ?? ""),
      recoveryPhone: String(formData.get("recovery_phone") ?? ""),
      smsLoginAlertsEnabled: preferences.smsLoginAlertsEnabled,
    };

    void runAction(
      "preferences",
      () =>
        updateLoginSecurityPreferencesAction({
          login_alerts_enabled: next.loginAlertsEnabled,
          recovery_email: next.recoveryEmail,
          recovery_phone: next.recoveryPhone,
          sms_login_alerts_enabled: next.smsLoginAlertsEnabled,
        }),
      {
        onSuccess: () => {
          setPreferences(next);
          setDialog(null);
        },
      },
    );
  }

  function savePreferencePatch(next: typeof preferences) {
    const previous = preferences;

    setPreferences(next);
    void runAction(
      "preferences",
      () =>
        updateLoginSecurityPreferencesAction({
          login_alerts_enabled: next.loginAlertsEnabled,
          recovery_email: next.recoveryEmail,
          recovery_phone: next.recoveryPhone,
          sms_login_alerts_enabled: next.smsLoginAlertsEnabled,
        }),
      {
        onError: () => setPreferences(previous),
        onSuccess: () => setPreferences(next),
        refresh: false,
      },
    );
  }

  function toggleCurrentDeviceTrust() {
    if (currentTrustedDevice) {
      void runAction("trusted-remove", () =>
        removeTrustedDeviceAction({ trusted_device_id: currentTrustedDevice.id }),
      );
      return;
    }

    void runAction("trust-current", () => trustCurrentDeviceAction());
  }

  function beginTotpEnrollment() {
    setError("");
    setMessage("");
    setPhoneMfaEnrollment(null);
    setDialog("mfa");
    setPendingKey("mfa-begin");

    void beginTotpEnrollmentAction()
      .then((result) => {
        if (result.error !== null) {
          setError(result.error);
          return;
        }

        setTotpEnrollment(result.enrollment);
        setMessage(result.message);
      })
      .catch(() => {
        setError("Two-factor authentication setup could not be started.");
      })
      .finally(() => setPendingKey(null));
  }

  function beginPhoneMfaEnrollment() {
    setError("");
    setMessage("");
    setTotpEnrollment(null);
    setPhoneMfaEnrollment(null);
    setDialog("mfa");
    setPendingKey("mfa-phone-begin");

    void beginPhoneMfaEnrollmentAction()
      .then((result) => {
        if (result.error !== null) {
          setError(result.error);
          return;
        }

        setPhoneMfaEnrollment(result.enrollment);
        setMessage(result.message);
      })
      .catch(() => {
        setError("Phone two-factor code could not be sent.");
      })
      .finally(() => setPendingKey(null));
  }

  function submitTotpVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    void runAction("mfa-verify", async () => {
      const result = await verifyTotpEnrollmentAction(formData);

      if (result.error === null) {
        setTotpEnrollment(null);
        form.reset();
      }

      return result;
    });
  }

  function submitPhoneMfaVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    void runAction("mfa-phone-verify", async () => {
      const result = await verifyPhoneMfaEnrollmentAction(formData);

      if (result.error === null) {
        setPhoneMfaEnrollment(null);
        form.reset();
      }

      return result;
    });
  }

  function generateRecoveryCodes() {
    setDialog("recovery-codes");
    setRecoveryCodes([]);
    setError("");
    setMessage("");
    setPendingKey("recovery-codes");

    void generateRecoveryCodesAction()
      .then((result) => {
        if (result.error !== null) {
          setError(result.error);
          return;
        }

        setRecoveryCodes(result.codes);
        setMessage(result.message);
        router.refresh();
      })
      .catch(() => {
        setError("Recovery codes could not be generated.");
      })
      .finally(() => setPendingKey(null));
  }

  function submitSecureAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    void runAction("secure-account", () => secureMyAccountAction(formData), {
      onSuccess: () => setDialog(null),
    });
  }

  function submitRecoveryRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    void runAction("recovery-request", async () => {
      const result = await createRecoveryRequestAction(formData);

      if (result.error === null) {
        form.reset();
      }

      return result;
    }, {
      onSuccess: () => setDialog(null),
    });
  }

  function closeDialog() {
    setDialog(null);
    setTotpEnrollment(null);
    setPhoneMfaEnrollment(null);
  }

  return (
    <div className="settings-style"><div className="grid gap-4">
      {overview.dataUnavailableReason ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
          {overview.dataUnavailableReason}
        </p>
      ) : null}

      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
          role="alert"
        >
          <WorkspaceText text={error} />
        </p>
      ) : null}
      {message ? (
        <p
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
          role="status"
        >
          <WorkspaceText text={message} />
        </p>
      ) : null}

      <section id={variant === "page" ? "quick-actions" : undefined}>
        {variant === "page" && !passwordOnly ? (
          <div className="mb-2">
            <h2 className="text-base font-semibold text-zinc-950">
              <WorkspaceText text="Quick actions" />
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-500">
              <WorkspaceText text="Open a row, change one thing, save, and stay in context." />
            </p>
          </div>
        ) : null}
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <QuickActionRow
            compact={passwordOnly}
            actionLabel="Change"
            description={__vt("Update the email password. Other sessions are signed out after saving.")}
            disabled={isBusy || !overview.account.email}
            label={__vt("Change password")}
            onAction={() => setDialog("password")}
            status={overview.account.email ? "Available" : "No email password"}
            tone={overview.account.email ? "success" : "warning"}
          />

          {!passwordOnly ? <>
          <QuickActionRow
            actionLabel="Detail"
            description={__vt("A short view of active devices and browsers.")}
            href={`${detailHref}#sessions`}
            label={__vt("Where you're logged in")}
            status={`${overview.sessions.length} session${
              overview.sessions.length === 1 ? "" : "s"
            }`}
          >
            <SessionMiniList
              detailHref={`${detailHref}#sessions`}
              sessions={overview.sessions}
            />
          </QuickActionRow>

          <QuickActionRow
            actionLabel={
              currentTrustedDevice
                ? "Disable"
                : currentDeviceTrusted
                  ? "Refresh"
                  : "Enable"
            }
            description={__vt("Remember this device, or remove trust from the current device.")}
            disabled={isBusy || !currentSession}
            label={__vt("Trusted device")}
            onAction={toggleCurrentDeviceTrust}
            status={currentDeviceTrusted ? "Enabled" : "Not enabled"}
            tone={currentDeviceTrusted ? "success" : "warning"}
          />

          <QuickActionRow
            actionLabel={hasVerifiedMfa ? "Manage" : "Enable"}
            description={__vt("Enable SMS/authenticator 2FA or disable an existing method.")}
            disabled={isBusy || Boolean(overview.mfa.unavailableReason)}
            label={__vt("Two-factor authentication")}
            onAction={() => {
              if (hasVerifiedMfa) {
                setDialog("mfa");
              } else if (overview.account.phone) {
                beginPhoneMfaEnrollment();
              } else {
                beginTotpEnrollment();
              }
            }}
            status={mfaStatus}
            tone={hasVerifiedMfa ? "success" : "warning"}
          >
            {overview.mfa.unavailableReason ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                {overview.mfa.unavailableReason}
              </p>
            ) : null}
          </QuickActionRow>

          <div className="grid gap-2 border-b border-zinc-100 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Login alerts" /></p>
              <StatusBadge
                tone={preferences.loginAlertsEnabled ? "success" : "warning"}
              >
                <WorkspaceText text={preferences.loginAlertsEnabled ? "On" : "Off"} />
              </StatusBadge>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <QuickSwitch
                checked={preferences.loginAlertsEnabled}
                disabled={isBusy}
                label={__vt("In-app alerts")}
                note="Save immediately when toggled."
                onToggle={() =>
                  savePreferencePatch({
                    ...preferences,
                    loginAlertsEnabled: !preferences.loginAlertsEnabled,
                  })
                }
              />
              <QuickSwitch
                checked={
                  preferences.smsLoginAlertsEnabled && Boolean(overview.account.phone)
                }
                disabled={isBusy || !overview.account.phone}
                label={__vt("SMS alerts")}
                note={
                  overview.account.phone
                    ? `Send to ${maskPhone(overview.account.phone)}.`
                    : "Add a profile phone first."
                }
                onToggle={() =>
                  savePreferencePatch({
                    ...preferences,
                    smsLoginAlertsEnabled: !preferences.smsLoginAlertsEnabled,
                  })
                }
              />
            </div>
          </div>

          <QuickActionRow
            actionLabel="Edit"
            description={__vt("Recovery email and phone used for risky login and access recovery.")}
            label={__vt("Recovery contacts")}
            onAction={() => setDialog("recovery-contact")}
            status={recoveryContactStatus}
            tone={recoveryContactStatus === "Saved" ? "success" : "warning"}
          />

          <QuickActionRow
            actionLabel="Generate"
            description={__vt("Create one-time backup codes. New codes replace unused old codes.")}
            disabled={isBusy}
            label={__vt("Recovery codes")}
            onAction={generateRecoveryCodes}
            status={
              overview.recoveryCodes.unused > 0
                ? `${overview.recoveryCodes.unused} unused`
                : "None"
            }
            tone={overview.recoveryCodes.unused > 0 ? "success" : "warning"}
          />

          <QuickActionRow
            actionLabel="Request"
            description={__vt("Open a recovery case for lost access, a lost device, or account takeover.")}
            disabled={isBusy}
            label={__vt("Account recovery")}
            onAction={() => setDialog("recovery-request")}
            status={`${overview.recoveryRequests.length} recent`}
          />

          <QuickActionRow
            actionLabel="Start"
            description={__vt("Use this when a password, phone, or device may be compromised.")}
            disabled={isBusy}
            label={__vt("Secure my account")}
            onAction={() => setDialog("secure-account")}
            status="High impact"
            tone="danger"
          />
          </> : null}
        </div>
      </section>

      {variant === "drawer" ? (
        <Link
          className="inline-flex min-h-11 w-fit items-center justify-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          href={detailHref}
        >
          <WorkspaceText text="Open full security setup" />
        </Link>
      ) : null}

      {dialog === "password" ? (
        <QuickDialogShell onClose={closeDialog} title={__vt("Change password")}>
          <form className="grid gap-3" onSubmit={submitPassword}>
            <Field label={__vt("Current password")}>
              <input
                autoComplete="current-password"
                className={inputClassName}
                name="current_password"
                required
                type="password"
              />
            </Field>
            <Field label={__vt("New password")}>
              <input
                autoComplete="new-password"
                className={inputClassName}
                minLength={8}
                name="new_password"
                required
                type="password"
              />
            </Field>
            <Field label={__vt("Confirm new password")}>
              <input
                autoComplete="new-password"
                className={inputClassName}
                minLength={8}
                name="confirm_password"
                required
                type="password"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button
                className={secondaryButtonClassName}
                onClick={closeDialog}
                type="button"
              >
                <WorkspaceText text="Cancel" />
              </button>
              <button
                className={primaryButtonClassName}
                disabled={isBusy}
                type="submit"
              >
                <WorkspaceText text={pendingKey === "password" ? "Saving..." : "Save"} />
              </button>
            </div>
          </form>
        </QuickDialogShell>
      ) : null}

      {dialog === "recovery-contact" ? (
        <QuickDialogShell onClose={closeDialog} title={__vt("Recovery contacts")}>
          <form className="grid gap-3" onSubmit={submitRecoveryContact}>
            <Field label={__vt("Recovery email")}>
              <input
                autoComplete="email"
                className={inputClassName}
                defaultValue={preferences.recoveryEmail}
                name="recovery_email"
                type="email"
              />
            </Field>
            <Field label={__vt("Recovery phone")}>
              <input
                autoComplete="tel"
                className={inputClassName}
                defaultValue={preferences.recoveryPhone}
                name="recovery_phone"
                type="tel"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button
                className={secondaryButtonClassName}
                onClick={closeDialog}
                type="button"
              >
                <WorkspaceText text="Cancel" />
              </button>
              <button
                className={primaryButtonClassName}
                disabled={isBusy}
                type="submit"
              >
                <WorkspaceText text={pendingKey === "preferences" ? "Saving..." : "Save"} />
              </button>
            </div>
          </form>
        </QuickDialogShell>
      ) : null}

      {dialog === "mfa" ? (
        <QuickDialogShell onClose={closeDialog} title={__vt("Two-factor authentication")}>
          <div className="grid gap-4">
            {verifiedFactors.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-zinc-200">
                {verifiedFactors.map((factor) => (
                  <div
                    className="grid gap-3 border-b border-zinc-100 px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    key={factor.id}
                  >
                    <div>
                      <p className="text-sm font-semibold text-zinc-950">
                        <WorkspaceText text={factorLabel(factor)} />
                      </p>
                      <p className="mt-1 text-xs font-semibold text-zinc-500">
                        <WorkspaceText text="Enabled" /> <WorkspaceText text={formatDateTime(factor.createdAt)} />
                      </p>
                    </div>
                    <button
                      className={secondaryButtonClassName}
                      disabled={isBusy}
                      onClick={() =>
                        void runAction("mfa-disable", () =>
                          disableMfaFactorAction({
                            factor_id: factor.id,
                            factor_type: factor.factorType,
                          }),
                        )
                      }
                      type="button"
                    >
                      <WorkspaceText text={pendingKey === "mfa-disable" ? "Disabling..." : "Disable"} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
                <WorkspaceText text="No two-factor method is connected." />
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                className={secondaryButtonClassName}
                disabled={isBusy}
                onClick={beginTotpEnrollment}
                type="button"
              >
                <WorkspaceText text={pendingKey === "mfa-begin" ? "Starting..." : "Use authenticator"} />
              </button>
              <button
                className={secondaryButtonClassName}
                disabled={isBusy || !overview.account.phone}
                onClick={beginPhoneMfaEnrollment}
                type="button"
              >
                <WorkspaceText text={pendingKey === "mfa-phone-begin" ? "Sending..." : "Use SMS"} />
              </button>
            </div>
            {!overview.account.phone ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                <WorkspaceText text="Verify a profile phone before using SMS 2FA." />
              </p>
            ) : null}

            {totpEnrollment ? (
              <form
                className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3"
                onSubmit={submitTotpVerification}
              >
                <input
                  name="factor_id"
                  type="hidden"
                  value={totpEnrollment.factorId}
                />
                {totpEnrollment.qrCode ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={__vt("Authenticator QR code")}
                    className="h-36 w-36 rounded-md border border-zinc-200 bg-white p-2"
                    src={totpEnrollment.qrCode}
                  />
                ) : null}
                {totpEnrollment.secret ? (
                  <p className="break-all rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-sm text-zinc-950">
                    {totpEnrollment.secret}
                  </p>
                ) : null}
                <Field label={__vt("Authenticator code")}>
                  <input
                    autoComplete="one-time-code"
                    className={inputClassName}
                    inputMode="numeric"
                    maxLength={8}
                    name="code"
                    required
                  />
                </Field>
                <button
                  className={primaryButtonClassName}
                  disabled={isBusy}
                  type="submit"
                >
                  <WorkspaceText text={pendingKey === "mfa-verify" ? "Verifying..." : "Enable"} />
                </button>
              </form>
            ) : null}

            {phoneMfaEnrollment ? (
              <form
                className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3"
                onSubmit={submitPhoneMfaVerification}
              >
                <input
                  name="factor_id"
                  type="hidden"
                  value={phoneMfaEnrollment.factorId}
                />
                <input
                  name="challenge_id"
                  type="hidden"
                  value={phoneMfaEnrollment.challengeId}
                />
                <p className="text-sm font-semibold text-zinc-950">
                  <WorkspaceText text="Code sent to" /> {phoneMfaEnrollment.phone}
                </p>
                <Field label={__vt("SMS code")}>
                  <input
                    autoComplete="one-time-code"
                    className={inputClassName}
                    inputMode="numeric"
                    maxLength={8}
                    name="code"
                    required
                  />
                </Field>
                <button
                  className={primaryButtonClassName}
                  disabled={isBusy}
                  type="submit"
                >
                  <WorkspaceText text={pendingKey === "mfa-phone-verify" ? "Verifying..." : "Enable"} />
                </button>
              </form>
            ) : null}
          </div>
        </QuickDialogShell>
      ) : null}

      {dialog === "recovery-codes" ? (
        <QuickDialogShell onClose={closeDialog} title={__vt("Recovery codes")}>
          <div className="grid gap-3">
            {pendingKey === "recovery-codes" ? (
              <p className="text-sm font-semibold text-zinc-600">
                <WorkspaceText text="Generating codes..." />
              </p>
            ) : null}
            {recoveryCodes.length > 0 ? (
              <>
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                  <WorkspaceText text="Save these codes now. They will not be shown again." />
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {recoveryCodes.map((code) => (
                    <code
                      className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-950"
                      key={code}
                    >
                      {code}
                    </code>
                  ))}
                </div>
              </>
            ) : null}
            <button
              className={secondaryButtonClassName}
              disabled={isBusy}
              onClick={generateRecoveryCodes}
              type="button"
            >
              <WorkspaceText text="Generate again" />
            </button>
          </div>
        </QuickDialogShell>
      ) : null}

      {dialog === "recovery-request" ? (
        <QuickDialogShell onClose={closeDialog} title={__vt("Account recovery")}>
          <form className="grid gap-3" onSubmit={submitRecoveryRequest}>
            <Field label={__vt("Recovery issue")}>
              <select
                className={inputClassName}
                defaultValue="lost_access"
                name="request_type"
              >
                <option value="lost_access"><WorkspaceText text="Lost email or phone" /></option>
                <option value="lost_device"><WorkspaceText text="Lost device" /></option>
                <option value="account_compromised"><WorkspaceText text="Account taken over" /></option>
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={__vt("Contact email")}>
                <input
                  autoComplete="email"
                  className={inputClassName}
                  defaultValue={preferences.recoveryEmail}
                  name="contact_email"
                  type="email"
                />
              </Field>
              <Field label={__vt("Contact phone")}>
                <input
                  autoComplete="tel"
                  className={inputClassName}
                  defaultValue={preferences.recoveryPhone}
                  name="contact_phone"
                  type="tel"
                />
              </Field>
            </div>
            <Field label={__vt("Details")}>
              <textarea
                className={textareaClassName}
                name="details"
                placeholder={__vt("What happened?")}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button
                className={secondaryButtonClassName}
                onClick={closeDialog}
                type="button"
              >
                <WorkspaceText text="Cancel" />
              </button>
              <button
                className={primaryButtonClassName}
                disabled={isBusy}
                type="submit"
              >
                <WorkspaceText text={pendingKey === "recovery-request" ? "Creating..." : "Create"} />
              </button>
            </div>
          </form>
        </QuickDialogShell>
      ) : null}

      {dialog === "secure-account" ? (
        <QuickDialogShell onClose={closeDialog} title={__vt("Secure my account")}>
          <form className="grid gap-3" onSubmit={submitSecureAccount}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={__vt("Safe contact email")}>
                <input
                  autoComplete="email"
                  className={inputClassName}
                  defaultValue={preferences.recoveryEmail}
                  name="contact_email"
                  type="email"
                />
              </Field>
              <Field label={__vt("Safe contact phone")}>
                <input
                  autoComplete="tel"
                  className={inputClassName}
                  defaultValue={preferences.recoveryPhone}
                  name="contact_phone"
                  type="tel"
                />
              </Field>
            </div>
            <Field label={__vt("What looks wrong?")}>
              <textarea
                className={textareaClassName}
                name="details"
                placeholder={__vt("Unknown login, lost phone, password shared...")}
              />
            </Field>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
              <button
                className={secondaryButtonClassName}
                onClick={() => setDialog("recovery-contact")}
                type="button"
              >
                <WorkspaceText text="Edit recovery contact" />
              </button>
              <button
                className={dangerButtonClassName}
                disabled={isBusy}
                type="submit"
              >
                <WorkspaceText text={pendingKey === "secure-account" ? "Securing..." : "Start"} />
              </button>
            </div>
          </form>
        </QuickDialogShell>
      ) : null}
    </div></div>
  );
}
