"use client";

import {
  getAccountAvatarUploadSessionAction,
  sendAccountPhoneVerificationOtpAction,
  updateAccountProfileAction,
  verifyAccountPhoneOtpAction,
  type AccountProfileActionResult,
} from "@/app/account/actions";
import {
  ACCOUNT_AVATAR_ALLOWED_IMAGE_TYPES,
  ACCOUNT_AVATAR_IMAGE_LIMIT,
  encodeStoragePath,
  safeAccountAvatarUrl,
} from "@/lib/account-avatar";
import type { KingUser } from "@/types/user";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

type EditableFieldName =
  | "display_name"
  | "first_name"
  | "last_name"
  | "language"
  | "phone"
  | "timezone";

type ProfileValues = Record<EditableFieldName, string>;
type PhoneClaimState = NonNullable<AccountProfileActionResult["phoneClaim"]>;

type AccountProfileEditorProps = {
  createdAtLabel: string;
  user: KingUser;
};

type VerificationPhoneClaimState = Extract<
  PhoneClaimState,
  { status: "verification_required" }
>;

type ProfileFieldProps = {
  label: string;
  value: string | null | undefined;
};

type EditableFieldProps = {
  autoComplete?: string;
  label: string;
  name: EditableFieldName;
  onChange: (name: EditableFieldName, value: string) => void;
  value: string;
};

type PhoneVerificationDialogProps = {
  busy: boolean;
  claim: VerificationPhoneClaimState;
  code: string;
  error: string;
  notice: string;
  onClose: () => void;
  onCodeChange: (value: string) => void;
  onSend: () => void;
  onVerify: () => void;
  resendWaitSeconds: number;
  sending: boolean;
  sent: boolean;
  successMessage: string;
  verifying: boolean;
};

const acceptedMimeTypes = new Set<string>(ACCOUNT_AVATAR_ALLOWED_IMAGE_TYPES);

function valuesFromUser(user: KingUser): ProfileValues {
  return {
    display_name: user.display_name ?? "",
    first_name: user.first_name ?? "",
    language: user.language ?? "en",
    last_name: user.last_name ?? "",
    phone: user.phone ?? "",
    timezone: user.timezone ?? "America/Chicago",
  };
}

function initialsFor(label: string | null | undefined) {
  const parts = (label ?? "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "K";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function displayName(input: {
  email: string | null;
  firstName: string;
  lastName: string;
  name: string;
}) {
  const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();

  return input.name.trim() || fullName || input.email || "Reylumi account";
}

function displayValue(value: string | null | undefined) {
  return value?.trim() || "-";
}

function maskPhoneForOtp(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const last4 = digits.slice(-4) || "this number";

  return `••• ••• ${last4}`;
}

function readImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be read."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Image could not be processed."));
          return;
        }

        resolve(blob);
      },
      "image/webp",
      quality,
    );
  });
}

async function processAvatar(file: File) {
  const image = await readImage(file);
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = Math.max(0, (image.naturalWidth - side) / 2);
  const sy = Math.max(0, (image.naturalHeight - side) / 2);
  const outputSize = Math.min(1024, side);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Image processor is not available.");
  }

  canvas.width = outputSize;
  canvas.height = outputSize;
  context.drawImage(image, sx, sy, side, side, 0, 0, outputSize, outputSize);

  let quality = 0.9;
  let blob = await canvasToBlob(canvas, quality);

  while (blob.size > 500 * 1024 && quality > 0.72) {
    quality -= 0.06;
    blob = await canvasToBlob(canvas, quality);
  }

  return new File([blob], `account-avatar-${crypto.randomUUID()}.webp`, {
    type: "image/webp",
  });
}

function uploadToSupabase(input: {
  accessToken: string;
  anonKey: string;
  blob: File;
  bucket: string;
  onProgress: (value: number) => void;
  path: string;
  supabaseUrl: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const objectUrl = `${input.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${encodeURIComponent(
      input.bucket,
    )}/${encodeStoragePath(input.path)}`;

    xhr.open("POST", objectUrl);
    xhr.setRequestHeader("Authorization", `Bearer ${input.accessToken}`);
    xhr.setRequestHeader("apikey", input.anonKey);
    xhr.setRequestHeader("Content-Type", input.blob.type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        input.onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress(100);
        resolve();
        return;
      }

      reject(new Error(xhr.responseText || "Upload failed."));
    };
    xhr.onerror = () => reject(new Error("Upload failed."));
    xhr.send(input.blob);
  });
}

