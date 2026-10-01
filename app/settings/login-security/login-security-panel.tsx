"use client";

import {
  beginPhoneMfaEnrollmentAction,
  beginTotpEnrollmentAction,
  createRecoveryRequestAction,
  disableMfaFactorAction,
  generateRecoveryCodesAction,
  logOutAllSessionsAction,
  logOutCurrentSessionAction,
  removeTrustedDeviceAction,
  revokeLoginSessionAction,
  secureMyAccountAction,
  trustCurrentDeviceAction,
  updateLoginSecurityPreferencesAction,
  verifyPhoneMfaEnrollmentAction,
  verifyTotpEnrollmentAction,
  type LoginSecurityActionResult,
  type PhoneMfaEnrollmentActionResult,
  type TotpEnrollmentActionResult,
} from "@/app/settings/login-security/actions";
import { LoginSecurityQuickEditor } from "@/app/settings/login-security/login-security-quick-editor";
import type {
  AccountLoginActivity,
  AccountLoginSession,
  AccountMfaFactor,
  AccountRecoveryRequest,
  AccountTrustedDevice,
  LoginSecurityOverview,
} from "@/lib/account-security";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type LoginSecurityPanelProps = {
  overview: LoginSecurityOverview;
};

type PendingKey =
  | "mfa-begin"
  | "mfa-disable"
  | "mfa-phone-begin"
  | "mfa-phone-verify"
  | "mfa-verify"
  | "preferences"
  | "recovery-codes"
  | "recovery-request"
  | "secure-account"
  | "session-all"
  | "session-current"
  | "session-revoke"
  | "trust-current"
  | "trusted-remove";

type TotpEnrollment = Extract<
  TotpEnrollmentActionResult,
  { error: null }
>["enrollment"];
type PhoneMfaEnrollment = Extract<
  PhoneMfaEnrollmentActionResult,
  { error: null }
>["enrollment"];

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

function activityLabel(type: string) {
  return {
    all_sessions_logged_out: "Logged out all sessions",
    login_success: "Login",
    login_sms_alert_failed: "SMS login alert failed",
    login_sms_alert_sent: "SMS login alert sent",
    password_changed: "Password changed",
    preferences_updated: "Preferences updated",
    recovery_codes_generated: "Recovery codes generated",
    recovery_code_redeemed: "Recovery code used",
    recovery_request_created: "Recovery request created",
    secure_account_started: "Secure my account",
    session_logged_out: "Session logged out",
    session_revoked: "Session revoked",
    trusted_device_added: "Trusted device added",
    trusted_device_removed: "Trusted device removed",
    two_factor_disabled: "2FA disabled",
    two_factor_enabled: "2FA enabled",
    two_factor_phone_enabled: "Phone 2FA enabled",
  }[type] ?? type.replace(/_/g, " ");
}

