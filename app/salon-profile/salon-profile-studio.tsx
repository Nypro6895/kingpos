"use client";

import {
  createSalonProfileLookAction,
  createSalonProfileUpdateAction,
  deleteSalonProfileLookAction,
  deleteSalonProfileMediaAction,
  getSalonProfileMediaUploadSessionAction,
  pinSalonProfileLookAction,
  setSalonProfileLookStatusAction,
  setSalonProfilePublicationAction,
  updateSalonProfileIdentityAction,
} from "@/app/salon-profile/actions";
import { SalonProfileView } from "@/app/salon-profile/salon-profile-view";
import {
  SALON_PROFILE_ALLOWED_IMAGE_TYPES,
  SALON_PROFILE_IMAGE_LIMITS,
  type SalonProfileMediaKind,
} from "@/lib/salon-profile-media";
import {
  SALON_PROFILE_BADGE_OPTIONS,
  SALON_PROFILE_MOOD_OPTIONS,
  SALON_PROFILE_UPDATE_TYPES,
  type PublicSalonProfileData,
  type SalonProfileLook,
  type SalonProfileLookStatus,
  type SalonProfileReadiness,
  type SalonProfileSetting,
  type SalonProfileUpdate,
} from "@/types/salon-profile";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";

type StudioProps = {
  canManageContent: boolean;
  canManageIdentity: boolean;
  error?: string;
  looks: SalonProfileLook[];
  notice?: string;
  previewData: PublicSalonProfileData;
  publicHref: string;
  readiness: SalonProfileReadiness;
  services: Service[];
  setting: SalonProfileSetting;
  staff: Staff[];
  updates: SalonProfileUpdate[];
};

type DrawerId = "look" | "opening" | "profile" | "preview" | "update";
type LibraryTab = "all" | "archived" | "draft" | "published" | "scheduled";
type UploadIntent = "content" | "identity";
type SalonProfileUploadableKind = Extract<
  SalonProfileMediaKind,
  "cover" | "logo" | "look" | "update"
>;
type UploadState = "idle" | "processing" | "ready" | "uploading" | "uploaded";

const acceptedMimeTypes = new Set<string>(SALON_PROFILE_ALLOWED_IMAGE_TYPES);
const statusLabels: Record<SalonProfileReadiness["status"], string> = {
  draft: "Draft",
  incomplete: "Incomplete",
  published: "Published",
  ready: "Ready",
};
const libraryTabs: Array<{ id: LibraryTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "draft", label: "Drafts" },
  { id: "scheduled", label: "Scheduled" },
  { id: "archived", label: "Archived" },
];
const ctaOptions = ["Book now", "Call salon", "View services"];

const mediaConfig: Record<
  SalonProfileMediaKind,
  {
    aspectRatio: number;
    maxHeight: number;
    maxWidth: number;
    targetBytes: number;
  }
> = {
  cover: {
    aspectRatio: 2.4,
    maxHeight: 1000,
    maxWidth: 2400,
    targetBytes: 1.5 * 1024 * 1024,
  },
  logo: {
    aspectRatio: 1,
    maxHeight: 1024,
    maxWidth: 1024,
    targetBytes: 500 * 1024,
  },
  look: {
    aspectRatio: 4 / 5,
    maxHeight: 2000,
    maxWidth: 1600,
    targetBytes: 1.5 * 1024 * 1024,
  },
  review: {
    aspectRatio: 1,
    maxHeight: 1400,
    maxWidth: 1400,
    targetBytes: 900 * 1024,
  },
  staffAvatar: {
    aspectRatio: 1,
    maxHeight: 1024,
    maxWidth: 1024,
    targetBytes: 500 * 1024,
  },
  update: {
    aspectRatio: 1.6,
    maxHeight: 1200,
    maxWidth: 1920,
    targetBytes: 1.5 * 1024 * 1024,
  },
};

function formatBytes(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function formatDuration(minutes: number | null | undefined) {
  if (!minutes) {
    return null;
  }

  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatLocation(setting: SalonProfileSetting) {
  return [setting.city, setting.state].filter(Boolean).join(", ");
}

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

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Image could not be processed."));
          return;
        }

        resolve(blob);
      },
      type,
      quality,
    );
  });
}