function ProfileField({ label, value }: ProfileFieldProps) {
  return (
    <div className="grid gap-1 border-b border-zinc-100 px-4 py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center">
      <dt className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </dt>
      <dd className="min-h-6 break-words text-sm font-semibold text-zinc-950">
        {displayValue(value)}
      </dd>
    </div>
  );
}

function EditableField({
  autoComplete,
  label,
  name,
  onChange,
  value,
}: EditableFieldProps) {
  const fieldId = `account-profile-${name}`;

  return (
    <div className="grid gap-2 border-b border-zinc-100 px-4 py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center">
      <label
        className="text-xs font-semibold uppercase text-zinc-500"
        htmlFor={fieldId}
      >
        {label}
      </label>
      <input
        autoComplete={autoComplete}
        className="block min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
        id={fieldId}
        name={name}
        onChange={(event) => onChange(name, event.currentTarget.value)}
        value={value}
      />
    </div>
  );
}

function ReadonlyField({ label, value }: ProfileFieldProps) {
  return (
    <div className="grid gap-2 border-b border-zinc-100 px-4 py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center">
      <span className="text-xs font-semibold uppercase text-zinc-500">
        {label}
      </span>
      <span className="flex min-h-11 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-950">
        {displayValue(value)}
      </span>
    </div>
  );
}

