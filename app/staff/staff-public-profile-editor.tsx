"use client";

import {
  getStaffProfileAvatarUploadSessionAction,
  updateStaffPublicProfileAction,
} from "@/app/staff/actions";
import {
  SALON_PROFILE_ALLOWED_IMAGE_TYPES,
  SALON_PROFILE_IMAGE_LIMITS,
} from "@/lib/salon-profile-media";
import { useEffect, useRef, useState, type FormEvent } from "react";

type StaffPublicProfileEditorProps = {
  avatarUrl: string | null;
  bio: string | null;
  canChangeConsent?: boolean;
  displayName: string;
  jobTitle: string | null;
  ownerPublicEnabled?: boolean;
  onlineBookingEnabled?: boolean;
  publicProfileVisible?: boolean;
  salonName?: string | null;
  specialties: string[];
  staffPublicConsentStatus?: "granted" | "not_requested" | "opted_out";
  staffId: string;
};

const acceptedMimeTypes = new Set<string>(SALON_PROFILE_ALLOWED_IMAGE_TYPES);

function encodeStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
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

  return new File([blob], `staff-avatar-${crypto.randomUUID()}.webp`, {
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

export function StaffPublicProfileEditor({
  avatarUrl,
  bio,
  canChangeConsent = true,
  displayName,
  jobTitle,
  onlineBookingEnabled = false,
  ownerPublicEnabled = true,
  publicProfileVisible,
  salonName,
  specialties,
  staffPublicConsentStatus,
  staffId,
}: StaffPublicProfileEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [avatarPath, setAvatarPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewUrl, setPreviewUrl] = useState(avatarUrl);
  const [progress, setProgress] = useState(0);
  const hasConsent =
    staffPublicConsentStatus !== undefined
      ? staffPublicConsentStatus === "granted"
      : publicProfileVisible === true;
  const effectivePublic = ownerPublicEnabled && hasConsent;

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

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

    if (file.size > SALON_PROFILE_IMAGE_LIMITS.staffAvatar) {
      setError("Staff photo is too large.");
      return;
    }

    setBusy(true);
    setProgress(0);

    try {
      const processed = await processAvatar(file);
      const session = await getStaffProfileAvatarUploadSessionAction(staffId);

      await uploadToSupabase({
        accessToken: session.accessToken,
        anonKey: session.anonKey,
        blob: processed,
        bucket: session.bucket,
        onProgress: setProgress,
        path: session.path,
        supabaseUrl: session.supabaseUrl,
      });

      setAvatarPath(session.path);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }

      objectUrlRef.current = URL.createObjectURL(processed);
      setPreviewUrl(objectUrlRef.current);
      setNotice("Photo ready. Save to apply it.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setBusy(false);

      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    const form = new FormData(event.currentTarget);

    if (avatarPath) {
      form.set("public_profile_photo_path", avatarPath);
    }

    const result = await updateStaffPublicProfileAction(form);

    if (result.error) {
      setError(result.error);
    } else {
      setNotice("Public staff profile saved.");
    }

    setBusy(false);
  }

  return (
    <form className="grid gap-4" onSubmit={save}>
      <input name="staff_id" type="hidden" value={staffId} />
      <input name="public_profile_photo_path" type="hidden" value={avatarPath} />
      <div className="flex items-center gap-4">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`${displayName} public profile`}
            className="h-16 w-16 rounded-full border border-zinc-200 object-cover"
            src={previewUrl}
          />
        ) : (
          <div className="grid h-16 w-16 place-items-center rounded-full bg-zinc-950 text-sm font-semibold text-white">
            {displayName
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase())
              .join("")}
          </div>
        )}
        <div className="grid gap-2">
          <input
            accept={SALON_PROFILE_ALLOWED_IMAGE_TYPES.join(",")}
            className="sr-only"
            onChange={(event) => void uploadAvatar(event.currentTarget.files?.[0] ?? null)}
            ref={inputRef}
            type="file"
          />
          <button
            className="w-fit rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            {busy && progress > 0 ? `Uploading ${progress}%` : "Change photo"}
          </button>
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              className="size-4 rounded border-zinc-300"
              defaultChecked={hasConsent}
              disabled={!canChangeConsent}
              name="appear_publicly"
              type="checkbox"
            />
            Appear publicly on this salon profile
          </label>
          {!canChangeConsent ? (
            <p className="max-w-sm text-xs leading-5 text-zinc-500">
              Staff controls this opt-in from their own workspace.
            </p>
          ) : null}
          <p className="max-w-sm text-xs leading-5 text-zinc-500">
            {salonName ? `${salonName}: ` : ""}
            {effectivePublic
              ? "Your profile can appear publicly."
              : hasConsent
                ? "The salon has not enabled your public listing."
                : "You have opted out of the public team."}
            {onlineBookingEnabled && effectivePublic
              ? " Online booking can show you as an artist."
              : ""}
          </p>
        </div>
      </div>
      <label className="grid gap-2">
        <span className="text-sm font-medium text-zinc-700">Public name</span>
        <input
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          defaultValue={displayName}
          name="display_name"
          required
        />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium text-zinc-700">Title</span>
        <input
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          defaultValue={jobTitle ?? ""}
          name="job_title"
        />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium text-zinc-700">Short bio</span>
        <textarea
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm leading-6"
          defaultValue={bio ?? ""}
          name="public_bio"
          rows={3}
        />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium text-zinc-700">Specialties</span>
        <input
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          defaultValue={specialties.join(", ")}
          name="specialties"
          placeholder="Chrome, Gel-X, Nail art"
        />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
      <button
        className="w-fit rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        disabled={busy}
        type="submit"
      >
        Save public profile
      </button>
    </form>
  );
}
