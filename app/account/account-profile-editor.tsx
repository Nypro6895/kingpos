"use client";

import {
  getAccountAvatarUploadSessionAction,
  updateAccountProfileAction,
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
  type KeyboardEvent,
} from "react";

type EditableFieldName =
  | "display_name"
  | "first_name"
  | "last_name"
  | "language"
  | "phone"
  | "timezone";

type ProfileValues = Record<EditableFieldName, string>;

type AccountProfileEditorProps = {
  createdAtLabel: string;
  user: KingUser;
};

type EditableRowProps = {
  autoComplete?: string;
  editing: boolean;
  label: string;
  name: EditableFieldName;
  onChange: (name: EditableFieldName, value: string) => void;
  value: string;
};

type ReadonlyRowProps = {
  label: string;
  value: string | null;
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

function EditableRow({
  autoComplete,
  editing,
  label,
  name,
  onChange,
  value,
}: EditableRowProps) {
  return (
    <div className="border-b border-zinc-200 py-4 last:border-b-0 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm text-zinc-950 sm:col-span-2 sm:mt-0">
        {editing ? (
          <input
            autoComplete={autoComplete}
            className="block min-h-8 w-full rounded-md border border-transparent bg-zinc-50 px-2 py-1 text-sm text-zinc-950 outline-none transition focus:border-brand-orange focus:bg-white focus:ring-4 focus:ring-brand-orange/10"
            name={name}
            onChange={(event) => onChange(name, event.currentTarget.value)}
            value={value}
          />
        ) : (
          <span className="block break-words py-1">{displayValue(value)}</span>
        )}
      </dd>
    </div>
  );
}

function ReadonlyRow({ label, value }: ReadonlyRowProps) {
  return (
    <div className="border-b border-zinc-200 py-4 last:border-b-0 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-zinc-950 sm:col-span-2 sm:mt-0">
        {displayValue(value)}
      </dd>
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
  const [progress, setProgress] = useState(0);
  const [savedAvatarUrl, setSavedAvatarUrl] = useState(user.avatar_url);
  const [snapshotAvatarUrl, setSnapshotAvatarUrl] = useState(user.avatar_url);
  const [snapshotValues, setSnapshotValues] = useState<ProfileValues>(
    valuesFromUser(user),
  );
  const [uploading, setUploading] = useState(false);
  const [values, setValues] = useState<ProfileValues>(valuesFromUser(user));
  const [saving, startSaving] = useTransition();
  const currentName = displayName({
    email: user.email,
    firstName: values.first_name,
    lastName: values.last_name,
    name: values.display_name,
  });
  const busy = uploading || saving;
  const avatarChanged = avatarUrl !== savedAvatarUrl;

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  function updateValue(name: EditableFieldName, value: string) {
    setValues((currentValues) => ({
      ...currentValues,
      [name]: value,
    }));
  }

  function beginEdit() {
    setError("");
    setNotice("");
    setSnapshotAvatarUrl(avatarUrl);
    setSnapshotValues(values);
    setEditing(true);
  }

  function cancelEdit() {
    setError("");
    setNotice("");
    setAvatarUrl(snapshotAvatarUrl);
    setAvatarPreviewUrl(safeAccountAvatarUrl(snapshotAvatarUrl));
    setValues(snapshotValues);
    setEditing(false);
  }

  function removeAvatar() {
    setAvatarUrl(null);
    setAvatarPreviewUrl(null);
  }

  function saveProfile() {
    if (uploading) {
      return;
    }

    setError("");
    setNotice("");

    const payload: Record<string, unknown> = {
      display_name: values.display_name,
      first_name: values.first_name,
      language: values.language,
      last_name: values.last_name,
      phone: values.phone,
      timezone: values.timezone,
    };

    if (avatarChanged) {
      payload.avatar_url = avatarUrl ?? "";
    }

    startSaving(async () => {
      const result = await updateAccountProfileAction(payload);

      if (result.error) {
        setError(result.error);
        return;
      }

      setSavedAvatarUrl(avatarUrl);
      setSnapshotAvatarUrl(avatarUrl);
      setSnapshotValues(values);
      setEditing(false);
      setNotice("Profile saved.");
      router.refresh();
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

  function onEditorKeyDown(event: KeyboardEvent<HTMLElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      saveProfile();
    }
  }

  return (
    <section className="mt-8" onKeyDown={onEditorKeyDown}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-zinc-950">Profile details</h2>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <button
                className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60"
                disabled={busy}
                onClick={saveProfile}
                type="button"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:border-zinc-400 disabled:cursor-wait disabled:opacity-60"
                disabled={busy}
                onClick={cancelEdit}
                type="button"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:border-zinc-400"
              onClick={beginEdit}
              type="button"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-zinc-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border border-zinc-200 bg-brand-orange-soft text-lg font-bold text-brand-orange">
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
              <p className="truncate text-base font-semibold text-zinc-950">
                {currentName}
              </p>
              <p className="mt-1 truncate text-sm text-zinc-500">
                {user.email ?? "Personal account"}
              </p>
            </div>
          </div>
          {editing ? (
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <input
                accept={ACCOUNT_AVATAR_ALLOWED_IMAGE_TYPES.join(",")}
                className="sr-only"
                onChange={onFileChange}
                ref={fileInputRef}
                type="file"
              />
              <button
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:border-zinc-400 disabled:cursor-wait disabled:opacity-60"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                {uploading && progress > 0 ? `Uploading ${progress}%` : "Change photo"}
              </button>
              {avatarPreviewUrl ? (
                <button
                  className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:border-zinc-400 disabled:cursor-wait disabled:opacity-60"
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

        <dl className="px-5">
          <EditableRow
            autoComplete="name"
            editing={editing}
            label="Display name"
            name="display_name"
            onChange={updateValue}
            value={values.display_name}
          />
          <EditableRow
            autoComplete="given-name"
            editing={editing}
            label="First name"
            name="first_name"
            onChange={updateValue}
            value={values.first_name}
          />
          <EditableRow
            autoComplete="family-name"
            editing={editing}
            label="Last name"
            name="last_name"
            onChange={updateValue}
            value={values.last_name}
          />
          <ReadonlyRow label="Email" value={user.email} />
          <EditableRow
            autoComplete="tel"
            editing={editing}
            label="Phone"
            name="phone"
            onChange={updateValue}
            value={values.phone}
          />
          <ReadonlyRow label="Status" value={user.status} />
          <EditableRow
            editing={editing}
            label="Language"
            name="language"
            onChange={updateValue}
            value={values.language}
          />
          <EditableRow
            editing={editing}
            label="Timezone"
            name="timezone"
            onChange={updateValue}
            value={values.timezone}
          />
          <ReadonlyRow label="Created at" value={createdAtLabel} />
        </dl>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