function PhoneVerificationDialog({
  busy,
  claim,
  code,
  error,
  notice,
  onClose,
  onCodeChange,
  onSend,
  onVerify,
  resendWaitSeconds,
  sending,
  sent,
  successMessage,
  verifying,
}: PhoneVerificationDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !successMessage) {
        event.preventDefault();
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, successMessage]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/45 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-6">
      <button
        aria-label="Close phone verification"
        className="absolute inset-0 cursor-default"
        disabled={Boolean(successMessage)}
        onClick={onClose}
        type="button"
      />
      <div
        aria-labelledby="phone-verification-title"
        aria-modal="true"
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-[0_24px_80px_rgba(23,19,22,0.22)] outline-none sm:p-6"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              className="text-xl font-extrabold text-text-primary"
              id="phone-verification-title"
            >
              Verify phone number
            </h2>
            <p className="mt-2 text-sm font-medium leading-6 text-text-secondary">
              Enter the verification code sent to{" "}
              <span className="font-bold text-text-primary">
                {maskPhoneForOtp(claim.normalizedPhone)}
              </span>
              .
            </p>
          </div>
          <button
            className="min-h-10 rounded-full px-3 text-sm font-bold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:pointer-events-none disabled:opacity-0"
            disabled={Boolean(successMessage)}
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>

        {successMessage ? (
          <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-semibold text-emerald-800">
            {successMessage}
          </div>
        ) : (
          <div className="mt-5 grid gap-4">
            {!sent ? (
              <button
                className="min-h-12 rounded-full bg-brand-orange px-5 text-sm font-extrabold text-white shadow-[0_14px_30px_rgba(255,107,53,0.2)] transition hover:bg-brand-orange/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60"
                disabled={!claim.canSendOtp || busy}
                onClick={onSend}
                type="button"
              >
                {sending ? "Sending..." : "Send code"}
              </button>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <label
                    className="text-xs font-bold uppercase tracking-[0.12em] text-text-secondary"
                    htmlFor="phone-verification-code"
                  >
                    Verification code
                  </label>
                  <input
                    autoComplete="one-time-code"
                    className="min-h-14 rounded-2xl border border-border-subtle bg-surface-muted px-4 text-center text-2xl font-extrabold tracking-[0.28em] text-text-primary outline-none transition focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                    id="phone-verification-code"
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => onCodeChange(event.currentTarget.value)}
                    placeholder="000000"
                    value={code}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <button
                    className="min-h-12 rounded-full bg-brand-orange px-5 text-sm font-extrabold text-white shadow-[0_14px_30px_rgba(255,107,53,0.2)] transition hover:bg-brand-orange/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busy || code.length !== 6}
                    onClick={onVerify}
                    type="button"
                  >
                    {verifying ? "Verifying..." : "Verify"}
                  </button>
                  <button
                    className="min-h-12 rounded-full border border-border-subtle px-4 text-sm font-bold text-text-primary transition hover:border-brand-orange/40 hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busy || resendWaitSeconds > 0}
                    onClick={onSend}
                    type="button"
                  >
                    {resendWaitSeconds > 0
                      ? `Resend in ${resendWaitSeconds}s`
                      : "Resend code"}
                  </button>
                </div>
              </>
            )}

            {!claim.canSendOtp ? (
              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                {claim.reason}
              </p>
            ) : null}
            {notice ? (
              <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export function AccountProfileEditor({
  createdAtLabel,
  user,
}: AccountProfileEditorProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState(
    safeAccountAvatarUrl(user.avatar_url),
  );
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phoneClaim, setPhoneClaim] = useState<PhoneClaimState | null>(null);
  const [phoneOtpCode, setPhoneOtpCode] = useState("");
  const [phoneOtpError, setPhoneOtpError] = useState("");
  const [phoneOtpNotice, setPhoneOtpNotice] = useState("");
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);
  const [phoneOtpSuccessMessage, setPhoneOtpSuccessMessage] = useState("");
  const [phoneVerificationOpen, setPhoneVerificationOpen] = useState(false);
  const [resendWaitSeconds, setResendWaitSeconds] = useState(0);
  const [progress, setProgress] = useState(0);
  const [savedAvatarUrl, setSavedAvatarUrl] = useState(user.avatar_url);
  const [snapshotAvatarUrl, setSnapshotAvatarUrl] = useState(user.avatar_url);
  const [snapshotValues, setSnapshotValues] = useState<ProfileValues>(
    valuesFromUser(user),
  );
  const [uploading, setUploading] = useState(false);
  const [values, setValues] = useState<ProfileValues>(valuesFromUser(user));
  const [saving, startSaving] = useTransition();
  const [phoneOtpSending, startPhoneOtpSend] = useTransition();
  const [phoneOtpVerifying, startPhoneOtpVerify] = useTransition();
  const currentName = displayName({
    email: user.email,
    firstName: values.first_name,
    lastName: values.last_name,
    name: values.display_name,
  });
  const busy = uploading || saving || phoneOtpSending || phoneOtpVerifying;
  const avatarChanged = avatarUrl !== savedAvatarUrl;
  const phoneVerificationClaim =
    phoneVerificationOpen && phoneClaim?.status === "verification_required"
      ? phoneClaim
      : null;
  const otpSuccessTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      if (otpSuccessTimerRef.current) {
        window.clearTimeout(otpSuccessTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (resendWaitSeconds <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setResendWaitSeconds((currentSeconds) => Math.max(currentSeconds - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [resendWaitSeconds]);

  function updateValue(name: EditableFieldName, value: string) {
    setValues((currentValues) => ({
      ...currentValues,
      [name]: value,
    }));
  }

  function beginEdit() {
    setError("");
    setNotice("");
    setPhoneClaim(null);
    setPhoneVerificationOpen(false);
    resetPhoneOtpState();
    setSnapshotAvatarUrl(avatarUrl);
    setSnapshotValues(values);
    setEditing(true);
  }

  function cancelEdit() {
    setError("");
    setNotice("");
    setPhoneClaim(null);
    setPhoneVerificationOpen(false);
    resetPhoneOtpState();
    setAvatarUrl(snapshotAvatarUrl);
    setAvatarPreviewUrl(safeAccountAvatarUrl(snapshotAvatarUrl));
    setValues(snapshotValues);
    setEditing(false);
  }

  function removeAvatar() {
    setAvatarUrl(null);
    setAvatarPreviewUrl(null);
  }

  function profilePayload(phoneOverride?: string) {
    const payload: Record<string, unknown> = {
      display_name: values.display_name,
      first_name: values.first_name,
      language: values.language,
      last_name: values.last_name,
      phone: phoneOverride ?? values.phone,
      timezone: values.timezone,
    };

    if (avatarChanged) {
      payload.avatar_url = avatarUrl ?? "";
    }

    return payload;
  }

  function clearOtpSuccessTimer() {
    if (otpSuccessTimerRef.current) {
      window.clearTimeout(otpSuccessTimerRef.current);
      otpSuccessTimerRef.current = null;
    }
  }

  function resetPhoneOtpState() {
    clearOtpSuccessTimer();
    setPhoneOtpCode("");
    setPhoneOtpError("");
    setPhoneOtpNotice("");
    setPhoneOtpSent(false);
    setPhoneOtpSuccessMessage("");
    setResendWaitSeconds(0);
  }

  function closePhoneVerificationDialog() {
    setPhoneVerificationOpen(false);
    resetPhoneOtpState();
  }

  function updatePhoneOtpCode(value: string) {
    setPhoneOtpCode(value.replace(/\D/g, "").slice(0, 6));
  }

  function finishVerifiedPhoneSave(input: {
    linkedCount: number;
    message: string;
    verifiedPhone: string;
  }) {
    const nextValues = {
      ...values,
      phone: input.verifiedPhone,
    };

    setValues(nextValues);
    setSavedAvatarUrl(avatarUrl);
    setSnapshotAvatarUrl(avatarUrl);
    setSnapshotValues(nextValues);
    setEditing(false);
    setPhoneOtpError("");
    setPhoneOtpNotice("");
    setPhoneOtpSuccessMessage(input.message);
    setNotice(input.message);

    clearOtpSuccessTimer();
    otpSuccessTimerRef.current = window.setTimeout(() => {
      setPhoneVerificationOpen(false);
      setPhoneClaim({
        linkedCount: input.linkedCount,
        message: input.message,
        normalizedPhone: input.verifiedPhone,
        status: "connected",
      });
      resetPhoneOtpState();
      router.refresh();
    }, 900);
  }

  function saveProfile() {
    if (uploading) {
      return;
    }

    setError("");
    setNotice("");
    setPhoneClaim(null);
    setPhoneVerificationOpen(false);
    resetPhoneOtpState();

    startSaving(async () => {
      const result = await updateAccountProfileAction(profilePayload());

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.phoneClaim?.status === "verification_required") {
        setPhoneClaim(result.phoneClaim);
        setPhoneVerificationOpen(true);
        return;
      }

      setSavedAvatarUrl(avatarUrl);
      setSnapshotAvatarUrl(avatarUrl);
      setSnapshotValues(values);
      setEditing(false);
      setPhoneClaim(result.phoneClaim ?? null);
      setNotice(result.phoneClaim?.message ?? "Profile saved.");
      router.refresh();
    });
  }

  function sendPhoneOtp() {
    if (phoneClaim?.status !== "verification_required" || resendWaitSeconds > 0) {
      return;
    }

    setPhoneOtpError("");
    setPhoneOtpNotice("");

    startPhoneOtpSend(async () => {
      const result = await sendAccountPhoneVerificationOtpAction({
        phone: phoneClaim.normalizedPhone,
      });

      if (result.error) {
        setPhoneOtpError(result.error);
        return;
      }

      if (result.status === "already_verified") {
        const verifiedPhone = result.normalizedPhone ?? phoneClaim.normalizedPhone;
        const profileResult = await updateAccountProfileAction(
          profilePayload(verifiedPhone),
        );

        if (profileResult.error) {
          setPhoneOtpError(profileResult.error);
          return;
        }

        const linkedCount =
          result.linkedCount ??
          (profileResult.phoneClaim?.status === "connected"
            ? profileResult.phoneClaim.linkedCount
            : 0);
        const message =
          result.message ??
          (profileResult.phoneClaim?.status === "connected"
            ? profileResult.phoneClaim.message
            : "Phone verified.");

        finishVerifiedPhoneSave({
          linkedCount,
          message,
          verifiedPhone,
        });
        return;
      }

      setPhoneOtpSent(true);
      setPhoneOtpNotice(result.message ?? "Verification code sent.");
      setResendWaitSeconds(
        result.resendAfterSeconds ?? phoneClaim.resendCooldownSeconds,
      );
    });
  }

  function verifyPhoneOtp() {
    if (phoneClaim?.status !== "verification_required" || !phoneOtpCode.trim()) {
      return;
    }

    setPhoneOtpError("");
    setPhoneOtpNotice("");

    startPhoneOtpVerify(async () => {
      const result = await verifyAccountPhoneOtpAction({
        code: phoneOtpCode,
        phone: phoneClaim.normalizedPhone,
      });

      if (result.error) {
        setPhoneOtpError(result.error);
        return;
      }

      const verifiedPhone = result.normalizedPhone ?? phoneClaim.normalizedPhone;
      const profileResult = await updateAccountProfileAction(
        profilePayload(verifiedPhone),
      );

      if (profileResult.error) {
        setPhoneOtpError(profileResult.error);
        return;
      }

      const linkedCount =
        result.linkedCount ??
        (profileResult.phoneClaim?.status === "connected"
          ? profileResult.phoneClaim.linkedCount
          : 0);
      const message =
        result.message ??
        (linkedCount > 0
          ? "Phone verified and eligible visit history was connected."
          : "Phone verified.");

      finishVerifiedPhoneSave({
        linkedCount,
        message,
        verifiedPhone,
      });
    });
  }

  async function uploadAvatar(file: File | null) {
    setError("");
    setNotice("");

    if (!file) {
      return;
    }

    if (!acceptedMimeTypes.has(file.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }

    if (file.size > ACCOUNT_AVATAR_IMAGE_LIMIT) {
      setError("Avatar image is too large.");
      return;
    }

    setUploading(true);
    setProgress(0);

    try {
      const processed = await processAvatar(file);
      const session = await getAccountAvatarUploadSessionAction();

      await uploadToSupabase({
        accessToken: session.accessToken,
        anonKey: session.anonKey,
        blob: processed,
        bucket: session.bucket,
        onProgress: setProgress,
        path: session.path,
        supabaseUrl: session.supabaseUrl,
      });

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      objectUrlRef.current = URL.createObjectURL(processed);
      setAvatarPreviewUrl(objectUrlRef.current);
      setAvatarUrl(session.publicUrl);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
    } finally {
      setUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void uploadAvatar(event.currentTarget.files?.[0] ?? null);
  }

  function onEditorKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      saveProfile();
    }
  }

  return (
    <section
      className="scroll-mt-6"
      id="profile-contact"
      onKeyDown={onEditorKeyDown}
    >
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            Profile & contact
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            Name, avatar, email, phone, language, and timezone.
          </p>
        </div>
        {!editing ? (
          <button
            className="min-h-10 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            onClick={beginEdit}
            type="button"
          >
            Edit profile
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-border-subtle bg-white">
        <div className="flex flex-col gap-4 border-b border-zinc-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-border-subtle bg-brand-orange-soft text-lg font-extrabold text-brand-orange">
              {avatarPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={`${currentName} avatar`}
                  className="h-full w-full object-cover"
                  src={avatarPreviewUrl}
                />
              ) : (
                initialsFor(currentName)
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xl font-semibold text-zinc-950">
                {currentName}
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-zinc-500">
                {user.email ?? "Personal account"}
              </p>
            </div>
          </div>

          {editing ? (
            <div className="flex flex-wrap gap-2">
              <input
                accept={ACCOUNT_AVATAR_ALLOWED_IMAGE_TYPES.join(",")}
                className="sr-only"
                onChange={onFileChange}
                ref={fileInputRef}
                type="file"
              />
              <button
                className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                {uploading && progress > 0
                  ? `Uploading ${progress}%`
                  : "Change photo"}
              </button>
              {avatarPreviewUrl ? (
                <button
                  className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60"
                  disabled={busy}
                  onClick={removeAvatar}
                  type="button"
                >
                  Remove photo
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {editing ? (
          <>
            <div>
              <EditableField
                autoComplete="name"
                label="Display name"
                name="display_name"
                onChange={updateValue}
                value={values.display_name}
              />
              <ReadonlyField label="Email" value={user.email} />
              <EditableField
                autoComplete="given-name"
                label="First name"
                name="first_name"
                onChange={updateValue}
                value={values.first_name}
              />
              <EditableField
                autoComplete="family-name"
                label="Last name"
                name="last_name"
                onChange={updateValue}
                value={values.last_name}
              />
              <EditableField
                autoComplete="tel"
                label="Phone"
                name="phone"
                onChange={updateValue}
                value={values.phone}
              />
              <ReadonlyField label="Status" value={user.status} />
              <EditableField
                label="Language"
                name="language"
                onChange={updateValue}
                value={values.language}
              />
              <EditableField
                label="Timezone"
                name="timezone"
                onChange={updateValue}
                value={values.timezone}
              />
              <ReadonlyField label="Created" value={createdAtLabel} />
            </div>
            <div className="sticky bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-10px_30px_rgba(24,24,27,.08)] backdrop-blur">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <button
                  className="min-h-10 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60"
                  disabled={busy}
                  onClick={cancelEdit}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="min-h-10 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
                  disabled={busy}
                  onClick={saveProfile}
                  type="button"
                >
                  {saving ? "Saving..." : "Save profile"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <dl>
            <ProfileField label="Display name" value={currentName} />
            <ProfileField label="Email" value={user.email} />
            <ProfileField label="Phone" value={values.phone} />
            <ProfileField label="First name" value={values.first_name} />
            <ProfileField label="Last name" value={values.last_name} />
            <ProfileField label="Language" value={values.language} />
            <ProfileField label="Timezone" value={values.timezone} />
            <ProfileField label="Status" value={user.status} />
            <ProfileField label="Created" value={createdAtLabel} />
          </dl>
        )}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {notice}
        </p>
      ) : null}

      {phoneVerificationClaim ? (
        <PhoneVerificationDialog
          busy={busy}
          claim={phoneVerificationClaim}
          code={phoneOtpCode}
          error={phoneOtpError}
          notice={phoneOtpNotice}
          onClose={closePhoneVerificationDialog}
          onCodeChange={updatePhoneOtpCode}
          onSend={sendPhoneOtp}
          onVerify={verifyPhoneOtp}
          resendWaitSeconds={resendWaitSeconds}
          sending={phoneOtpSending}
          sent={phoneOtpSent}
          successMessage={phoneOtpSuccessMessage}
          verifying={phoneOtpVerifying}
        />
      ) : null}
    </section>
  );
}