function requestTypeLabel(type: string) {
  return {
    account_compromised: "Account may be compromised",
    lost_access: "Lost access to email or phone",
    lost_device: "Lost device",
    secure_account: "Secure my account",
  }[type] ?? type.replace(/_/g, " ");
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
  children: string;
  tone?: "danger" | "neutral" | "success" | "warning";
}) {
  return (
    <span
      className={[
        "inline-flex min-h-7 w-fit items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset",
        statusBadgeClass(tone),
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function Section({
  children,
  description,
  id,
  label,
  right,
}: {
  children: React.ReactNode;
  description: string;
  id: string;
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-6" id={id}>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">{label}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">{description}</p>
        </div>
        {right}
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {children}
      </div>
    </section>
  );
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold text-zinc-950">{label}</span>
      {children}
    </label>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
      {children}
    </p>
  );
}

function SessionRow({
  isBusy,
  onLogOutCurrent,
  onRevoke,
  session,
}: {
  isBusy: boolean;
  onLogOutCurrent: () => void;
  onRevoke: (sessionId: string) => void;
  session: AccountLoginSession;
}) {
  const isTrusted = Boolean(session.trustedAt);

  return (
    <li className="border-b border-zinc-100 px-4 py-3 last:border-b-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-zinc-950">
              {session.deviceLabel}
            </p>
            {session.isCurrent ? <StatusBadge tone="success">Current</StatusBadge> : null}
            {isTrusted ? <StatusBadge tone="neutral">Trusted</StatusBadge> : null}
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            {session.locationLabel} - {relativeTime(session.lastSeenAt)}
          </p>
          <p className="text-xs text-zinc-400">
            {session.browserName} - {session.osName} - {session.deviceType}
          </p>
        </div>
        {session.isCurrent ? (
          <button
            className={secondaryButtonClassName}
            disabled={isBusy}
            onClick={onLogOutCurrent}
            type="button"
          >
            {isBusy ? "Logging out..." : "Log out"}
          </button>
        ) : session.id ? (
          <button
            className={secondaryButtonClassName}
            disabled={isBusy}
            onClick={() => onRevoke(session.id as string)}
            type="button"
          >
            {isBusy ? "Logging out..." : "Log out"}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function TrustedDeviceRow({
  device,
  isBusy,
  onRemove,
}: {
  device: AccountTrustedDevice;
  isBusy: boolean;
  onRemove: (deviceId: string) => void;
}) {
  return (
    <li className="border-b border-zinc-100 px-4 py-3 last:border-b-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-zinc-950">
              {device.deviceLabel}
            </p>
            {device.isCurrent ? <StatusBadge tone="success">Current</StatusBadge> : null}
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            {device.locationLabel} - trusted {formatDateTime(device.trustedAt)}
          </p>
        </div>
        <button
          className={secondaryButtonClassName}
          disabled={isBusy}
          onClick={() => onRemove(device.id)}
          type="button"
        >
          {isBusy ? "Removing..." : "Remove"}
        </button>
      </div>
    </li>
  );
}

function ActivityList({ activity }: { activity: AccountLoginActivity[] }) {
  if (activity.length === 0) {
    return <EmptyState>No login activity has been recorded yet.</EmptyState>;
  }

  return (
    <ul className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {activity.map((item) => (
        <li
          className="border-b border-zinc-100 px-3 py-2 last:border-b-0"
          key={item.id}
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold capitalize text-zinc-950">
              {activityLabel(item.activityType)}
            </p>
            <p className="text-xs font-semibold text-zinc-500">
              {formatDateTime(item.createdAt)}
            </p>
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            {item.deviceLabel} - {item.locationLabel}
          </p>
        </li>
      ))}
    </ul>
  );
}

function RecoveryRequestList({
  requests,
}: {
  requests: AccountRecoveryRequest[];
}) {
  if (requests.length === 0) {
    return <EmptyState>No recovery requests are open for this account.</EmptyState>;
  }

  return (
    <ul className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      {requests.map((request) => (
        <li
          className="border-b border-zinc-100 px-3 py-2 last:border-b-0"
          key={request.id}
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-zinc-950">
              {requestTypeLabel(request.requestType)}
            </p>
            <StatusBadge
              tone={request.status === "open" ? "warning" : "neutral"}
            >
              {request.status}
            </StatusBadge>
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            {formatDateTime(request.createdAt)}
            {request.contactEmail ? ` - ${request.contactEmail}` : ""}
            {request.contactPhone ? ` - ${request.contactPhone}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

function MfaFactorRow({
  factor,
  isBusy,
  onDisable,
}: {
  factor: AccountMfaFactor;
  isBusy: boolean;
  onDisable: (factor: AccountMfaFactor) => void;
}) {
  const factorLabel =
    factor.factorType === "phone" ? "Phone SMS" : "Authenticator app";
  const detail = [
    factor.status,
    factor.phone,
    `added ${formatDateTime(factor.createdAt)}`,
  ]
    .filter(Boolean)
    .join(" - ");

  return (
    <li className="border-b border-zinc-100 px-4 py-3 last:border-b-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-950">
            {factor.friendlyName ?? factorLabel}
          </p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            {detail}
          </p>
        </div>
        <button
          className={secondaryButtonClassName}
          disabled={isBusy}
          onClick={() => onDisable(factor)}
          type="button"
        >
          {isBusy ? "Disabling..." : "Disable"}
        </button>
      </div>
    </li>
  );
}

export function LoginSecurityPanel({ overview }: LoginSecurityPanelProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingKey, setPendingKey] = useState<PendingKey | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollment | null>(
    null,
  );
  const [phoneMfaEnrollment, setPhoneMfaEnrollment] =
    useState<PhoneMfaEnrollment | null>(null);
  const hasVerifiedTotp = overview.mfa.factors.some(
    (factor) => factor.factorType === "totp" && factor.status === "verified",
  );
  const hasVerifiedPhoneMfa = overview.mfa.factors.some(
    (factor) => factor.factorType === "phone" && factor.status === "verified",
  );
  const hasVerifiedMfa = overview.mfa.factors.some(
    (factor) => factor.status === "verified",
  );
  const currentSession = overview.sessions.find((session) => session.isCurrent);
  const currentDeviceTrusted = Boolean(
    currentSession?.trustedAt ||
      overview.trustedDevices.some((device) => device.isCurrent),
  );
  const isBusy = pendingKey !== null;

  async function runAction(
    key: PendingKey,
    action: () => Promise<LoginSecurityActionResult>,
    options: { refresh?: boolean } = { refresh: true },
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
        return;
      }

      setMessage(result.message ?? "Saved.");

      if (options.refresh !== false) {
        router.refresh();
      }
    } catch {
      setError("This action could not be completed. Check your connection and try again.");
    } finally {
      setPendingKey(null);
    }
  }

  function submitPreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void runAction("preferences", () =>
      updateLoginSecurityPreferencesAction(formData),
    );
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
    });
  }

  function submitSecureAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void runAction("secure-account", () => secureMyAccountAction(formData));
  }

  function beginTotpEnrollment() {
    setError("");
    setMessage("");
    setPhoneMfaEnrollment(null);
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
        setPhoneMfaEnrollment(null);
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
    setError("");
    setMessage("");
    setRecoveryCodes([]);
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

  return (
    <div className="grid gap-5">
      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
          role="status"
        >
          {message}
        </p>
      ) : null}

      <LoginSecurityQuickEditor
        detailHref="/settings/login-security"
        overview={overview}
        variant="page"
      />

      <Section
        description="Devices and browsers with an active Reylumi app session."
        id="sessions"
        label="Where you're logged in"
        right={<StatusBadge tone="neutral">{`${overview.sessions.length} session${overview.sessions.length === 1 ? "" : "s"}`}</StatusBadge>}
      >
        <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-3">
          <button
            className={dangerButtonClassName}
            disabled={isBusy}
            onClick={() =>
              void runAction("session-all", () => logOutAllSessionsAction())
            }
            type="button"
          >
            {pendingKey === "session-all" ? "Logging out..." : "Log out all devices"}
          </button>
        </div>
        {overview.sessions.length > 0 ? (
          <ul>
            {overview.sessions.map((session) => (
              <SessionRow
                isBusy={
                  pendingKey === "session-revoke" ||
                  pendingKey === "session-current"
                }
                key={session.id ?? "current-session"}
                onLogOutCurrent={() =>
                  void runAction("session-current", () =>
                    logOutCurrentSessionAction(),
                  )
                }
                onRevoke={(sessionId) =>
                  void runAction("session-revoke", () =>
                    revokeLoginSessionAction({ session_id: sessionId }),
                  )
                }
                session={session}
              />
            ))}
          </ul>
        ) : (
          <div className="px-4 py-4">
            <EmptyState>No active sessions were found.</EmptyState>
          </div>
        )}
      </Section>

      <Section
        description="Remembered devices reduce extra checks. Remove trust when a device is shared, sold, or lost."
        id="trusted-devices"
        label="Trusted devices"
        right={
          currentDeviceTrusted ? (
            <StatusBadge tone="success">Current trusted</StatusBadge>
          ) : (
            <StatusBadge tone="warning">Current not trusted</StatusBadge>
          )
        }
      >
        <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-3">
          <button
            className={secondaryButtonClassName}
            disabled={isBusy || currentDeviceTrusted}
            onClick={() =>
              void runAction("trust-current", () => trustCurrentDeviceAction())
            }
            type="button"
          >
            {pendingKey === "trust-current" ? "Saving..." : "Remember this device"}
          </button>
        </div>
        {overview.trustedDevices.length > 0 ? (
          <ul>
            {overview.trustedDevices.map((device) => (
              <TrustedDeviceRow
                device={device}
                isBusy={pendingKey === "trusted-remove"}
                key={device.id}
                onRemove={(deviceId) =>
                  void runAction("trusted-remove", () =>
                    removeTrustedDeviceAction({ trusted_device_id: deviceId }),
                  )
                }
              />
            ))}
          </ul>
        ) : (
          <div className="px-4 py-4">
            <EmptyState>No trusted devices have been saved.</EmptyState>
          </div>
        )}
      </Section>

      <Section
        description="Use an authenticator app or SMS code for an extra check when signing in."
        id="two-factor"
        label="Two-factor authentication"
        right={
          hasVerifiedMfa ? (
            <StatusBadge tone="success">Enabled</StatusBadge>
          ) : (
            <StatusBadge tone="warning">Not enabled</StatusBadge>
          )
        }
      >
        {overview.mfa.unavailableReason ? (
          <p className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            {overview.mfa.unavailableReason}
          </p>
        ) : null}
        {overview.mfa.factors.length > 0 ? (
          <ul>
            {overview.mfa.factors.map((factor) => (
              <MfaFactorRow
                factor={factor}
                isBusy={pendingKey === "mfa-disable"}
                key={factor.id}
                onDisable={(mfaFactor) =>
                  void runAction("mfa-disable", () =>
                    disableMfaFactorAction({
                      factor_id: mfaFactor.id,
                      factor_type: mfaFactor.factorType,
                    }),
                  )
                }
              />
            ))}
          </ul>
        ) : (
          <div className="px-4 py-4">
            <EmptyState>No two-factor method is connected.</EmptyState>
          </div>
        )}
        {!hasVerifiedTotp || !hasVerifiedPhoneMfa ? (
          <div className="grid gap-4 border-t border-zinc-100 px-4 py-4 lg:grid-cols-2">
            {!hasVerifiedTotp ? (
              <div className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-950">
                    Authenticator app
                  </p>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">
                    Scan a QR code and enter a rotating code.
                  </p>
                </div>
                <button
                  className={primaryButtonClassName}
                  disabled={isBusy}
                  onClick={beginTotpEnrollment}
                  type="button"
                >
                  {pendingKey === "mfa-begin"
                    ? "Starting..."
                    : "Set up authenticator"}
                </button>
              </div>
            ) : null}
            {!hasVerifiedPhoneMfa ? (
              <div className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-950">
                    Phone SMS
                  </p>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">
                    Send a one-time code to the phone in your profile.
                  </p>
                </div>
                {overview.account.phone ? (
                  <p className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-950">
                    {maskPhone(overview.account.phone)}
                  </p>
                ) : (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                    Verify a phone number in Profile before using SMS 2FA.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    className={primaryButtonClassName}
                    disabled={isBusy || !overview.account.phone}
                    onClick={beginPhoneMfaEnrollment}
                    type="button"
                  >
                    {pendingKey === "mfa-phone-begin"
                      ? "Sending..."
                      : "Send SMS code"}
                  </button>
                  {!overview.account.phone ? (
                    <a
                      className={secondaryButtonClassName}
                      href="/account#profile-contact"
                    >
                      Open Profile
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}
            {totpEnrollment ? (
              <form
                className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 lg:col-span-2"
                onSubmit={submitTotpVerification}
              >
                <input
                  name="factor_id"
                  type="hidden"
                  value={totpEnrollment.factorId}
                />
                <div className="grid gap-3 md:grid-cols-[auto_minmax(0,1fr)]">
                  {totpEnrollment.qrCode ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt="Authenticator QR code"
                      className="h-36 w-36 rounded-md border border-zinc-200 bg-white p-2"
                      src={totpEnrollment.qrCode}
                    />
                  ) : null}
                  <div className="grid gap-3">
                    {totpEnrollment.secret ? (
                      <div>
                        <p className="text-xs font-semibold uppercase text-zinc-500">
                          Setup key
                        </p>
                        <p className="mt-1 break-all rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-sm text-zinc-950">
                          {totpEnrollment.secret}
                        </p>
                      </div>
                    ) : null}
                    <Field label="Authenticator code">
                      <input
                        autoComplete="one-time-code"
                        className={inputClassName}
                        inputMode="numeric"
                        maxLength={8}
                        name="code"
                        required
                      />
                    </Field>
                  </div>
                </div>
                <div>
                  <button
                    className={primaryButtonClassName}
                    disabled={isBusy}
                    type="submit"
                  >
                    {pendingKey === "mfa-verify" ? "Verifying..." : "Verify and enable"}
                  </button>
                </div>
              </form>
            ) : null}
            {phoneMfaEnrollment ? (
              <form
                className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 lg:col-span-2"
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
                <input
                  name="phone"
                  type="hidden"
                  value={phoneMfaEnrollment.phone}
                />
                <p className="text-sm font-semibold text-zinc-950">
                  Code sent to {phoneMfaEnrollment.phone}
                </p>
                <Field label="SMS code">
                  <input
                    autoComplete="one-time-code"
                    className={inputClassName}
                    inputMode="numeric"
                    maxLength={8}
                    name="code"
                    required
                  />
                </Field>
                <div>
                  <button
                    className={primaryButtonClassName}
                    disabled={isBusy}
                    type="submit"
                  >
                    {pendingKey === "mfa-phone-verify"
                      ? "Verifying..."
                      : "Verify phone 2FA"}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
      </Section>

      <Section
        description="Recovery contacts and login alerts used when access looks risky."
        id="recovery-contact"
        label="Login alerts & recovery contacts"
        right={
          overview.preferences.loginAlertsEnabled ? (
            <StatusBadge tone="success">Alerts on</StatusBadge>
          ) : (
            <StatusBadge tone="warning">Alerts off</StatusBadge>
          )
        }
      >
        <form className="grid gap-4 px-4 py-4" onSubmit={submitPreferences}>
          <label className="flex items-start gap-3 text-sm text-zinc-700">
            <input
              className="mt-1 size-4 rounded border-zinc-300"
              defaultChecked={overview.preferences.loginAlertsEnabled}
              name="login_alerts_enabled"
              type="checkbox"
            />
            <span>
              Send an in-app alert when a new login is recorded for this account.
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-zinc-700">
            <input
              className="mt-1 size-4 rounded border-zinc-300 disabled:opacity-60"
              defaultChecked={overview.preferences.smsLoginAlertsEnabled}
              disabled={!overview.account.phone}
              name="sms_login_alerts_enabled"
              type="checkbox"
            />
            <span>
              Send an SMS login alert to the phone in Profile
              {overview.account.phone
                ? ` (${maskPhone(overview.account.phone)}).`
                : " after a phone is verified."}
            </span>
          </label>
          {!overview.smsLoginAlerts.configured && overview.account.phone ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
              Text-message login alerts are turned on, but messages cannot be sent right now. Please try again later.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Recovery email">
              <input
                autoComplete="email"
                className={inputClassName}
                defaultValue={overview.preferences.recoveryEmail ?? ""}
                name="recovery_email"
                type="email"
              />
            </Field>
            <Field label="Recovery phone">
              <input
                autoComplete="tel"
                className={inputClassName}
                defaultValue={overview.preferences.recoveryPhone ?? ""}
                name="recovery_phone"
                type="tel"
              />
            </Field>
          </div>
          <div>
            <button
              className={primaryButtonClassName}
              disabled={isBusy}
              type="submit"
            >
              {pendingKey === "preferences" ? "Saving..." : "Save recovery settings"}
            </button>
          </div>
        </form>
      </Section>

      <Section
        description="One-time backup codes for account recovery. New codes replace unused old codes."
        id="recovery-codes"
        label="Recovery codes"
        right={
          overview.recoveryCodes.unused > 0 ? (
            <StatusBadge tone="success">{`${overview.recoveryCodes.unused} unused`}</StatusBadge>
          ) : (
            <StatusBadge tone="warning">None</StatusBadge>
          )
        }
      >
        <div className="grid gap-4 px-4 py-4">
          <div className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-3">
            <p>Total: {overview.recoveryCodes.total}</p>
            <p>Used: {overview.recoveryCodes.used}</p>
            <p>Last generated: {formatDateTime(overview.recoveryCodes.lastGeneratedAt)}</p>
          </div>
          <div>
            <button
              className={secondaryButtonClassName}
              disabled={isBusy}
              onClick={generateRecoveryCodes}
              type="button"
            >
              {pendingKey === "recovery-codes" ? "Generating..." : "Generate new codes"}
            </button>
          </div>
          {recoveryCodes.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-950">
                Save these codes now. They will not be shown again.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {recoveryCodes.map((code) => (
                  <code
                    className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-950"
                    key={code}
                  >
                    {code}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Section>

      <Section
        description="Create a recovery case for lost access, a lost device, or a suspected account takeover."
        id="account-recovery"
        label="Account recovery"
        right={<StatusBadge tone="neutral">{`${overview.recoveryRequests.length} recent`}</StatusBadge>}
      >
        <div className="grid gap-4 px-4 py-4">
          <form className="grid gap-3" onSubmit={submitRecoveryRequest}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Recovery issue">
                <select
                  className={inputClassName}
                  name="request_type"
                  defaultValue="lost_access"
                >
                  <option value="lost_access">Lost email or phone</option>
                  <option value="lost_device">Lost device</option>
                  <option value="account_compromised">Account taken over</option>
                </select>
              </Field>
              <Field label="Contact email">
                <input
                  autoComplete="email"
                  className={inputClassName}
                  defaultValue={overview.preferences.recoveryEmail ?? ""}
                  name="contact_email"
                  type="email"
                />
              </Field>
              <Field label="Contact phone">
                <input
                  autoComplete="tel"
                  className={inputClassName}
                  defaultValue={overview.preferences.recoveryPhone ?? ""}
                  name="contact_phone"
                  type="tel"
                />
              </Field>
            </div>
            <Field label="Details">
              <textarea
                className={textareaClassName}
                name="details"
                placeholder="What happened?"
              />
            </Field>
            <div>
              <button
                className={primaryButtonClassName}
                disabled={isBusy}
                type="submit"
              >
                {pendingKey === "recovery-request" ? "Creating..." : "Create recovery request"}
              </button>
            </div>
          </form>
          <RecoveryRequestList requests={overview.recoveryRequests} />
        </div>
      </Section>

      <Section
        description="Use this when you think someone else has access. Other sessions are signed out and trusted devices are removed."
        id="secure-account"
        label="Secure my account"
        right={<StatusBadge tone="danger">High impact</StatusBadge>}
      >
        <form
          className="grid gap-4 bg-red-50/70 px-4 py-4"
          onSubmit={submitSecureAccount}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Safe contact email">
              <input
                autoComplete="email"
                className={inputClassName}
                defaultValue={overview.preferences.recoveryEmail ?? ""}
                name="contact_email"
                type="email"
              />
            </Field>
            <Field label="Safe contact phone">
              <input
                autoComplete="tel"
                className={inputClassName}
                defaultValue={overview.preferences.recoveryPhone ?? ""}
                name="contact_phone"
                type="tel"
              />
            </Field>
          </div>
          <Field label="What looks wrong?">
            <textarea
              className={textareaClassName}
              name="details"
              placeholder="Unknown login, lost phone, password shared..."
            />
          </Field>
          <div>
            <button
              className={dangerButtonClassName}
              disabled={isBusy}
              type="submit"
            >
              {pendingKey === "secure-account" ? "Securing..." : "Secure my account"}
            </button>
          </div>
        </form>
      </Section>

      <Section
        description="Recent login and security activity for this account."
        id="activity"
        label="Recent login activity"
        right={<StatusBadge tone="neutral">{`${overview.activity.length} events`}</StatusBadge>}
      >
        <div className="px-4 py-4">
          <ActivityList activity={overview.activity} />
        </div>
      </Section>
    </div>
  );
}