async function processImage(
  file: File,
  kind: SalonProfileUploadableKind,
  adjustment: { offsetX: number; offsetY: number; zoom: number },
) {
  const image = await readImage(file);
  const config = mediaConfig[kind];
  const sourceAspect = image.naturalWidth / image.naturalHeight;
  const cropWidth =
    sourceAspect > config.aspectRatio
      ? image.naturalHeight * config.aspectRatio
      : image.naturalWidth;
  const cropHeight =
    sourceAspect > config.aspectRatio
      ? image.naturalHeight
      : image.naturalWidth / config.aspectRatio;
  const zoom = Math.max(1, adjustment.zoom);
  const zoomedWidth = cropWidth / zoom;
  const zoomedHeight = cropHeight / zoom;
  const maxOffsetX = (image.naturalWidth - zoomedWidth) / 2;
  const maxOffsetY = (image.naturalHeight - zoomedHeight) / 2;
  const sx = Math.min(
    image.naturalWidth - zoomedWidth,
    Math.max(0, (image.naturalWidth - zoomedWidth) / 2 + maxOffsetX * adjustment.offsetX),
  );
  const sy = Math.min(
    image.naturalHeight - zoomedHeight,
    Math.max(0, (image.naturalHeight - zoomedHeight) / 2 + maxOffsetY * adjustment.offsetY),
  );
  const outputWidth = Math.min(config.maxWidth, Math.round(zoomedWidth));
  const outputHeight = Math.min(
    config.maxHeight,
    Math.round(outputWidth / config.aspectRatio),
  );
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Image processor is not available.");
  }

  canvas.width = outputWidth;
  canvas.height = outputHeight;
  context.drawImage(
    image,
    sx,
    sy,
    zoomedWidth,
    zoomedHeight,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  let quality = 0.9;
  let blob = await canvasToBlob(canvas, "image/webp", quality);

  while (blob.size > config.targetBytes && quality > 0.72) {
    quality -= 0.06;
    blob = await canvasToBlob(canvas, "image/webp", quality);
  }

  return new File([blob], `${kind}-${crypto.randomUUID()}.webp`, {
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
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(input.blob);
  });
}

function Field({
  defaultValue,
  label,
  name,
  required = false,
  type = "text",
}: {
  defaultValue?: string | number | null;
  label: string;
  name: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
        defaultValue={defaultValue ?? ""}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}

function TextArea({
  defaultValue,
  label,
  name,
  rows = 3,
}: {
  defaultValue?: string | null;
  label: string;
  name: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <textarea
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
        defaultValue={defaultValue ?? ""}
        name={name}
        rows={rows}
      />
    </label>
  );
}

function SelectOptions({
  items,
  label,
}: {
  items: Array<{ id: string; name: string }>;
  label: string;
}) {
  return (
    <>
      <option value="">{label}</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </>
  );
}

function Drawer({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 grid bg-zinc-950/35 p-0 backdrop-blur-sm sm:p-4"
      role="dialog"
    >
      <button
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div className="relative ml-auto flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white shadow-2xl sm:rounded-lg">
        <div className="flex min-h-16 items-center justify-between gap-3 border-b border-zinc-200 px-5">
          <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
          <button
            className="grid h-10 w-10 place-items-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            x
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function SubmitFooter({
  disabled,
  onCancel,
  submitLabel,
}: {
  disabled?: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-6 flex justify-end gap-2 border-t border-zinc-200 bg-white px-5 py-4">
      <button
        className="min-h-10 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50"
        onClick={onCancel}
        type="button"
      >
        Cancel
      </button>
      <button
        className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        disabled={disabled}
        type="submit"
      >
        {submitLabel}
      </button>
    </div>
  );
}

function SalonMediaUploader({
  currentPath,
  currentUrl,
  disabled,
  intent,
  kind,
  label,
  onRemoveExisting,
  onUploadStateChange,
  onUploaded,
}: {
  currentPath: string | null;
  currentUrl: string | null;
  disabled?: boolean;
  intent: UploadIntent;
  kind: SalonProfileUploadableKind;
  label: string;
  onRemoveExisting?: () => void;
  onUploadStateChange?: (isBusy: boolean) => void;
  onUploaded: (path: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [processedFile, setProcessedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState(currentUrl);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<UploadState>("idle");
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [adjustment, setAdjustment] = useState({ offsetX: 0, offsetY: 0, zoom: 1 });
  const busy = state === "processing" || state === "uploading";
  const limit = SALON_PROFILE_IMAGE_LIMITS[kind];

  useEffect(() => {
    onUploadStateChange?.(busy);
  }, [busy, onUploadStateChange]);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  async function acceptFile(nextFile: File | null) {
    setError(null);
    setUploadedPath(null);
    onUploaded(null);

    if (!nextFile) {
      return;
    }

    if (nextFile.size <= 0) {
      setError("Choose a non-empty image.");
      return;
    }

    if (!acceptedMimeTypes.has(nextFile.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }

    if (nextFile.size > limit) {
      setError(`${label} must be ${formatBytes(limit)} or smaller.`);
      return;
    }

    setFile(nextFile);
    setProcessedFile(null);
    setState("processing");

    try {
      const output = await processImage(nextFile, kind, adjustment);
      const objectUrl = URL.createObjectURL(output);

      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }

      setProcessedFile(output);
      setPreviewUrl(objectUrl);
      setState("ready");
    } catch (processError) {
      setState("idle");
      setError(
        processError instanceof Error
          ? processError.message
          : "Image could not be processed.",
      );
    }
  }

  async function reprocess() {
    if (!file) {
      return;
    }

    await acceptFile(file);
  }

  async function upload() {
    if (!processedFile) {
      return;
    }

    setState("uploading");
    setProgress(0);
    setError(null);

    try {
      const session = await getSalonProfileMediaUploadSessionAction(intent, kind);
      const path = session.path;

      await uploadToSupabase({
        accessToken: session.accessToken,
        anonKey: session.anonKey,
        blob: processedFile,
        bucket: session.bucket,
        onProgress: setProgress,
        path,
        supabaseUrl: session.supabaseUrl,
      });

      setUploadedPath(path);
      onUploaded(path);
      setState("uploaded");
    } catch (uploadError) {
      setState("ready");
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
    }
  }

  async function removeUploaded() {
    if (uploadedPath) {
      try {
        await deleteSalonProfileMediaAction(uploadedPath);
      } catch {
        // The server validates ownership again; a failed cleanup should not
        // leave the form blocked.
      }
    }

    setUploadedPath(null);
    setFile(null);
    setProcessedFile(null);
    setProgress(0);
    setState("idle");
    setPreviewUrl(null);
    onUploaded(null);

    if (currentPath) {
      onRemoveExisting?.();
    }
  }

  return (
    <div className="grid gap-3">
      <div
        className={[
          "grid min-h-48 place-items-center rounded-lg border border-dashed bg-zinc-50 p-4 text-center transition",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-zinc-400",
        ].join(" ")}
        onClick={() => {
          if (!disabled && !busy) {
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (!disabled && !busy) {
            void acceptFile(event.dataTransfer.files[0] ?? null);
          }
        }}
      >
        <input
          accept={SALON_PROFILE_ALLOWED_IMAGE_TYPES.join(",")}
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => void acceptFile(event.currentTarget.files?.[0] ?? null)}
          ref={inputRef}
          type="file"
        />
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`${label} preview`}
            className="max-h-56 w-full rounded-md object-cover"
            src={previewUrl}
          />
        ) : (
          <div>
            <p className="font-semibold text-zinc-950">{label}</p>
            <p className="mt-1 text-sm text-zinc-600">Drop or choose an image</p>
          </div>
        )}
      </div>

      {file && state !== "uploaded" ? (
        <div className="grid gap-3 rounded-lg border border-zinc-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium text-zinc-950">{file.name}</span>
            {processedFile ? (
              <span className="text-zinc-600">{formatBytes(processedFile.size)}</span>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold text-zinc-600">
              Zoom
              <input
                className="mt-2 w-full"
                max="2"
                min="1"
                onChange={(event) =>
                  setAdjustment((current) => ({
                    ...current,
                    zoom: Number(event.currentTarget.value),
                  }))
                }
                step="0.05"
                type="range"
                value={adjustment.zoom}
              />
            </label>
            <label className="text-xs font-semibold text-zinc-600">
              Horizontal
              <input
                className="mt-2 w-full"
                max="1"
                min="-1"
                onChange={(event) =>
                  setAdjustment((current) => ({
                    ...current,
                    offsetX: Number(event.currentTarget.value),
                  }))
                }
                step="0.05"
                type="range"
                value={adjustment.offsetX}
              />
            </label>
            <label className="text-xs font-semibold text-zinc-600">
              Vertical
              <input
                className="mt-2 w-full"
                max="1"
                min="-1"
                onChange={(event) =>
                  setAdjustment((current) => ({
                    ...current,
                    offsetY: Number(event.currentTarget.value),
                  }))
                }
                step="0.05"
                type="range"
                value={adjustment.offsetY}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950"
              disabled={busy}
              onClick={() => void reprocess()}
              type="button"
            >
              Adjust crop
            </button>
            <button
              className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:bg-zinc-300"
              disabled={!processedFile || busy}
              onClick={() => void upload()}
              type="button"
            >
              {state === "uploading" ? `Uploading ${progress}%` : "Upload"}
            </button>
          </div>
        </div>
      ) : null}

      {uploadedPath ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Uploaded and ready to save.
        </p>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <div className="flex items-start justify-between gap-3">
            <p>{error}</p>
            <button
              className="font-semibold underline"
              onClick={() => setError(null)}
              type="button"
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}
      {(uploadedPath || currentPath || previewUrl) && !busy ? (
        <button
          className="w-fit rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950"
          onClick={() => void removeUploaded()}
          type="button"
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}

function ReadinessPanel({ readiness }: { readiness: SalonProfileReadiness }) {
  return (
    <section className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            Publication readiness
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            {readiness.completionPercent}% complete
          </p>
        </div>
        <span className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-700">
          {readiness.isExploreEligible ? "Explore eligible" : "Not eligible"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${readiness.completionPercent}%` }}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {readiness.items.map((item) => (
          <div
            className="flex items-start justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2"
            key={item.id}
          >
            <div>
              <p className="text-sm font-medium text-zinc-950">{item.label}</p>
              <p className="text-xs text-zinc-500">
                {item.required ? "Required" : "Optional"}
              </p>
            </div>
            <span
              className={[
                "rounded-md px-2 py-1 text-xs font-semibold",
                item.complete
                  ? "bg-emerald-50 text-emerald-800"
                  : item.required
                    ? "bg-amber-50 text-amber-800"
                    : "bg-zinc-100 text-zinc-600",
              ].join(" ")}
            >
              {item.complete ? "Done" : "Missing"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: SalonProfileLookStatus | string }) {
  const className =
    status === "published"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "archived"
        ? "border-zinc-200 bg-zinc-100 text-zinc-600"
        : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${className}`}>
      {status}
    </span>
  );
}

function ProfileDrawer({
  canManageIdentity,
  coverUrl,
  logoUrl,
  onClose,
  setting,
}: {
  canManageIdentity: boolean;
  coverUrl: string | null;
  logoUrl: string | null;
  onClose: () => void;
  setting: SalonProfileSetting;
}) {
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [removeCover, setRemoveCover] = useState(false);
  const [uploading, setUploading] = useState(false);

  return (
    <form action={updateSalonProfileIdentityAction} className="grid gap-5">
      <input name="salon_id" type="hidden" value={setting.salon_id} />
      <input name="logo_image_path" type="hidden" value={logoPath ?? ""} />
      <input name="cover_image_path" type="hidden" value={coverPath ?? ""} />
      <input name="remove_logo_image" type="hidden" value={removeLogo ? "true" : "false"} />
      <input name="remove_cover_image" type="hidden" value={removeCover ? "true" : "false"} />
      {!canManageIdentity ? (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
          You can view this profile, but you do not have permission to edit it.
        </p>
      ) : null}
      <Field
        defaultValue={setting.business_name}
        label="Public business name"
        name="business_name"
        required
      />
      <Field
        defaultValue={setting.public_profile_tagline}
        label="Tagline"
        name="public_profile_tagline"
      />
      <TextArea
        defaultValue={setting.business_description}
        label="Short public description"
        name="business_description"
      />
      <TextArea
        defaultValue={setting.public_profile_story}
        label="Salon story"
        name="public_profile_story"
        rows={4}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field defaultValue={setting.phone} label="Phone" name="phone" />
        <Field defaultValue={setting.email} label="Email" name="email" type="email" />
      </div>
      <Field defaultValue={setting.website} label="Website" name="website" type="url" />
      <div className="grid gap-5 sm:grid-cols-2">
        <SalonMediaUploader
          currentPath={setting.public_profile_logo_path}
          currentUrl={logoUrl}
          disabled={!canManageIdentity}
          intent="identity"
          kind="logo"
          label="Logo image"
          onRemoveExisting={() => setRemoveLogo(true)}
          onUploaded={(path) => {
            setLogoPath(path);
            setRemoveLogo(false);
          }}
          onUploadStateChange={setUploading}
        />
        <SalonMediaUploader
          currentPath={setting.public_profile_cover_path}
          currentUrl={coverUrl}
          disabled={!canManageIdentity}
          intent="identity"
          kind="cover"
          label="Cover image"
          onRemoveExisting={() => setRemoveCover(true)}
          onUploaded={(path) => {
            setCoverPath(path);
            setRemoveCover(false);
          }}
          onUploadStateChange={setUploading}
        />
      </div>
      <SubmitFooter
        disabled={!canManageIdentity || uploading}
        onCancel={onClose}
        submitLabel="Save changes"
      />
    </form>
  );
}

function LookDrawer({
  canManageContent,
  onClose,
  services,
  setting,
  staff,
}: {
  canManageContent: boolean;
  onClose: () => void;
  services: Service[];
  setting: SalonProfileSetting;
  staff: Staff[];
}) {
  const activeServices = services.filter((service) => service.is_active);
  const activeStaff = staff.filter((member) => member.is_active);
  const [serviceId, setServiceId] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const selectedService = activeServices.find((service) => service.id === serviceId);

  return (
    <form action={createSalonProfileLookAction} className="grid gap-5">
      <input name="salon_id" type="hidden" value={setting.salon_id} />
      <input name="look_image_path" type="hidden" value={imagePath ?? ""} />
      <SalonMediaUploader
        currentPath={null}
        currentUrl={null}
        disabled={!canManageContent}
        intent="content"
        kind="look"
        label="Look image"
        onUploaded={setImagePath}
        onUploadStateChange={setUploading}
      />
      <Field label="Look name" name="title" required />
      <TextArea
        label="Short emotional description"
        name="emotional_description"
        rows={2}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">Mood</span>
          <select
            className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            name="mood"
          >
            <option value="">Choose mood</option>
            {SALON_PROFILE_MOOD_OPTIONS.filter((mood) => mood !== "Surprise me").map(
              (mood) => (
                <option key={mood} value={mood}>
                  {mood}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">Service</span>
          <select
            className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            name="service_id"
            onChange={(event) => setServiceId(event.currentTarget.value)}
            value={serviceId}
          >
            <SelectOptions items={activeServices} label="Choose service" />
          </select>
        </label>
      </div>
      {selectedService ? (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
          {[
            formatDuration(selectedService.duration_minutes),
            formatMoney(selectedService.base_price),
          ]
            .filter(Boolean)
            .join(" - ")}
        </p>
      ) : null}
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Recommended artist</span>
        <select
          className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="recommended_staff_id"
        >
          <SelectOptions
            items={activeStaff.map((member) => ({
              id: member.id,
              name: member.display_name,
            }))}
            label="Choose artist"
          />
        </select>
      </label>
      <details className="rounded-lg border border-zinc-200 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-950">
          Advanced options
        </summary>
        <div className="mt-4 grid gap-4">
          <label className="block">
            <span className="text-sm font-medium text-zinc-700">Badge</span>
            <select
              className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              name="badge"
            >
              <option value="">No badge</option>
              {SALON_PROFILE_BADGE_OPTIONS.map((badge) => (
                <option key={badge} value={badge}>
                  {badge}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Custom duration" name="duration_minutes" type="number" />
            <Field label="Custom starting price" name="starting_price" type="number" />
          </div>
          <TextArea label="Why you'll love it" name="why_love_it" rows={2} />
          <div className="grid gap-3 sm:grid-cols-4">
            {["palette_1", "palette_2", "palette_3", "palette_4"].map((name, index) => (
              <label className="block" key={name}>
                <span className="text-sm font-medium text-zinc-700">
                  Color {index + 1}
                </span>
                <input
                  className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-2"
                  defaultValue={["#f5d0c5", "#e9a8a6", "#f8fafc", "#111827"][index]}
                  name={name}
                  type="color"
                />
              </label>
            ))}
          </div>
        </div>
      </details>
      <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700">
        <input className="size-4" name="publish_now" type="checkbox" />
        Publish now
      </label>
      <SubmitFooter
        disabled={!canManageContent || uploading || !imagePath}
        onCancel={onClose}
        submitLabel="Save look"
      />
    </form>
  );
}

function OpeningDrawer({
  canManageContent,
  onClose,
  services,
  setting,
  staff,
}: {
  canManageContent: boolean;
  onClose: () => void;
  services: Service[];
  setting: SalonProfileSetting;
  staff: Staff[];
}) {
  return (
    <form action={createSalonProfileUpdateAction} className="grid gap-5">
      <input name="salon_id" type="hidden" value={setting.salon_id} />
      <input name="update_type" type="hidden" value="last_minute_opening" />
      <Field label="Date and time" name="starts_at" required type="datetime-local" />
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Service</span>
        <select
          className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="service_id"
          required
        >
          <SelectOptions
            items={services.filter((service) => service.is_active)}
            label="Choose service"
          />
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Artist</span>
        <select
          className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="staff_id"
          required
        >
          <SelectOptions
            items={staff
              .filter((member) => member.is_active)
              .map((member) => ({ id: member.id, name: member.display_name }))}
            label="Choose artist"
          />
        </select>
      </label>
      <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700">
        <input className="size-4" name="publish_now" type="checkbox" />
        Publish now
      </label>
      <SubmitFooter
        disabled={!canManageContent}
        onCancel={onClose}
        submitLabel="Share opening"
      />
    </form>
  );
}

function UpdateDrawer({
  canManageContent,
  onClose,
  services,
  setting,
}: {
  canManageContent: boolean;
  onClose: () => void;
  services: Service[];
  setting: SalonProfileSetting;
}) {
  return (
    <form action={createSalonProfileUpdateAction} className="grid gap-5">
      <input name="salon_id" type="hidden" value={setting.salon_id} />
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Update type</span>
        <select
          className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="update_type"
        >
          {SALON_PROFILE_UPDATE_TYPES.filter((type) => type !== "last_minute_opening").map(
            (type) => (
              <option key={type} value={type}>
                {type.replaceAll("_", " ")}
              </option>
            ),
          )}
        </select>
      </label>
      <Field label="Title" name="title" required />
      <TextArea label="Short summary" name="summary" rows={3} />
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">CTA</span>
        <select
          className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="cta_label"
        >
          <option value="">No CTA</option>
          {ctaOptions.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">Related service</span>
        <select
          className="mt-2 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          name="service_id"
        >
          <SelectOptions
            items={services.filter((service) => service.is_active)}
            label="Choose service"
          />
        </select>
      </label>
      <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700">
        <input className="size-4" name="publish_now" type="checkbox" />
        Publish now
      </label>
      <SubmitFooter
        disabled={!canManageContent}
        onCancel={onClose}
        submitLabel="Share update"
      />
    </form>
  );
}

export function SalonProfileStudio({
  canManageContent,
  canManageIdentity,
  error,
  looks,
  notice,
  previewData,
  publicHref,
  readiness,
  services,
  setting,
  staff,
  updates,
}: StudioProps) {
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("all");
  const [isPending, startTransition] = useTransition();
  const logoUrl = previewData.profile.logoImageUrl;
  const coverUrl = previewData.profile.coverImageUrl;
  const location = formatLocation(setting);
  const filteredLooks = looks.filter((look) => {
    if (libraryTab === "all") {
      return true;
    }

    if (libraryTab === "scheduled") {
      return false;
    }

    return look.status === libraryTab;
  });
  const publishedLooks = looks.filter((look) => look.status === "published");

  function submitPublication(enabled: boolean) {
    const formData = new FormData();
    formData.set("salon_id", setting.salon_id);
    formData.set("public_discovery_enabled", String(enabled));

    startTransition(() => {
      void setSalonProfilePublicationAction(formData);
    });
  }

  return (
    <main className="min-w-0 overflow-x-hidden bg-zinc-50">
      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 border-b border-zinc-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold text-zinc-950">
                Salon Profile
              </h1>
              <span className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700">
                {statusLabels[readiness.status]}
              </span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
              Manage the public profile, visual looks, openings, and Explore readiness.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex min-h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50"
              onClick={() => setDrawer("preview")}
              type="button"
            >
              Preview
            </button>
            <Link
              className={[
                "inline-flex min-h-10 items-center rounded-md border px-4 text-sm font-semibold transition",
                readiness.isExploreEligible
                  ? "border-zinc-300 bg-white text-zinc-950 hover:bg-zinc-50"
                  : "pointer-events-none border-zinc-200 bg-zinc-100 text-zinc-400",
              ].join(" ")}
              href={publicHref}
              aria-disabled={!readiness.isExploreEligible}
            >
              View public profile
            </Link>
            <Link
              className="inline-flex min-h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50"
              href="/salon-settings#public-profile-discovery"
            >
              Publication settings
            </Link>
          </div>
        </div>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="relative h-48 bg-zinc-100">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={`${setting.business_name} cover`}
                  className="h-full w-full object-cover"
                  src={coverUrl}
                />
              ) : null}
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end">
              <div className="-mt-14 h-24 w-24 overflow-hidden rounded-lg border-4 border-white bg-zinc-100 shadow-sm">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={`${setting.business_name} logo`}
                    className="h-full w-full object-cover"
                    src={logoUrl}
                  />
                ) : null}
              </div>
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold text-zinc-950">
                  {setting.business_name}
                </h2>
                {setting.public_profile_tagline ? (
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    {setting.public_profile_tagline}
                  </p>
                ) : null}
                <p className="mt-2 text-sm text-zinc-500">
                  {[location, `${readiness.completionPercent}% complete`]
                    .filter(Boolean)
                    .join(" - ")}
                </p>
              </div>
              <button
                className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:bg-zinc-300"
                disabled={!canManageIdentity}
                onClick={() => setDrawer("profile")}
                type="button"
              >
                Edit profile
              </button>
            </div>
          </section>

          <ReadinessPanel readiness={readiness} />
        </div>

        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-zinc-950">Quick create</h2>
            <div className="flex flex-wrap gap-2">
              <button
                className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:bg-zinc-300"
                disabled={!canManageContent}
                onClick={() => setDrawer("look")}
                type="button"
              >
                Drop a look
              </button>
              <button
                className="min-h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:text-zinc-400"
                disabled={!canManageContent}
                onClick={() => setDrawer("opening")}
                type="button"
              >
                Share opening
              </button>
              <button
                className="min-h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 disabled:text-zinc-400"
                disabled={!canManageContent}
                onClick={() => setDrawer("update")}
                type="button"
              >
                Salon update
              </button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              ["Looks", looks.length],
              ["Published", publishedLooks.length],
              ["Updates", updates.length],
            ].map(([label, count]) => (
              <div
                className="rounded-lg border border-zinc-200 bg-white p-4"
                key={label}
              >
                <p className="text-sm text-zinc-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-zinc-950">{count}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">
                Content library
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                Manage looks and compact updates for this salon.
              </p>
            </div>
            <div className="flex w-max max-w-full gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-white p-1">
              {libraryTabs.map((tab) => (
                <button
                  className={[
                    "min-h-9 shrink-0 rounded-md px-3 text-sm font-semibold transition",
                    libraryTab === tab.id
                      ? "bg-zinc-950 text-white"
                      : "text-zinc-600 hover:bg-zinc-50",
                  ].join(" ")}
                  key={tab.id}
                  onClick={() => setLibraryTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          {filteredLooks.length === 0 && updates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
              <h3 className="text-lg font-semibold text-zinc-950">
                No content in this view
              </h3>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredLooks.map((look) => (
                <article
                  className="overflow-hidden rounded-lg border border-zinc-200 bg-white"
                  key={look.id}
                >
                  <div className="aspect-[4/3] bg-zinc-100">
                    {look.media_path ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={`${look.title} preview`}
                        className="h-full w-full object-cover"
                        src={
                          previewData.looks.find((item) => item.id === look.id)
                            ?.imageUrl ?? ""
                        }
                      />
                    ) : null}
                  </div>
                  <div className="grid gap-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-zinc-950">{look.title}</h3>
                        <p className="mt-1 text-sm text-zinc-600">
                          {[look.mood, look.service?.name, look.recommended_staff?.display_name]
                            .filter(Boolean)
                            .join(" - ")}
                        </p>
                      </div>
                      <StatusBadge status={look.status} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <form action={setSalonProfileLookStatusAction}>
                        <input name="salon_id" type="hidden" value={setting.salon_id} />
                        <input name="look_id" type="hidden" value={look.id} />
                        <input
                          name="status"
                          type="hidden"
                          value={look.status === "published" ? "archived" : "published"}
                        />
                        <button
                          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950"
                          disabled={!canManageContent}
                          type="submit"
                        >
                          {look.status === "published" ? "Archive" : "Publish"}
                        </button>
                      </form>
                      <form action={pinSalonProfileLookAction}>
                        <input name="salon_id" type="hidden" value={setting.salon_id} />
                        <input name="look_id" type="hidden" value={look.id} />
                        <input
                          name="is_pinned"
                          type="hidden"
                          value={look.is_pinned ? "false" : "true"}
                        />
                        <button
                          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950"
                          disabled={!canManageContent}
                          type="submit"
                        >
                          {look.is_pinned ? "Unpin" : "Pin"}
                        </button>
                      </form>
                      <form
                        action={deleteSalonProfileLookAction}
                        onSubmit={(event: FormEvent<HTMLFormElement>) => {
                          if (!window.confirm("Delete this look?")) {
                            event.preventDefault();
                          }
                        }}
                      >
                        <input name="salon_id" type="hidden" value={setting.salon_id} />
                        <input name="look_id" type="hidden" value={look.id} />
                        <button
                          className="rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700"
                          disabled={!canManageContent}
                          type="submit"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                </article>
              ))}
              {updates.map((update) => (
                <article
                  className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4"
                  key={update.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-emerald-700">
                        {update.update_type.replaceAll("_", " ")}
                      </p>
                      <h3 className="mt-1 font-semibold text-zinc-950">
                        {update.title}
                      </h3>
                    </div>
                    <StatusBadge status={update.status} />
                  </div>
                  {update.summary ? (
                    <p className="text-sm leading-6 text-zinc-600">{update.summary}</p>
                  ) : null}
                  <p className="text-sm text-zinc-500">
                    {[formatDateTime(update.starts_at), update.service?.name, update.staff?.display_name]
                      .filter(Boolean)
                      .join(" - ")}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">Publish</h2>
              <p className="mt-1 text-sm text-zinc-600">
                {readiness.canPublish
                  ? "This salon meets the public profile requirements."
                  : `Missing: ${readiness.missingRequiredItems.join(", ")}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {setting.public_discovery_enabled ? (
                <button
                  className="min-h-10 rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                  disabled={isPending || !canManageIdentity}
                  onClick={() => submitPublication(false)}
                  type="button"
                >
                  Unpublish
                </button>
              ) : (
                <button
                  className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white disabled:bg-zinc-300"
                  disabled={isPending || !canManageIdentity || !readiness.canPublish}
                  onClick={() => submitPublication(true)}
                  type="button"
                >
                  Publish
                </button>
              )}
            </div>
          </div>
        </section>
      </section>

      {drawer === "profile" ? (
        <Drawer onClose={() => setDrawer(null)} title="Edit profile">
          <ProfileDrawer
            canManageIdentity={canManageIdentity}
            coverUrl={coverUrl}
            logoUrl={logoUrl}
            onClose={() => setDrawer(null)}
            setting={setting}
          />
        </Drawer>
      ) : null}
      {drawer === "look" ? (
        <Drawer onClose={() => setDrawer(null)} title="Drop a look">
          <LookDrawer
            canManageContent={canManageContent}
            onClose={() => setDrawer(null)}
            services={services}
            setting={setting}
            staff={staff}
          />
        </Drawer>
      ) : null}
      {drawer === "opening" ? (
        <Drawer onClose={() => setDrawer(null)} title="Share opening">
          <OpeningDrawer
            canManageContent={canManageContent}
            onClose={() => setDrawer(null)}
            services={services}
            setting={setting}
            staff={staff}
          />
        </Drawer>
      ) : null}
      {drawer === "update" ? (
        <Drawer onClose={() => setDrawer(null)} title="Salon update">
          <UpdateDrawer
            canManageContent={canManageContent}
            onClose={() => setDrawer(null)}
            services={services}
            setting={setting}
          />
        </Drawer>
      ) : null}
      {drawer === "preview" ? (
        <Drawer onClose={() => setDrawer(null)} title="Preview">
          <SalonProfileView data={previewData} />
        </Drawer>
      ) : null}
    </main>
  );
}
