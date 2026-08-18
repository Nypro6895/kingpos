"use client";

import {
  createSalonProfileCommentAction,
  createSalonProfileReviewAction,
  createSalonProfileReviewReplyAction,
  createSalonProfileSocialPostAction,
  deleteSalonProfileLookDirectAction,
  getSalonProfileMediaUploadSessionAction,
  setSalonProfilePublicationAction,
  setSalonProfileCommentStatusAction,
  setSalonProfileLookStatusDirectAction,
  toggleSalonFollowAction,
  toggleSalonLookSaveAction,
  updateSalonProfileIdentityAction,
  updateSalonProfileIdentityMediaAction,
} from "@/app/salon-profile/actions";
import { BeforeAfterCompare } from "@/components/before-after-compare";
import {
  SALON_PROFILE_ALLOWED_IMAGE_TYPES,
  SALON_PROFILE_IMAGE_LIMITS,
  type SalonProfileMediaKind,
} from "@/lib/salon-profile-media";
import type {
  ProfileFeedItem,
  PublicSalonProfileBeautyPost,
  PublicSalonProfileComment,
  PublicSalonProfileData,
  PublicSalonProfileLook,
  PublicSalonProfileReview,
  PublicSalonProfileService,
  PublicSalonProfileStaff,
  SalonProfileReadiness,
  SalonProfileSetting,
  SalonProfileViewerCapabilities,
} from "@/types/salon-profile";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ButtonHTMLAttributes,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type SalonProfileViewProps = {
  capabilities?: SalonProfileViewerCapabilities;
  data: PublicSalonProfileData;
  error?: string;
  manageData?: {
    publicHref: string;
    readiness: SalonProfileReadiness;
    setting: SalonProfileSetting;
  };
  notice?: string;
};

type TabId = "about" | "discover" | "gallery" | "reviews" | "services" | "team";
type ComposerType = "auto" | "look" | "opening" | "update";
type SalonProfileUploadableKind = Extract<
  SalonProfileMediaKind,
  "cover" | "logo" | "look" | "update"
>;
type BookingContext = {
  lookId?: string | null;
  note?: string | null;
  serviceId?: string | null;
  staffId?: string | null;
  title: string;
  updateId?: string | null;
} | null;

type CommentTarget = {
  lookId?: string | null;
  title: string;
  updateId?: string | null;
};

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "discover", label: "Discover" },
  { id: "gallery", label: "Gallery" },
  { id: "services", label: "Services" },
  { id: "team", label: "Team" },
  { id: "reviews", label: "Reviews" },
  { id: "about", label: "About" },
];

function tabFromHash(hash: string) {
  const value = hash.replace(/^#/, "");

  return TABS.find((tab) => tab.id === value)?.id ?? null;
}

const EMPTY_CAPABILITIES: SalonProfileViewerCapabilities = {
  canBook: true,
  canCreateContent: false,
  canEditProfile: false,
  canFollow: true,
  canManageContent: false,
  canModerateComments: false,
  canPublish: false,
  canReplyAsSalon: false,
  canViewDraftContent: false,
  isAuthenticated: false,
  isOwnSalon: false,
};

const acceptedMimeTypes = new Set<string>(SALON_PROFILE_ALLOWED_IMAGE_TYPES);

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

function formatMoney(value: number | null) {
  if (value === null) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function formatDuration(minutes: number | null) {
  if (!minutes) {
    return null;
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

function formatAddress(profile: PublicSalonProfileData["profile"]) {
  const cityState = [formatCity(profile.city), formatState(profile.state)]
    .filter(Boolean)
    .join(", ");
  const cityLine = [cityState, profile.postalCode].filter(Boolean).join(" ");

  return [
    profile.addressLine1,
    profile.addressLine2,
    cityLine,
    profile.country,
  ]
    .filter(Boolean)
    .join(", ");
}

function formatLocation(profile: PublicSalonProfileData["profile"]) {
  return [formatCity(profile.city), formatState(profile.state)]
    .filter(Boolean)
    .join(", ");
}

function formatCity(value: string | null) {
  if (!value) {
    return null;
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function formatState(value: string | null) {
  if (!value) {
    return null;
  }

  return value.trim().length <= 3
    ? value.trim().toUpperCase()
    : formatCity(value);
}

function formatPhone(value: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return value;
}

function normalizeWebsite(value: string | null) {
  if (!value) {
    return null;
  }

  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function displayWebsite(value: string | null) {
  return value?.replace(/^https?:\/\//i, "").replace(/\/$/, "") ?? null;
}

function directionsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    address,
  )}`;
}

function joinMeta(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" / ");
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function timeAgo(value: string | null) {
  if (!value) {
    return "Just now";
  }

  const date = new Date(value);
  const deltaMs = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.round(deltaMs / 60000));

  if (minutes < 2) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours} hr ago`;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function imageFallbackClass(seed: string) {
  const variants = [
    "bg-[linear-gradient(135deg,#f8fafc,#e0f2fe_48%,#fef3c7)]",
    "bg-[linear-gradient(135deg,#f9fafb,#dcfce7_46%,#fce7f3)]",
    "bg-[linear-gradient(135deg,#fafafa,#e0e7ff_44%,#fee2e2)]",
    "bg-[linear-gradient(135deg,#f7fee7,#f5f5f5_48%,#cffafe)]",
  ];
  const index = seed
    .split("")
    .reduce((total, letter) => total + letter.charCodeAt(0), 0);

  return variants[index % variants.length];
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

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
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

async function processImage(file: File, kind: SalonProfileMediaKind) {
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
  const sx = Math.max(0, (image.naturalWidth - cropWidth) / 2);
  const sy = Math.max(0, (image.naturalHeight - cropHeight) / 2);
  const outputWidth = Math.min(config.maxWidth, Math.round(cropWidth));
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
    cropWidth,
    cropHeight,
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

async function processAndUploadImage(input: {
  file: File;
  intent: "content" | "identity";
  kind: SalonProfileUploadableKind;
  onProgress: (value: number) => void;
}) {
  if (!acceptedMimeTypes.has(input.file.type)) {
    throw new Error("Use a JPEG, PNG, or WebP image.");
  }

  if (input.file.size > SALON_PROFILE_IMAGE_LIMITS[input.kind]) {
    throw new Error("That image is too large.");
  }

  const processed = await processImage(input.file, input.kind);
  const session = await getSalonProfileMediaUploadSessionAction(
    input.intent,
    input.kind,
  );

  await uploadToSupabase({
    accessToken: session.accessToken,
    anonKey: session.anonKey,
    blob: processed,
    bucket: session.bucket,
    onProgress: input.onProgress,
    path: session.path,
    supabaseUrl: session.supabaseUrl,
  });

  return session.path;
}

function EmptyState({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/85 p-8 text-center shadow-[0_16px_50px_rgba(24,24,27,.05)]">
      <h3 className="text-lg font-semibold text-zinc-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
        {children}
      </p>
    </div>
  );
}

function Button({
  children,
  className = "",
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "subtle";
}) {
  const styles = {
    primary:
      "bg-zinc-950 text-white hover:bg-zinc-800 disabled:bg-zinc-400",
    secondary:
      "border border-zinc-300 bg-white text-zinc-950 hover:bg-zinc-50 disabled:text-zinc-400",
    subtle: "text-zinc-700 hover:bg-zinc-100 disabled:text-zinc-400",
  };

  return (
    <button
      className={[
        "inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed",
        styles[variant],
        className,
      ].join(" ")}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function LookImage({
  imageUrl,
  title,
  className,
}: {
  className: string;
  imageUrl: string | null;
  title: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${title} nail look`}
        className={`${className} object-cover`}
        src={imageUrl}
      />
    );
  }

  return (
    <div
      aria-label={`${title} visual fallback`}
      className={`${className} ${imageFallbackClass(title)} grid place-items-center overflow-hidden`}
      role="img"
    >
      <span className="max-w-40 text-center text-sm font-semibold text-zinc-700">
        {title}
      </span>
    </div>
  );
}

function CaptionWithHashtags({ text }: { text: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_-]+)/gu);

  return (
    <>
      {parts.map((part, index) => {
        if (!part.startsWith("#") || part.length < 2) {
          return <span key={`${part}-${index}`}>{part}</span>;
        }

        const tag = part.slice(1).toLowerCase();

        return (
          <a
            className="font-semibold text-zinc-950 underline-offset-4 hover:underline"
            href={`/explore?q=${encodeURIComponent(`#${tag}`)}`}
            key={`${part}-${index}`}
          >
            {part}
          </a>
        );
      })}
    </>
  );
}

function normalizeSuggestionToken(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function hashtagSuggestionsForServices(
  caption: string,
  services: PublicSalonProfileService[],
) {
  const hashtags = Array.from(caption.matchAll(/#([a-z0-9_-]{2,48})/gi)).map(
    (match) => normalizeSuggestionToken(match[1] ?? ""),
  );

  if (hashtags.length === 0) {
    return null;
  }

  for (const tag of hashtags) {
    const service = services.find((candidate) => {
      const serviceName = normalizeSuggestionToken(candidate.name);
      const category = normalizeSuggestionToken(candidate.category ?? "");

      return tag === serviceName || tag === category;
    });

    if (service) {
      return { hashtag: tag, service };
    }
  }

  return null;
}

function SalonCover({
  coverImageUrl,
  name,
}: {
  coverImageUrl: string | null;
  name: string;
}) {
  if (coverImageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${name} salon cover`}
        className="absolute inset-0 h-full w-full object-cover"
        src={coverImageUrl}
      />
    );
  }

  return (
    <div
      aria-label={`${name} cover fallback`}
      className="absolute inset-0 bg-[linear-gradient(135deg,#f8fafc,#d1fae5_45%,#fef9c3)]"
      role="img"
    />
  );
}

function MediaApplyButton({
  className = "",
  iconOnly = false,
  kind,
  label,
  salonId,
}: {
  className?: string;
  iconOnly?: boolean;
  kind: "cover" | "logo";
  label: string;
  salonId: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  async function onFile(file: File | null) {
    if (!file || busy) {
      return;
    }

    setBusy(true);
    setError("");
    setProgress(0);

    try {
      const path = await processAndUploadImage({
        file,
        intent: "identity",
        kind,
        onProgress: setProgress,
      });
      const result = await updateSalonProfileIdentityMediaAction({
        kind,
        path,
        salonId,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      router.refresh();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Profile image could not be updated.",
      );
    } finally {
      setBusy(false);
      setProgress(0);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  if (iconOnly) {
    return (
      <span className="inline-grid gap-1">
        <input
          accept={SALON_PROFILE_ALLOWED_IMAGE_TYPES.join(",")}
          className="sr-only"
          onChange={(event) => void onFile(event.currentTarget.files?.[0] ?? null)}
          ref={inputRef}
          type="file"
        />
        <button
          aria-label={label}
          className={[
            "inline-flex min-h-10 w-10 items-center justify-center rounded-full bg-transparent p-0 text-zinc-950/55 transition hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          ].join(" ")}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          title={busy ? `Applying ${progress}%` : label}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5 sm:h-6 sm:w-6"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <path d="M14.5 4 16 6h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2z" />
            <circle cx="12" cy="13" r="3" />
          </svg>
          <span className="sr-only">
            {busy ? `Applying ${progress}%` : label}
          </span>
        </button>
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-grid gap-1">
      <input
        accept={SALON_PROFILE_ALLOWED_IMAGE_TYPES.join(",")}
        className="sr-only"
        onChange={(event) => void onFile(event.currentTarget.files?.[0] ?? null)}
        ref={inputRef}
        type="file"
      />
      <Button
        aria-label={label}
        className={className}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        title={busy ? `Applying ${progress}%` : label}
        variant="secondary"
      >
        {busy ? `Applying ${progress}%` : label}
      </Button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}

function Modal({
  bodyClassName = "",
  children,
  footer,
  initialFocusRef,
  onClose,
  panelClassName = "",
  title,
}: {
  bodyClassName?: string;
  children: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: { current: HTMLElement | null };
  onClose: () => void;
  panelClassName?: string;
  title: string;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const latestOnCloseRef = useRef(onClose);
  const previousActiveElementRef = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    latestOnCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    previousActiveElementRef.current = document.activeElement;
    const target = initialFocusRef?.current ?? dialogRef.current;

    target?.focus({ preventScroll: true });

    return () => {
      const previousActiveElement = previousActiveElementRef.current;

      if (previousActiveElement instanceof HTMLElement) {
        previousActiveElement.focus({ preventScroll: true });
      }
    };
  }, [initialFocusRef]);

  function onDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      latestOnCloseRef.current();
      return;
    }

    if (event.key !== "Tab" || !dialogRef.current) {
      return;
    }

    const focusableElements = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        [
          "a[href]",
          "button:not([disabled])",
          "textarea:not([disabled])",
          "input:not([disabled])",
          "select:not([disabled])",
          "[tabindex]:not([tabindex='-1'])",
        ].join(","),
      ),
    ).filter((element) => element.offsetParent !== null);

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialogRef.current.focus({ preventScroll: true });
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus({ preventScroll: true });
    }
  }

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-50 grid bg-zinc-950/45 p-0 backdrop-blur-sm sm:p-5"
      onKeyDown={onDialogKeyDown}
      role="dialog"
    >
      <button
        aria-label="Close dialog backdrop"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div
        className={[
          "relative mt-auto grid max-h-[min(92dvh,900px)] w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:m-auto sm:max-w-2xl sm:rounded-2xl",
          panelClassName,
        ].join(" ")}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="z-10 flex min-h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5">
          <h2 className="text-base font-semibold text-zinc-950" id={titleId}>
            {title}
          </h2>
          <button
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full border border-zinc-200 text-sm text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </div>
        <div className={["overflow-y-auto p-5", bodyClassName].join(" ")}>
          {children}
        </div>
        {footer ? (
          <div className="z-10 border-t border-zinc-200 bg-white px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProfileEditor({
  onClose,
  setting,
}: {
  onClose: () => void;
  setting: SalonProfileSetting;
}) {
  const [businessName, setBusinessName] = useState(setting.business_name);
  const [tagline, setTagline] = useState(setting.public_profile_tagline ?? "");
  const [description, setDescription] = useState(
    setting.business_description ?? "",
  );

  return (
    <Modal onClose={onClose} title="Edit profile">
      <form action={updateSalonProfileIdentityAction} className="grid gap-4">
        <input name="salon_id" type="hidden" value={setting.salon_id} />
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Live preview
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-zinc-950">
            {businessName || "Salon name"}
          </h3>
          {description ? (
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              {description}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <MediaApplyButton
              className="min-h-9 px-3 text-xs"
              kind="logo"
              label="Change logo"
              salonId={setting.salon_id}
            />
            <MediaApplyButton
              className="min-h-9 px-3 text-xs"
              kind="cover"
              label="Change cover"
              salonId={setting.salon_id}
            />
          </div>
        </div>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-zinc-800">
            Public salon name
          </span>
          <input
            className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
            name="business_name"
            onChange={(event) => setBusinessName(event.currentTarget.value)}
            required
            type="text"
            value={businessName}
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-zinc-800">Tagline</span>
          <input
            className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
            name="public_profile_tagline"
            onChange={(event) => setTagline(event.currentTarget.value)}
            type="text"
            value={tagline}
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-zinc-800">
            Short description
          </span>
          <textarea
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none transition focus:border-zinc-950"
            name="business_description"
            onChange={(event) => setDescription(event.currentTarget.value)}
            rows={3}
            value={description}
          />
        </label>
        <TextArea
          defaultValue={setting.public_profile_story}
          label="Story"
          name="public_profile_story"
          rows={4}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field defaultValue={setting.phone} label="Phone" name="phone" />
          <Field defaultValue={setting.email} label="Email" name="email" />
        </div>
        <Field defaultValue={setting.website} label="Website" name="website" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            defaultValue={setting.address_line1}
            label="Address line 1"
            name="address_line1"
          />
          <Field
            defaultValue={setting.address_line2}
            label="Address line 2"
            name="address_line2"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field defaultValue={setting.city} label="City" name="city" />
          <Field defaultValue={setting.state} label="State" name="state" />
          <Field
            defaultValue={setting.postal_code}
            label="ZIP"
            name="postal_code"
          />
        </div>
        <Field defaultValue={setting.country} label="Country" name="country" />
        <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4">
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  defaultValue,
  label,
  name,
  required,
  type = "text",
}: {
  defaultValue?: string | number | null;
  label: string;
  name: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-zinc-800">{label}</span>
      <input
        className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
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
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-zinc-800">{label}</span>
      <textarea
        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none transition focus:border-zinc-950"
        defaultValue={defaultValue ?? ""}
        name={name}
        rows={rows}
      />
    </label>
  );
}

function ComposerCard({
  logoUrl,
  name,
  onOpen,
}: {
  logoUrl: string | null;
  name: string;
  onOpen: (type: ComposerType) => void;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
      <div className="flex items-center gap-3">
        <Avatar logoUrl={logoUrl} name={name} size="md" />
        <button
          className="min-h-12 flex-1 rounded-2xl bg-zinc-100 px-4 py-3 text-left text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          onClick={() => onOpen("auto")}
          type="button"
        >
          Create something customers can act on
          <span className="mt-0.5 block text-xs font-normal text-zinc-500">
            Share a photo, opening, or quick salon update.
          </span>
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button onClick={() => onOpen("look")} variant="primary">
          Drop a look
        </Button>
        <Button onClick={() => onOpen("opening")} variant="secondary">
          Share opening
        </Button>
      </div>
    </section>
  );
}

function ComposerModal({
  data,
  initialType,
  onClose,
  onPosted,
}: {
  data: PublicSalonProfileData;
  initialType: ComposerType;
  onClose: () => void;
  onPosted: () => void;
}) {
  const router = useRouter();
  const captionRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const formId = useId();
  const [caption, setCaption] = useState("");
  const [additionalServiceIds, setAdditionalServiceIds] = useState<string[]>([]);
  const [bookingCtaEnabled, setBookingCtaEnabled] = useState(true);
  const [bookingSetupOpen, setBookingSetupOpen] = useState(false);
  const [contentType, setContentType] = useState<ComposerType>(initialType);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mood, setMood] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [serviceSearch, setServiceSearch] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [startingPrice, setStartingPrice] = useState("");
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isDirty = Boolean(
    caption.trim() ||
      file ||
      title.trim() ||
      serviceId ||
      additionalServiceIds.length > 0 ||
      staffId ||
      startsAt ||
      mood ||
      durationMinutes ||
      startingPrice,
  );

  useEffect(() => {
    captionRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (contentType === "opening") {
      queueMicrotask(() => {
        setDetailsOpen(true);
        setBookingSetupOpen(true);
        setBookingCtaEnabled(true);
      });
    }
  }, [contentType]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  function acceptFile(nextFile: File | null) {
    setError("");

    if (!nextFile) {
      return;
    }

    if (!acceptedMimeTypes.has(nextFile.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
  }

  function resizeCaptionTextarea() {
    const textarea = captionRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const resolvedType =
      contentType === "auto" ? (file ? "look" : "update") : contentType;

    if (resolvedType === "opening" && !caption.trim()) {
      setError("Write a short opening message before sharing.");
      return;
    }

    if (!caption.trim() && !file && resolvedType !== "opening") {
      setError("Write a caption or choose an image before posting.");
      return;
    }

    if (resolvedType === "look" && !file) {
      setError("Choose an image for a look post.");
      return;
    }

    setSubmitting(true);
    setProgress(0);

    try {
      const imagePath = file
        ? await processAndUploadImage({
            file,
            intent: "content",
            kind: resolvedType === "look" ? "look" : "update",
            onProgress: setProgress,
          })
        : null;
      const result = await createSalonProfileSocialPostAction({
        additionalServiceIds,
        bookingCtaEnabled,
        caption,
        contentType: resolvedType,
        imagePath,
        durationMinutes: durationMinutes ? Number(durationMinutes) : null,
        mood: mood || null,
        salonId: data.profile.salonId,
        serviceId: serviceId || null,
        staffId: staffId || null,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        startingPrice: startingPrice ? Number(startingPrice) : null,
        title,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      router.refresh();
      onPosted();
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Post failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function requestClose() {
    if (
      isDirty &&
      !submitting &&
      !window.confirm("Discard this post draft?")
    ) {
      return;
    }

    onClose();
  }

  const primaryLabel = contentType === "opening" ? "Share" : "Post";
  const pendingLabel = contentType === "opening" ? "Sharing" : "Posting";
  const suggestedService = hashtagSuggestionsForServices(caption, data.services);
  const filteredServices = data.services.filter((service) => {
    const query = serviceSearch.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return [service.name, service.category, service.description]
      .some(
        (value) =>
          typeof value === "string" && value.toLowerCase().includes(query),
      );
  });
  const additionalServices = data.services.filter(
    (service) => service.id !== serviceId,
  );
  const onlineStaff = data.staff.filter((member) => member.onlineBookingEnabled);

  return (
    <Modal
      bodyClassName="p-0"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-500" aria-live="polite">
            {submitting
              ? `${pendingLabel} ${progress}%`
              : "Photo, caption, and publish happen in one step."}
          </p>
          <Button disabled={submitting} form={formId} type="submit" variant="primary">
            {submitting ? `${pendingLabel}...` : primaryLabel}
          </Button>
        </div>
      }
      initialFocusRef={captionRef}
      onClose={requestClose}
      panelClassName="sm:max-w-[46rem]"
      title={contentType === "opening" ? "Share opening" : "Create post"}
    >
      <form className="grid gap-4 p-5" id={formId} onSubmit={submit}>
        <div className="flex items-center gap-3">
          <Avatar
            logoUrl={data.profile.logoImageUrl}
            name={data.profile.name}
            size="md"
          />
          <div>
            <p className="font-semibold text-zinc-950">{data.profile.name}</p>
            <p className="text-sm text-zinc-500">Posting to Salon Profile</p>
          </div>
        </div>
        <label className="sr-only" htmlFor={`${formId}-caption`}>
          Post caption
        </label>
        <textarea
          className="max-h-56 min-h-28 resize-none rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-base leading-7 text-zinc-950 outline-none transition focus:border-zinc-950"
          id={`${formId}-caption`}
          onChange={(event) => {
            setCaption(event.currentTarget.value);
            resizeCaptionTextarea();
          }}
          placeholder="What would you like customers to see?"
          ref={captionRef}
          value={caption}
        />
        <div
          className="grid min-h-36 cursor-pointer place-items-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center transition hover:border-zinc-400"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            acceptFile(event.dataTransfer.files[0] ?? null);
          }}
        >
          <input
            accept={SALON_PROFILE_ALLOWED_IMAGE_TYPES.join(",")}
            className="sr-only"
            onChange={(event) =>
              acceptFile(event.currentTarget.files?.[0] ?? null)
            }
            ref={fileInputRef}
            type="file"
          />
          {previewUrl ? (
            <div className="relative w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="Selected post preview"
                className="max-h-72 w-full rounded-xl object-cover"
                src={previewUrl}
              />
              <Button
                aria-label="Remove selected image"
                className="absolute right-3 top-3 min-h-8 rounded-full bg-white/95 px-3 text-xs shadow-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  setFile(null);
                  setPreviewUrl(null);
                }}
                variant="secondary"
              >
                Remove
              </Button>
            </div>
          ) : (
            <div>
              <p className="font-semibold text-zinc-950">Add a photo</p>
              <p className="mt-1 text-sm text-zinc-600">
                Drop an image or choose from your device.
              </p>
            </div>
          )}
        </div>
        <button
          className="w-max text-sm font-semibold text-zinc-700 underline-offset-4 hover:text-zinc-950 hover:underline"
          onClick={() => setDetailsOpen((current) => !current)}
          type="button"
        >
          Add details
        </button>
        {detailsOpen ? (
          <div className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-zinc-800">
                Content type
              </span>
              <select
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                onChange={(event) =>
                  setContentType(event.currentTarget.value as ComposerType)
                }
                value={contentType}
              >
                <option value="auto">Auto</option>
                <option value="look">Look</option>
                <option value="update">Salon update</option>
                <option value="opening">Opening</option>
              </select>
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-zinc-800">
                Optional title
              </span>
              <input
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
                onChange={(event) => setTitle(event.currentTarget.value)}
                type="text"
                value={title}
              />
            </label>
            <section className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4">
              <button
                className="flex items-center justify-between gap-3 text-left"
                onClick={() => setBookingSetupOpen((current) => !current)}
                type="button"
              >
                <span>
                  <span className="block text-sm font-semibold text-zinc-900">
                    Booking setup
                  </span>
                  <span className="block text-xs text-zinc-500">Optional</span>
                </span>
                <span className="text-sm font-semibold text-zinc-600">
                  {bookingSetupOpen ? "Hide" : "Edit"}
                </span>
              </button>
              {bookingSetupOpen ? (
                <div className="grid gap-3">
                  <label className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2">
                    <span className="text-sm font-semibold text-zinc-800">
                      Allow customers to book from this post
                    </span>
                    <input
                      checked={bookingCtaEnabled}
                      onChange={(event) =>
                        setBookingCtaEnabled(event.currentTarget.checked)
                      }
                      type="checkbox"
                    />
                  </label>
                  {suggestedService && suggestedService.service.id !== serviceId ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                      <span className="font-semibold">
                        Suggested from #{suggestedService.hashtag}:{" "}
                        {suggestedService.service.name}
                      </span>
                      <button
                        className="ml-3 font-semibold underline underline-offset-4"
                        onClick={() => {
                          setBookingCtaEnabled(true);
                          setServiceId(suggestedService.service.id);
                          setAdditionalServiceIds((current) =>
                            current.filter(
                              (id) => id !== suggestedService.service.id,
                            ),
                          );
                        }}
                        type="button"
                      >
                        Use suggestion
                      </button>
                    </div>
                  ) : null}
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-zinc-800">
                      Primary service
                    </span>
                    <input
                      className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                      onChange={(event) => setServiceSearch(event.currentTarget.value)}
                      placeholder="Search services"
                      type="search"
                      value={serviceSearch}
                    />
                    <select
                      className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                      onChange={(event) => {
                        const nextServiceId = event.currentTarget.value;
                        setServiceId(nextServiceId);
                        setAdditionalServiceIds((current) =>
                          current.filter((id) => id !== nextServiceId),
                        );
                      }}
                      value={serviceId}
                    >
                      <option value="">No primary service</option>
                      {filteredServices.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} / Online
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-2">
                    <span className="text-sm font-semibold text-zinc-800">
                      Additional services
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {additionalServices.slice(0, 8).map((service) => {
                        const selected = additionalServiceIds.includes(service.id);

                        return (
                          <button
                            className={[
                              "rounded-full border px-3 py-2 text-xs font-semibold",
                              selected
                                ? "border-zinc-950 bg-zinc-950 text-white"
                                : "border-zinc-300 bg-white text-zinc-700",
                            ].join(" ")}
                            key={service.id}
                            onClick={() =>
                              setAdditionalServiceIds((current) =>
                                selected
                                  ? current.filter((id) => id !== service.id)
                                  : [...current, service.id],
                              )
                            }
                            type="button"
                          >
                            {service.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-zinc-800">
                      Professional who created this look
                    </span>
                    <select
                      className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                      onChange={(event) => setStaffId(event.currentTarget.value)}
                      value={staffId}
                    >
                      <option value="">No professional</option>
                      {onlineStaff.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.displayName} / Online
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-xs leading-5 text-zinc-500">
                    Customers can book these services and professional directly
                    from this post.
                  </p>
                </div>
              ) : null}
            </section>
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-zinc-800">Mood</span>
              <select
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                onChange={(event) => setMood(event.currentTarget.value)}
                value={mood}
              >
                <option value="">No mood</option>
                <option value="Soft & clean">Soft & clean</option>
                <option value="Summer bright">Summer bright</option>
                <option value="Rich & modern">Rich & modern</option>
                <option value="Special moment">Special moment</option>
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-zinc-800">
                  Duration
                </span>
                <input
                  className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
                  min="0"
                  onChange={(event) => setDurationMinutes(event.currentTarget.value)}
                  placeholder="Minutes"
                  type="number"
                  value={durationMinutes}
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-zinc-800">
                  Starting price
                </span>
                <input
                  className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
                  min="0"
                  onChange={(event) => setStartingPrice(event.currentTarget.value)}
                  placeholder="0.00"
                  step="0.01"
                  type="number"
                  value={startingPrice}
                />
              </label>
            </div>
            {contentType === "opening" ? (
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-zinc-800">
                  Opening time
                </span>
                <input
                  className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
                  onChange={(event) => setStartsAt(event.currentTarget.value)}
                  type="datetime-local"
                  value={startsAt}
                />
              </label>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function Avatar({
  logoUrl,
  name,
  size = "sm",
}: {
  logoUrl: string | null;
  name: string;
  size?: "lg" | "md" | "sm";
}) {
  const sizeClass =
    size === "lg"
      ? "h-24 w-24 text-2xl sm:h-32 sm:w-32"
      : size === "md"
        ? "h-12 w-12"
        : "h-10 w-10";
  const frameClass =
    size === "lg"
      ? "rounded-2xl border-4 border-white shadow-[0_12px_35px_rgba(24,24,27,.14)]"
      : "rounded-xl border border-zinc-200 shadow-sm";

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={`${name} logo`}
        className={`${sizeClass} ${frameClass} shrink-0 bg-white object-cover`}
        src={logoUrl}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} ${frameClass} grid shrink-0 place-items-center bg-white font-semibold text-zinc-950`}
    >
      {initialsFor(name)}
    </div>
  );
}

function FeedCard({
  capabilities,
  comments,
  item,
  look,
  logoUrl,
  onBook,
  onComment,
  onRefresh,
  onSave,
  onShare,
  saved,
  saveCount,
}: {
  capabilities: SalonProfileViewerCapabilities;
  comments: PublicSalonProfileComment[];
  item: ProfileFeedItem;
  look: PublicSalonProfileLook | null;
  logoUrl: string | null;
  onBook: (context: BookingContext) => void;
  onComment: (target: CommentTarget) => void;
  onRefresh: () => void;
  onSave: (look: PublicSalonProfileLook) => void;
  onShare: (item?: ProfileFeedItem) => void;
  saved: boolean;
  saveCount: number;
}) {
  const [managing, startManageTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const targetComments = comments.filter((comment) =>
    item.contentType === "look"
      ? comment.lookId === item.id
      : comment.updateId === item.id,
  );
  const targetCommentCount = targetComments.length;
  const previewComments = targetComments.slice(-2);
  const title =
    item.contentType === "look"
      ? item.title
      : item.caption || item.title || "Salon update";

  function updateLookStatus(status?: "archived" | "draft" | "published", isPinned?: boolean) {
    if (!look) {
      return;
    }

    startManageTransition(async () => {
      const result = await setSalonProfileLookStatusDirectAction({
        isPinned,
        lookId: look.id,
        salonId: look.serviceId ? item.salonId : item.salonId,
        status,
      });

      if (!result.error) {
        onRefresh();
      }
    });
  }

  function deleteLook() {
    if (!look || !window.confirm("Delete this look?")) {
      return;
    }

    startManageTransition(async () => {
      const result = await deleteSalonProfileLookDirectAction({
        lookId: look.id,
        salonId: item.salonId,
      });

      if (!result.error) {
        onRefresh();
      }
    });
  }

  return (
    <article
      className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_18px_55px_rgba(24,24,27,.06)]"
      id={`${item.contentType}-${item.id}`}
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            logoUrl={item.authorAvatarUrl ?? logoUrl}
            name={item.authorName}
            size="sm"
          />
          <div className="min-w-0">
            <p className="truncate font-semibold text-zinc-950">
              {item.authorName}
            </p>
            <p className="text-sm text-zinc-500">{timeAgo(item.publishedAt)}</p>
          </div>
        </div>
        {capabilities.canManageContent && item.contentType === "look" ? (
          <div className="relative">
            <Button
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Post management"
              className="h-10 min-h-10 w-10 px-0"
              disabled={managing}
              onClick={() => setMenuOpen((current) => !current)}
              variant="subtle"
            >
              ...
            </Button>
            {menuOpen ? (
              <div
                className="absolute right-0 top-11 z-10 grid min-w-44 gap-1 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl"
                role="menu"
              >
                <button
                  className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                  onClick={() => {
                    setMenuOpen(false);
                    updateLookStatus(undefined, !item.isPinned);
                  }}
                  role="menuitem"
                  type="button"
                >
                  {item.isPinned ? "Unpin post" : "Pin post"}
                </button>
                <button
                  className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                  onClick={() => {
                    setMenuOpen(false);
                    updateLookStatus("archived");
                  }}
                  role="menuitem"
                  type="button"
                >
                  Archive
                </button>
                <button
                  className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50"
                  onClick={() => {
                    setMenuOpen(false);
                    deleteLook();
                  }}
                  role="menuitem"
                  type="button"
                >
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {item.caption ? (
        <p className="px-4 pb-4 text-sm leading-6 text-zinc-800">
          <CaptionWithHashtags text={item.caption} />
        </p>
      ) : null}
      {item.hashtags.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {item.hashtags.map((tag) => (
            <a
              className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200"
              href={`/explore?q=${encodeURIComponent(`#${tag}`)}`}
              key={tag}
            >
              #{tag}
            </a>
          ))}
        </div>
      ) : null}
      {item.imageUrl ? (
        <div className="bg-zinc-100">
          <LookImage
            className="aspect-[4/5] max-h-[720px] w-full"
            imageUrl={item.imageUrl}
            title={title}
          />
        </div>
      ) : null}
      <div className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
          {item.contentType === "look" && item.mood ? <span>{item.mood}</span> : null}
          {item.serviceName ? <span>{item.serviceName}</span> : null}
          {item.contentType === "look" && item.recommendedStaffName ? (
            <span>With {item.recommendedStaffName}</span>
          ) : null}
          {item.contentType === "update" && item.staffName ? (
            <span>With {item.staffName}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3 text-sm text-zinc-500">
          <span>
            {item.contentType === "look" && saveCount > 0
              ? `${saveCount} save${saveCount === 1 ? "" : "s"}`
              : null}
          </span>
          <span>
            {targetCommentCount || item.commentCount} comment
            {(targetCommentCount || item.commentCount) === 1 ? "" : "s"}
          </span>
        </div>
        {previewComments.length > 0 ? (
          <div className="grid gap-2 rounded-lg bg-zinc-50 p-3">
            {previewComments.map((comment) => (
              <p className="text-sm leading-6 text-zinc-700" key={comment.id}>
                <span className="font-semibold text-zinc-950">
                  {comment.authorDisplayName}
                </span>{" "}
                {comment.body}
              </p>
            ))}
            {targetCommentCount > previewComments.length ? (
              <button
                className="w-max text-sm font-semibold text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline"
                onClick={() =>
                  onComment({
                    lookId: item.contentType === "look" ? item.id : null,
                    title,
                    updateId: item.contentType === "update" ? item.id : null,
                  })
                }
                type="button"
              >
                View all comments
              </button>
            ) : null}
          </div>
        ) : null}
        <div
          className={[
            "grid gap-2",
            look
              ? "sm:grid-cols-[.8fr_.8fr_.8fr_1.1fr]"
              : "sm:grid-cols-[.8fr_.8fr_1.1fr]",
          ].join(" ")}
        >
          {look ? (
            <Button onClick={() => onSave(look)} variant="secondary">
              {saved ? "Saved" : "Save"}
            </Button>
          ) : null}
          <Button
            onClick={() =>
              onComment({
                lookId: item.contentType === "look" ? item.id : null,
                title,
                updateId: item.contentType === "update" ? item.id : null,
              })
            }
            variant="secondary"
          >
            Comment
          </Button>
          <Button onClick={() => onShare(item)} variant="secondary">
            Share
          </Button>
          {capabilities.canBook ? (
            <Button
              onClick={() =>
                onBook({
                  lookId: item.contentType === "look" ? item.id : null,
                  note: item.caption,
                  title:
                    item.contentType === "look"
                      ? "Book this look"
                      : "Book with this inspiration",
                  updateId: item.contentType === "update" ? item.id : null,
                })
              }
              variant="primary"
            >
              {item.contentType === "look" ? "Book look" : "Book inspiration"}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CuratedLookSection({
  canBook,
  companionLooks,
  featuredLook,
  moodOptions,
  onBook,
  onChooseLook,
  onMoodSelect,
  onNext,
  onOpen,
  onPrevious,
  onSave,
  selectedMood,
  savedLookIds,
  saveCounts,
}: {
  canBook: boolean;
  companionLooks: PublicSalonProfileLook[];
  featuredLook: PublicSalonProfileLook | null;
  moodOptions: string[];
  onBook: (context: BookingContext) => void;
  onChooseLook: (look: PublicSalonProfileLook) => void;
  onMoodSelect: (mood: string) => void;
  onNext: () => void;
  onOpen: (look: PublicSalonProfileLook) => void;
  onPrevious: () => void;
  onSave: (look: PublicSalonProfileLook) => void;
  selectedMood: string | null;
  savedLookIds: Set<string>;
  saveCounts: Map<string, number>;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);

  function scrollRail(direction: 1 | -1) {
    railRef.current?.scrollBy({
      behavior: "smooth",
      left: direction * 220,
    });
  }

  if (!featuredLook) {
    return (
      <section className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Curated for you
        </p>
        <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight text-zinc-950 sm:text-4xl">
          Your next set is one tap away.
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600">
          Choose a feeling. This salon will share real looks here as soon as they
          are published.
        </p>
      </section>
    );
  }

  const price = formatMoney(featuredLook.startingPrice);
  const duration = formatDuration(featuredLook.durationMinutes);
  const meta = joinMeta([
    featuredLook.mood,
    featuredLook.serviceName,
    duration,
    price ? `From ${price}` : null,
    featuredLook.recommendedStaffName
      ? `With ${featuredLook.recommendedStaffName}`
      : null,
  ]);

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_22px_70px_rgba(24,24,27,.07)]">
      <div className="grid lg:grid-cols-[minmax(0,1.45fr)_minmax(22rem,.85fr)]">
        <div className="relative bg-zinc-100">
          <button
            className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950"
            onClick={() => onOpen(featuredLook)}
            type="button"
          >
            <LookImage
              className="aspect-[4/5] w-full lg:min-h-[34rem]"
              imageUrl={featuredLook.imageUrl}
              title={featuredLook.title}
            />
          </button>
          <Button
            aria-label={
              savedLookIds.has(featuredLook.id) ? "Remove saved look" : "Save look"
            }
            className="absolute right-4 top-4 min-h-10 rounded-full bg-white/95 px-4 shadow-sm"
            onClick={() => onSave(featuredLook)}
            variant="secondary"
          >
            {savedLookIds.has(featuredLook.id) ? "Saved" : "Save"}
          </Button>
        </div>
        <div className="flex flex-col justify-between gap-8 p-6 sm:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Curated for you
            </p>
            <h2 className="mt-3 font-serif text-4xl font-semibold leading-tight text-zinc-950 sm:text-5xl">
              Your next set is one tap away.
            </h2>
            <p className="mt-4 text-sm leading-6 text-zinc-600">
              Choose a feeling. We will show you a real look from this salon.
            </p>
            <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
              {moodOptions.map((mood) => (
                <button
                  aria-pressed={selectedMood === mood}
                  className={[
                    "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
                    selectedMood === mood
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
                  ].join(" ")}
                  key={mood}
                  onClick={() => onMoodSelect(mood)}
                  type="button"
                >
                  {mood}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-5">
            {featuredLook.badge ? (
              <span className="w-max rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600">
                {featuredLook.badge}
              </span>
            ) : null}
            <button
              className="text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-950"
              onClick={() => onOpen(featuredLook)}
              type="button"
            >
              <h3 className="font-serif text-3xl font-semibold leading-tight text-zinc-950">
                {featuredLook.title}
              </h3>
              {featuredLook.caption ?? featuredLook.emotionalDescription ? (
                <p className="mt-3 text-sm leading-6 text-zinc-700">
                  {featuredLook.caption ?? featuredLook.emotionalDescription}
                </p>
              ) : null}
            </button>
            {meta ? <p className="text-sm text-zinc-500">{meta}</p> : null}
            {(saveCounts.get(featuredLook.id) ?? 0) > 0 ? (
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
                {saveCounts.get(featuredLook.id)} save
                {saveCounts.get(featuredLook.id) === 1 ? "" : "s"}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[.8fr_1.2fr]">
              <Button onClick={() => onSave(featuredLook)} variant="secondary">
                {savedLookIds.has(featuredLook.id) ? "Saved" : "Save"}
              </Button>
              <Button
                disabled={!canBook}
                onClick={() =>
                  onBook({
                    lookId: featuredLook.id,
                    note: featuredLook.bookingNote,
                    serviceId: featuredLook.serviceId,
                    staffId: featuredLook.recommendedStaffId,
                    title: "Book this exact look",
                  })
                }
                variant="primary"
              >
                Book this look
              </Button>
            </div>
          </div>

          {companionLooks.length > 0 ? (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  More to explore
                </p>
                <div className="flex gap-2">
                  <Button
                    aria-label="Previous featured look"
                    className="h-9 min-h-9 w-9 rounded-full px-0"
                    onClick={onPrevious}
                    variant="secondary"
                  >
                    &lt;
                  </Button>
                  <Button
                    aria-label="Next featured look"
                    className="h-9 min-h-9 w-9 rounded-full px-0"
                    onClick={onNext}
                    variant="secondary"
                  >
                    &gt;
                  </Button>
                </div>
              </div>
              <div
                className="-mx-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-2 pb-1"
                ref={railRef}
              >
                {companionLooks.map((look) => (
                  <button
                    className="grid w-32 shrink-0 snap-start gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                    key={look.id}
                    onClick={() => {
                      onChooseLook(look);
                      window.setTimeout(() => scrollRail(1), 0);
                    }}
                    type="button"
                  >
                    <LookImage
                      className="aspect-[4/5] w-full rounded-xl"
                      imageUrl={look.imageUrl}
                      title={look.title}
                    />
                    <span className="line-clamp-2 text-xs font-semibold leading-4 text-zinc-700">
                      {look.title}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function beautyBookedCountLabel(count: number) {
  return `${count} booked`;
}

function BeautyTransformationsSection({
  posts,
}: {
  posts: PublicSalonProfileBeautyPost[];
}) {
  if (posts.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Client transformations
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-zinc-950">
          Shared by customers
        </h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {posts.map((post) => {
          const before =
            post.media.find((item) => item.role === "before") ?? post.media[0];
          const after =
            post.media.find((item) => item.role === "after") ??
            post.media.find((item) => item.id !== before?.id) ??
            post.media[1] ??
            before;
          const meta = joinMeta([
            post.staffName ? `With ${post.staffName}` : null,
            post.verificationState === "verified" ? "Verified visit" : null,
            timeAgo(post.publishedAt),
          ]);
          const booking = post.booking?.eligible ? post.booking : null;
          const bookingHref = booking?.href ?? null;
          const bookedCount = booking?.bookedCount ?? null;

          return (
            <article
              className="group overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_18px_55px_rgba(24,24,27,.06)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_70px_rgba(24,24,27,.08)]"
              key={post.id}
            >
              <BeforeAfterCompare
                after={
                  after?.url
                    ? {
                        alt: `After image from ${post.authorDisplayName}`,
                        id: after.id,
                        url: after.url,
                      }
                    : null
                }
                aspectClassName="aspect-[4/5]"
                before={
                  before?.url
                    ? {
                        alt: `Before image from ${post.authorDisplayName}`,
                        id: before.id,
                        url: before.url,
                      }
                    : null
                }
                roundedClassName="rounded-none"
                sizes="(max-width: 640px) 100vw, 50vw"
              />
              <div className="grid gap-2 p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-950 text-xs font-semibold text-white">
                    {post.authorAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={`${post.authorDisplayName} profile`}
                        className="h-full w-full object-cover"
                        src={post.authorAvatarUrl}
                      />
                    ) : (
                      initialsFor(post.authorDisplayName)
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-950">
                      {post.authorDisplayName}
                    </p>
                    {meta ? (
                      <p className="truncate text-xs font-medium text-zinc-500">
                        {meta}
                      </p>
                    ) : null}
                  </div>
                </div>
                {post.caption ? (
                  <p className="line-clamp-2 text-sm leading-5 text-zinc-700">
                    {post.caption}
                  </p>
                ) : null}
                <div className="grid gap-2 pt-1">
                  {bookedCount !== null ? (
                    <p className="text-xs font-semibold text-zinc-500">
                      {beautyBookedCountLabel(bookedCount)}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {bookingHref ? (
                      <a
                        aria-label={[
                          booking?.label ?? "Book",
                          bookedCount !== null
                            ? beautyBookedCountLabel(bookedCount)
                            : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                        className="inline-flex min-h-10 flex-1 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:flex-none"
                        href={bookingHref}
                      >
                        <span className="truncate">{booking?.label ?? "Book"}</span>
                      </a>
                    ) : null}
                    <a
                      className="inline-flex min-h-10 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                      href={post.postHref}
                    >
                      View post
                    </a>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CommentsPanel({
  capabilities,
  comments,
  onPosted,
  salonId,
  target,
}: {
  capabilities: SalonProfileViewerCapabilities;
  comments: PublicSalonProfileComment[];
  onPosted: () => void;
  salonId: string;
  target: CommentTarget;
}) {
  const [body, setBody] = useState("");
  const [asSalon, setAsSalon] = useState(false);
  const [replyTo, setReplyTo] = useState<PublicSalonProfileComment | null>(null);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const thread = comments.filter((comment) =>
    target.lookId ? comment.lookId === target.lookId : comment.updateId === target.updateId,
  );
  const topLevel = thread.filter((comment) => !comment.parentCommentId);

  function submit() {
    if (!capabilities.isAuthenticated) {
      setStatus("Sign in to comment.");
      return;
    }

    if (!body.trim()) {
      setStatus("Write a comment first.");
      return;
    }

    startTransition(async () => {
      const result = await createSalonProfileCommentAction({
        asSalonReply: asSalon && capabilities.canReplyAsSalon,
        body,
        lookId: target.lookId ?? null,
        parentCommentId: replyTo?.id ?? null,
        salonId,
        updateId: target.updateId ?? null,
      });

      if (result.error) {
        setStatus(result.error);
        return;
      }

      setBody("");
      setReplyTo(null);
      setStatus("Comment posted.");
      onPosted();
    });
  }

  function moderate(commentId: string, nextStatus: "deleted" | "hidden") {
    startTransition(async () => {
      const result = await setSalonProfileCommentStatusAction({
        commentId,
        salonId,
        status: nextStatus,
      });

      if (result.error) {
        setStatus(result.error);
        return;
      }

      onPosted();
    });
  }

  return (
    <section className="grid gap-4">
      <div>
        <h3 className="text-base font-semibold text-zinc-950">Comments</h3>
        <p className="text-sm text-zinc-500">{target.title}</p>
      </div>
      <div className="grid gap-3">
        {topLevel.length === 0 ? (
          <p className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600">
            No comments yet.
          </p>
        ) : (
          topLevel.map((comment) => (
          <CommentItem
            canModerate={capabilities.canModerateComments}
            canReply={capabilities.canReplyAsSalon}
            comment={comment}
            key={comment.id}
            onModerate={moderate}
            onReply={(nextComment) => {
              setReplyTo(nextComment);
              setAsSalon(true);
            }}
            replies={thread.filter(
              (reply) => reply.parentCommentId === comment.id,
              )}
            />
          ))
        )}
      </div>
      <div className="grid gap-2">
        {replyTo ? (
          <div className="flex items-center justify-between gap-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <span>Replying to {replyTo.authorDisplayName}</span>
            <button
              className="font-semibold underline-offset-4 hover:underline"
              onClick={() => setReplyTo(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        ) : null}
        <textarea
          className="min-h-24 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none transition focus:border-zinc-950"
          maxLength={1000}
          onChange={(event) => setBody(event.currentTarget.value)}
          placeholder={
            capabilities.isAuthenticated
              ? "Write a public comment..."
              : "Sign in to comment."
          }
          value={body}
        />
        {capabilities.canReplyAsSalon ? (
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              checked={asSalon}
              className="size-4"
              onChange={(event) => setAsSalon(event.currentTarget.checked)}
              type="checkbox"
            />
            Reply as salon
          </label>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <p aria-live="polite" className="text-sm text-zinc-600">
            {status}
          </p>
          <Button disabled={isPending} onClick={() => submit()} variant="primary">
            {isPending ? "Posting..." : replyTo ? "Post reply" : "Post comment"}
          </Button>
        </div>
      </div>
    </section>
  );
}

function CommentItem({
  canModerate,
  canReply,
  comment,
  onModerate,
  onReply,
  replies,
}: {
  canModerate: boolean;
  canReply: boolean;
  comment: PublicSalonProfileComment;
  onModerate: (commentId: string, status: "deleted" | "hidden") => void;
  onReply: (comment: PublicSalonProfileComment) => void;
  replies: PublicSalonProfileComment[];
}) {
  return (
    <div className="grid gap-2">
      <div className="rounded-lg bg-zinc-50 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-950">
              {comment.authorDisplayName}
              {comment.isSalonReply ? (
                <span className="ml-2 rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
                  Salon
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-sm leading-6 text-zinc-700">{comment.body}</p>
          </div>
          <div className="flex gap-1">
            {canReply ? (
              <Button
                className="min-h-8 px-2 text-xs"
                onClick={() => onReply(comment)}
                variant="subtle"
              >
                Reply
              </Button>
            ) : null}
            {canModerate ? (
              <Button
                className="min-h-8 px-2 text-xs text-red-700"
                onClick={() => onModerate(comment.id, "hidden")}
                variant="subtle"
              >
                Hide
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {replies.length > 0 ? (
        <div className="ml-5 grid gap-2 border-l border-zinc-200 pl-3">
          {replies.map((reply) => (
            <CommentItem
              canModerate={canModerate}
              canReply={false}
              comment={reply}
              key={reply.id}
              onModerate={onModerate}
              onReply={onReply}
              replies={[]}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReviewRatingInput({
  onChange,
  value,
}: {
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Review rating">
      {[1, 2, 3, 4, 5].map((rating) => (
        <button
          aria-pressed={value === rating}
          className={[
            "h-10 min-w-10 rounded-full border px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
            value === rating
              ? "border-zinc-950 bg-zinc-950 text-white"
              : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
          ].join(" ")}
          key={rating}
          onClick={() => onChange(rating)}
          type="button"
        >
          {rating}
        </button>
      ))}
    </div>
  );
}

function ReviewSummaryPanel({
  summary,
}: {
  summary: PublicSalonProfileData["reviewSummary"];
}) {
  const maxCount = Math.max(...Object.values(summary.ratingCounts), 1);
  const average = summary.averageRating?.toFixed(1) ?? "New";

  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
        Customer reviews
      </p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-4xl font-semibold text-zinc-950">{average}</p>
          <p className="mt-1 text-sm text-zinc-500">
            {summary.reviewCount} review{summary.reviewCount === 1 ? "" : "s"}
            {summary.verifiedCount > 0
              ? ` / ${summary.verifiedCount} verified`
              : ""}
          </p>
        </div>
        <div className="grid min-w-52 flex-1 gap-2 sm:max-w-sm">
          {[5, 4, 3, 2, 1].map((rating) => {
            const count = summary.ratingCounts[rating as 1 | 2 | 3 | 4 | 5];

            return (
              <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-2" key={rating}>
                <span className="text-xs font-semibold text-zinc-500">
                  {rating}
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-zinc-950"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="text-right text-xs text-zinc-500">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ReviewComposer({
  disabledReason,
  onPosted,
  salonId,
}: {
  disabledReason: string | null;
  onPosted: () => void;
  salonId: string;
}) {
  const [body, setBody] = useState("");
  const [rating, setRating] = useState(5);
  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabledReason) {
      setStatus(disabledReason);
      return;
    }

    if (!body.trim()) {
      setStatus("Write your review before posting.");
      return;
    }

    startTransition(async () => {
      const result = await createSalonProfileReviewAction({
        body,
        rating,
        salonId,
        title: title || null,
      });

      if (result.error) {
        setStatus(result.error);
        return;
      }

      setBody("");
      setTitle("");
      setRating(5);
      setStatus("Review posted.");
      onPosted();
    });
  }

  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
      <h3 className="font-semibold text-zinc-950">Share your experience</h3>
      {disabledReason ? (
        <p className="mt-2 text-sm leading-6 text-zinc-600">{disabledReason}</p>
      ) : (
        <form className="mt-4 grid gap-3" onSubmit={submit}>
          <ReviewRatingInput onChange={setRating} value={rating} />
          <input
            className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-950"
            maxLength={120}
            onChange={(event) => setTitle(event.currentTarget.value)}
            placeholder="Optional title"
            value={title}
          />
          <textarea
            className="min-h-28 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none transition focus:border-zinc-950"
            maxLength={2000}
            onChange={(event) => setBody(event.currentTarget.value)}
            placeholder="What should future customers know?"
            value={body}
          />
          <div className="flex items-center justify-between gap-3">
            <p aria-live="polite" className="text-sm text-zinc-600">
              {status}
            </p>
            <Button disabled={isPending} type="submit" variant="primary">
              {isPending ? "Posting..." : "Post review"}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function ReviewReplyForm({
  onPosted,
  review,
}: {
  onPosted: () => void;
  review: PublicSalonProfileReview;
}) {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!body.trim()) {
      setStatus("Write a reply before posting.");
      return;
    }

    startTransition(async () => {
      const result = await createSalonProfileReviewReplyAction({
        body,
        reviewId: review.id,
        salonId: review.salonId,
      });

      if (result.error) {
        setStatus(result.error);
        return;
      }

      setBody("");
      setStatus("Reply posted.");
      onPosted();
    });
  }

  return (
    <form className="mt-4 grid gap-2 border-t border-zinc-100 pt-4" onSubmit={submit}>
      <textarea
        className="min-h-20 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none transition focus:border-zinc-950"
        maxLength={1000}
        onChange={(event) => setBody(event.currentTarget.value)}
        placeholder="Reply as the salon"
        value={body}
      />
      <div className="flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm text-zinc-600">
          {status}
        </p>
        <Button disabled={isPending} type="submit" variant="secondary">
          {isPending ? "Replying..." : "Reply"}
        </Button>
      </div>
    </form>
  );
}

function ReviewCard({
  canReplyAsSalon,
  onPosted,
  review,
}: {
  canReplyAsSalon: boolean;
  onPosted: () => void;
  review: PublicSalonProfileReview;
}) {
  return (
    <article className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_14px_42px_rgba(24,24,27,.05)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-zinc-950">{review.authorDisplayName}</p>
          <p className="mt-1 text-sm text-zinc-500">
            {review.rating}/5 / {timeAgo(review.createdAt)}
          </p>
        </div>
        <span
          className={[
            "rounded-full px-3 py-1 text-xs font-semibold",
            review.verificationStatus === "verified"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-zinc-100 text-zinc-600",
          ].join(" ")}
        >
          {review.verificationStatus === "verified" ? "Verified visit" : "Customer review"}
        </span>
      </div>
      {review.title ? (
        <h3 className="mt-4 font-semibold text-zinc-950">{review.title}</h3>
      ) : null}
      <p className="mt-3 text-sm leading-6 text-zinc-700">{review.body}</p>
      {review.replyBody ? (
        <div className="mt-4 rounded-xl bg-zinc-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Salon reply
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            {review.replyBody}
          </p>
        </div>
      ) : canReplyAsSalon ? (
        <ReviewReplyForm onPosted={onPosted} review={review} />
      ) : null}
    </article>
  );
}

function LookDetailDialog({
  capabilities,
  comments,
  isSaved,
  look,
  onBook,
  onClose,
  onCommentPosted,
  onSave,
  onShare,
  saveCount,
  salonId,
}: {
  capabilities: SalonProfileViewerCapabilities;
  comments: PublicSalonProfileComment[];
  isSaved: boolean;
  look: PublicSalonProfileLook;
  onBook: (context: BookingContext) => void;
  onClose: () => void;
  onCommentPosted: () => void;
  onSave: (look: PublicSalonProfileLook) => void;
  onShare: () => void;
  saveCount: number;
  salonId: string;
}) {
  const titleId = useId();

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-50 grid bg-zinc-950/45 p-0 backdrop-blur-sm sm:p-6"
      role="dialog"
    >
      <div className="mt-auto grid max-h-[94vh] overflow-auto rounded-t-xl bg-white shadow-2xl sm:m-auto sm:max-h-[88vh] sm:w-full sm:max-w-5xl sm:rounded-xl">
        <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,.8fr)]">
          <LookImage
            className="aspect-[4/3] w-full lg:h-full lg:min-h-[34rem]"
            imageUrl={look.imageUrl}
            title={look.title}
          />
          <div className="grid content-start gap-5 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                {look.mood ? (
                  <p className="text-xs font-semibold uppercase text-emerald-700">
                    {look.mood}
                  </p>
                ) : null}
                <h2
                  className="mt-2 text-3xl font-semibold text-zinc-950"
                  id={titleId}
                >
                  {look.title}
                </h2>
                {look.caption ? (
                  <p className="mt-3 text-sm leading-6 text-zinc-700">
                    <CaptionWithHashtags text={look.caption} />
                  </p>
                ) : null}
                {look.hashtags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {look.hashtags.map((tag) => (
                      <a
                        className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200"
                        href={`/explore?q=${encodeURIComponent(`#${tag}`)}`}
                        key={tag}
                      >
                        #{tag}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
              <Button onClick={onClose} variant="secondary">
                Close
              </Button>
            </div>
            <div className="grid gap-3 rounded-lg bg-zinc-50 p-4">
              <p className="text-sm text-zinc-600">
                {[
                  look.serviceName,
                  formatDuration(look.durationMinutes),
                  formatMoney(look.startingPrice),
                  look.recommendedStaffName
                    ? `With ${look.recommendedStaffName}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" / ")}
              </p>
              {saveCount > 0 ? (
                <p className="text-sm text-zinc-500">
                  {saveCount} save{saveCount === 1 ? "" : "s"}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Button onClick={() => onSave(look)} variant="secondary">
                {isSaved ? "Saved" : "Save"}
              </Button>
              <Button onClick={onShare} variant="secondary">
                Share
              </Button>
              <Button
                disabled={!capabilities.canBook}
                onClick={() =>
                  onBook({
                    lookId: look.id,
                    note: look.caption ?? look.bookingNote,
                    serviceId: look.serviceId,
                    staffId: look.recommendedStaffId,
                    title: "Book this exact look",
                  })
                }
                variant="primary"
              >
                Book exact look
              </Button>
            </div>
            <CommentsPanel
              capabilities={capabilities}
              comments={comments}
              onPosted={onCommentPosted}
              salonId={salonId}
              target={{
                lookId: look.id,
                title: look.title,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ServiceRow({
  canBook,
  onBook,
  service,
}: {
  canBook: boolean;
  onBook: (context: BookingContext) => void;
  service: PublicSalonProfileService;
}) {
  const price = formatMoney(service.basePrice);
  const duration = formatDuration(service.durationMinutes);

  return (
    <div className="grid gap-4 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_14px_42px_rgba(24,24,27,.05)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        <h3 className="font-semibold text-zinc-950">{service.name}</h3>
        {service.description ? (
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            {service.description}
          </p>
        ) : null}
        <p className="mt-2 text-sm text-zinc-500">
          {[duration, price ? `From ${price}` : null].filter(Boolean).join(" / ")}
        </p>
      </div>
      <Button
        disabled={!canBook}
        onClick={() =>
          onBook({
            serviceId: service.id,
            title: `Book ${service.name}`,
          })
        }
        variant="primary"
      >
        Book
      </Button>
    </div>
  );
}

function TeamCard({
  canBook,
  member,
  onBook,
  onOpen,
}: {
  canBook: boolean;
  member: PublicSalonProfileStaff;
  onBook: (context: BookingContext) => void;
  onOpen: (member: PublicSalonProfileStaff) => void;
}) {
  return (
    <div className="grid gap-4 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_14px_42px_rgba(24,24,27,.05)]">
      <button
        className="w-fit rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
        onClick={() => onOpen(member)}
        type="button"
      >
        <Avatar logoUrl={member.avatarUrl} name={member.displayName} size="md" />
      </button>
      <div>
        <h3 className="font-semibold text-zinc-950">{member.displayName}</h3>
        {member.jobTitle ? (
          <p className="mt-1 text-sm text-zinc-600">{member.jobTitle}</p>
        ) : null}
        {member.specialties.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {member.specialties.slice(0, 4).map((specialty) => (
              <span
                className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-600"
                key={specialty}
              >
                {specialty}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <Button onClick={() => onOpen(member)} variant="secondary">
        View profile
      </Button>
      <Button
        disabled={!canBook || !member.onlineBookingEnabled}
        onClick={() =>
          onBook({
            staffId: member.id,
            title: `Book with ${member.displayName}`,
          })
        }
        variant="secondary"
      >
        Book with {member.displayName}
      </Button>
    </div>
  );
}

function StaffDetailDialog({
  canBook,
  looks,
  member,
  onBook,
  onClose,
  onOpenLook,
}: {
  canBook: boolean;
  looks: PublicSalonProfileLook[];
  member: PublicSalonProfileStaff;
  onBook: (context: BookingContext) => void;
  onClose: () => void;
  onOpenLook: (look: PublicSalonProfileLook) => void;
}) {
  const portfolio = looks
    .filter((look) => look.authorStaffId === member.id)
    .slice(0, 6);

  return (
    <Modal onClose={onClose} panelClassName="sm:max-w-3xl" title={member.displayName}>
      <div className="grid gap-6">
        <div className="flex items-start gap-4">
          <Avatar logoUrl={member.avatarUrl} name={member.displayName} size="lg" />
          <div className="min-w-0">
            <h3 className="text-2xl font-semibold text-zinc-950">
              {member.displayName}
            </h3>
            {member.jobTitle ? (
              <p className="mt-1 text-sm text-zinc-600">{member.jobTitle}</p>
            ) : null}
            {member.bio ? (
              <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-700">
                {member.bio}
              </p>
            ) : null}
            {member.specialties.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {member.specialties.map((specialty) => (
                  <span
                    className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700"
                    key={specialty}
                  >
                    {specialty}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!canBook || !member.onlineBookingEnabled}
            onClick={() =>
              onBook({
                staffId: member.id,
                title: `Book with ${member.displayName}`,
              })
            }
            variant="primary"
          >
            Book with {member.displayName}
          </Button>
        </div>
        <section>
          <h4 className="font-semibold text-zinc-950">Portfolio</h4>
          {portfolio.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {portfolio.map((look) => (
                <button
                  className="overflow-hidden rounded-xl border border-zinc-200 text-left transition hover:border-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                  key={look.id}
                  onClick={() => onOpenLook(look)}
                  type="button"
                >
                  <LookImage
                    className="aspect-[4/5] w-full"
                    imageUrl={look.imageUrl}
                    title={look.title}
                  />
                  <p className="truncate px-3 py-2 text-sm font-semibold text-zinc-950">
                    {look.title}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
              Portfolio looks will appear when this artist posts published work.
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}

function PublicationDrawer({
  onClose,
  publicHref,
  readiness,
  setting,
}: {
  onClose: () => void;
  publicHref: string;
  readiness: SalonProfileReadiness;
  setting: SalonProfileSetting;
}) {
  const nextEnabled = !setting.public_discovery_enabled;

  return (
    <Modal onClose={onClose} title="Publication settings">
      <div className="grid gap-5">
        <div>
          <p className="text-sm text-zinc-600">
            {readiness.completionPercent}% complete
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${readiness.completionPercent}%` }}
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {readiness.items.map((item) => (
            <div
              className="rounded-lg border border-zinc-200 bg-white p-3"
              key={item.id}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-950">{item.label}</p>
                <span
                  className={[
                    "rounded-md px-2 py-1 text-xs font-semibold",
                    item.complete
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-amber-50 text-amber-800",
                  ].join(" ")}
                >
                  {item.complete ? "Done" : "Missing"}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {item.required ? "Required" : "Optional"}
              </p>
            </div>
          ))}
        </div>
        <a
          className="inline-flex min-h-10 w-max items-center rounded-md border border-zinc-300 px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50"
          href={publicHref}
        >
          View public route
        </a>
        <form action={setSalonProfilePublicationAction} className="border-t border-zinc-200 pt-4">
          <input name="salon_id" type="hidden" value={setting.salon_id} />
          <input
            name="public_discovery_enabled"
            type="hidden"
            value={nextEnabled ? "true" : "false"}
          />
          <Button
            disabled={nextEnabled && !readiness.canPublish}
            type="submit"
            variant={nextEnabled ? "primary" : "secondary"}
          >
            {nextEnabled ? "Publish profile" : "Unpublish profile"}
          </Button>
          {nextEnabled && !readiness.canPublish ? (
            <p className="mt-2 text-sm text-zinc-500">
              Complete the required items before publishing.
            </p>
          ) : null}
        </form>
      </div>
    </Modal>
  );
}

export function SalonProfileView({
  capabilities = EMPTY_CAPABILITIES,
  data,
  error,
  manageData,
  notice,
}: SalonProfileViewProps) {
  const router = useRouter();
  const { profile } = data;
  const sortedLooks = useMemo(
    () =>
      [...data.looks].sort((left, right) => {
        if (left.isPinned !== right.isPinned) {
          return left.isPinned ? -1 : 1;
        }

        return (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "");
      }),
    [data.looks],
  );
  const lookById = useMemo(
    () => new Map(sortedLooks.map((look) => [look.id, look])),
    [sortedLooks],
  );
  const [selectedTab, setSelectedTab] = useState<TabId>("discover");
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [featuredLookId, setFeaturedLookId] = useState<string | null>(null);
  const [detailLook, setDetailLook] = useState<PublicSalonProfileLook | null>(
    null,
  );
  const [detailStaff, setDetailStaff] =
    useState<PublicSalonProfileStaff | null>(null);
  const [composerType, setComposerType] = useState<ComposerType | null>(null);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [publicationOpen, setPublicationOpen] = useState(false);
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  const ownerMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const ownerMenuRef = useRef<HTMLDivElement | null>(null);
  const [reviewFilter, setReviewFilter] = useState<"all" | "verified">("all");
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null);
  const comments = data.comments;
  const [savedLookIds, setSavedLookIds] = useState(
    new Set(sortedLooks.filter((look) => look.isSaved).map((look) => look.id)),
  );
  const [saveCounts, setSaveCounts] = useState(
    new Map(sortedLooks.map((look) => [look.id, look.saveCount])),
  );

  useEffect(() => {
    let cancelled = false;

    function syncTabFromHash() {
      const nextTab = tabFromHash(window.location.hash);

      if (!nextTab) {
        return;
      }

      window.setTimeout(() => {
        if (!cancelled) {
          setSelectedTab(nextTab);
        }
      }, 0);
    }

    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);

    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", syncTabFromHash);
    };
  }, []);
  const [isFollowing, setFollowing] = useState(profile.isFollowing);
  const [followerCount, setFollowerCount] = useState(profile.followerCount);
  const [statusMessage, setStatusMessage] = useState("");
  const [surpriseIndex, setSurpriseIndex] = useState(0);
  const [isPending, startTransition] = useTransition();
  function bookingHref(context: BookingContext) {
    const params = new URLSearchParams({ source: "public_profile" });

    const inspirationId = context?.lookId ?? context?.updateId ?? null;

    if (inspirationId) {
      params.set("inspiration", inspirationId);
      return `/book/${profile.salonId}?${params.toString()}`;
    }

    if (context?.serviceId) {
      params.set("serviceId", context.serviceId);
    }

    if (context?.staffId) {
      params.set("staffId", context.staffId);
    }

    return `/book/${profile.salonId}?${params.toString()}`;
  }

  function openBooking(context: BookingContext = { title: "Book now" }) {
    router.push(bookingHref(context));
  }

  const isManagedViewer =
    Boolean(manageData) ||
    capabilities.isOwnSalon ||
    capabilities.canCreateContent ||
    capabilities.canEditProfile ||
    capabilities.canManageContent;
  const moodOptions = useMemo(() => {
    const moods = Array.from(
      new Set(
        sortedLooks
          .map((look) => look.mood?.trim())
          .filter((mood): mood is string => Boolean(mood)),
      ),
    );

    return moods.length > 0 ? [...moods, "Surprise me"] : ["Surprise me"];
  }, [sortedLooks]);
  const matchingLooks = selectedMood
    ? sortedLooks.filter((look) => look.mood === selectedMood)
    : sortedLooks;
  const featuredLook =
    (featuredLookId
      ? matchingLooks.find((look) => look.id === featuredLookId) ??
        sortedLooks.find((look) => look.id === featuredLookId)
      : null) ??
    matchingLooks[0] ??
    sortedLooks[0] ??
    null;
  const companionLooks = sortedLooks
    .filter((look) => look.id !== featuredLook?.id)
    .slice(0, 5);
  const featuredLookIds = new Set(featuredLook ? [featuredLook.id] : []);
  const primaryMobileLook = matchingLooks[0] ?? sortedLooks[0] ?? null;
  const feedItems = data.feed.length
    ? data.feed
    : sortedLooks.map((look): ProfileFeedItem => ({
        authorAvatarUrl: look.authorAvatarUrl,
        authorName: look.authorDisplayName || profile.name,
        authorStaffId: look.authorStaffId,
        bookingLookId: look.id,
        caption: look.caption ?? look.emotionalDescription,
        commentCount: look.commentCount,
        contentType: "look",
        durationMinutes: look.durationMinutes,
        id: look.id,
        imageUrl: look.imageUrl,
        isPinned: look.isPinned,
        isSaved: look.isSaved,
        mood: look.mood,
        publishedAt: look.publishedAt,
        recommendedStaffId: look.recommendedStaffId,
        recommendedStaffName: look.recommendedStaffName,
        salonId: profile.salonId,
        saveCount: look.saveCount,
        serviceId: look.serviceId,
        serviceName: look.serviceName,
        startingPrice: look.startingPrice,
        hashtags: look.hashtags,
        title: look.title,
      }));
  const visibleFeed = feedItems
    .filter(
      (item) =>
        item.contentType !== "look" || !featuredLookIds.has(item.id),
    )
    .slice(0, 24);
  const address = formatAddress(profile);

  useEffect(() => {
    if (!ownerMenuOpen) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (
        ownerMenuRef.current?.contains(target) ||
        ownerMenuButtonRef.current?.contains(target)
      ) {
        return;
      }

      setOwnerMenuOpen(false);
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setOwnerMenuOpen(false);
      ownerMenuButtonRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ownerMenuOpen]);

  function refresh() {
    router.refresh();
  }

  function selectMood(mood: string) {
    if (mood === "Surprise me") {
      const pool = sortedLooks.filter((look) => look.id !== featuredLook?.id);
      const source = pool.length > 0 ? pool : sortedLooks;
      const nextLook = source[surpriseIndex % Math.max(1, source.length)];
      setSelectedMood(null);
      setFeaturedLookId(nextLook?.id ?? null);
      setSurpriseIndex((current) => current + 1);
      return;
    }

    setSelectedMood(mood);
    setFeaturedLookId(null);
  }

  function shiftFeatured(direction: 1 | -1) {
    const source = matchingLooks.length > 0 ? matchingLooks : sortedLooks;

    if (source.length < 2) {
      return;
    }

    const currentIndex = Math.max(
      0,
      source.findIndex((look) => look.id === featuredLook?.id),
    );
    const nextIndex = (currentIndex + direction + source.length) % source.length;
    setFeaturedLookId(source[nextIndex].id);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }

    event.preventDefault();
    const currentIndex = TABS.findIndex((tab) => tab.id === selectedTab);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + TABS.length) % TABS.length;
    setSelectedTab(TABS[nextIndex].id);
  }

  function toggleSave(look: PublicSalonProfileLook) {
    startTransition(async () => {
      const result = await toggleSalonLookSaveAction(look.id, profile.salonId);

      if (result.error) {
        setStatusMessage(result.error);
        return;
      }

      setSavedLookIds((current) => {
        const next = new Set(current);

        if (result.active) {
          next.add(look.id);
        } else {
          next.delete(look.id);
        }

        return next;
      });
      setSaveCounts((current) => {
        const next = new Map(current);
        const currentCount = next.get(look.id) ?? 0;
        next.set(look.id, Math.max(0, currentCount + (result.active ? 1 : -1)));
        return next;
      });
      setStatusMessage(result.active ? "Look saved." : "Look removed.");
    });
  }

  function toggleFollow() {
    startTransition(async () => {
      const result = await toggleSalonFollowAction(profile.salonId);

      if (result.error) {
        setStatusMessage(result.error);
        return;
      }

      setFollowing(result.active);
      setFollowerCount((current) =>
        Math.max(0, current + (result.active ? 1 : -1)),
      );
      setStatusMessage(result.active ? "Salon followed." : "Salon unfollowed.");
    });
  }

  async function shareSalon(item?: ProfileFeedItem) {
    const shareUrl = item
      ? `${window.location.origin}/explore/salons/${profile.salonId}#${item.contentType}-${item.id}`
      : window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({
          title: item?.title ?? profile.name,
          text: item?.caption ?? profile.tagline ?? profile.description ?? profile.name,
          url: shareUrl,
        });
        setStatusMessage("Shared.");
        return;
      } catch {
        return;
      }
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareUrl);
      setStatusMessage("Link copied.");
      return;
    }

    setStatusMessage("Copy the profile link from your browser.");
  }

  function renderDiscover() {
    const website = normalizeWebsite(profile.website);
    const phone = formatPhone(profile.phone);
    const hasDetails = Boolean(address || phone || website);

    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-6">
          {capabilities.canCreateContent ? (
            <ComposerCard
              logoUrl={profile.logoImageUrl}
              name={profile.name}
              onOpen={setComposerType}
            />
          ) : manageData && !capabilities.canEditProfile ? (
            <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 text-sm text-zinc-600 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
              Posting is disabled for your staff profile.
            </section>
          ) : null}
          <CuratedLookSection
            companionLooks={companionLooks}
            featuredLook={featuredLook}
            moodOptions={moodOptions}
            canBook={capabilities.canBook}
            onBook={openBooking}
            onChooseLook={(look) => {
              setSelectedMood(look.mood ?? null);
              setFeaturedLookId(look.id);
            }}
            onMoodSelect={selectMood}
            onNext={() => shiftFeatured(1)}
            onOpen={setDetailLook}
            onPrevious={() => shiftFeatured(-1)}
            onSave={toggleSave}
            saveCounts={saveCounts}
            savedLookIds={savedLookIds}
            selectedMood={selectedMood}
          />
          {!featuredLook && capabilities.canCreateContent ? (
            <EmptyState title="Share your first look">
              Drop a real photo and caption to start the salon story.
            </EmptyState>
          ) : null}
          <BeautyTransformationsSection posts={data.beautyPosts} />
          <section className="grid gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                Latest
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-zinc-950">
                Recent posts
              </h2>
            </div>
            {visibleFeed.length === 0 ? (
              <EmptyState title="No recent posts">
                Published looks and salon updates will appear here after the
                featured look.
              </EmptyState>
            ) : (
              visibleFeed.map((item) => {
                const look =
                  item.contentType === "look" ? lookById.get(item.id) ?? null : null;

                return (
                  <FeedCard
                    capabilities={capabilities}
                    comments={comments}
                    item={item}
                    key={`${item.contentType}-${item.id}`}
                    look={look}
                    logoUrl={profile.logoImageUrl}
                    onBook={openBooking}
                    onComment={setCommentTarget}
                    onRefresh={refresh}
                    onSave={toggleSave}
                    onShare={shareSalon}
                    saved={look ? savedLookIds.has(look.id) : false}
                    saveCount={look ? saveCounts.get(look.id) ?? 0 : 0}
                  />
                );
              })
            )}
          </section>
        </div>
        <aside className="grid h-max gap-4 lg:sticky lg:top-20">
          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Book online
            </p>
            <h2 className="mt-3 text-2xl font-semibold leading-tight text-zinc-950">
              Ready for your next set?
            </h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              Send a request with the exact look, service, artist, and time you
              prefer.
            </p>
            <Button
              className="mt-5 w-full"
              disabled={!capabilities.canBook}
              onClick={() => openBooking({ title: "Find an appointment" })}
              variant="primary"
            >
              Find an appointment
            </Button>
            {featuredLook ? (
              <Button
                className="mt-2 w-full"
                disabled={!capabilities.canBook}
                onClick={() =>
                  openBooking({
                    lookId: featuredLook.id,
                    note: featuredLook.bookingNote,
                    serviceId: featuredLook.serviceId,
                    staffId: featuredLook.recommendedStaffId,
                    title: "Book this exact look",
                  })
                }
                variant="secondary"
              >
                Book featured look
              </Button>
            ) : null}
          </section>

          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-zinc-950">Salon details</h2>
              {capabilities.canEditProfile ? (
                <button
                  className="text-sm font-semibold text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline"
                  onClick={() => setProfileEditorOpen(true)}
                  type="button"
                >
                  Edit
                </button>
              ) : null}
            </div>
            {hasDetails ? (
              <div className="mt-4 grid gap-4 text-sm text-zinc-600">
                {address ? (
                  <div>
                    <p className="font-semibold text-zinc-950">Address</p>
                    <p className="mt-1 leading-6">{address}</p>
                    <a
                      className="mt-2 inline-flex font-semibold text-zinc-950 underline-offset-4 hover:underline"
                      href={directionsUrl(address)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Get directions
                    </a>
                  </div>
                ) : null}
                {phone ? (
                  <div>
                    <p className="font-semibold text-zinc-950">Phone</p>
                    <a
                      className="mt-1 inline-flex underline-offset-4 hover:underline"
                      href={`tel:${profile.phone?.replace(/\D/g, "")}`}
                    >
                      {phone}
                    </a>
                  </div>
                ) : null}
                {website ? (
                  <div>
                    <p className="font-semibold text-zinc-950">Website</p>
                    <a
                      className="mt-1 inline-flex underline-offset-4 hover:underline"
                      href={website}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {displayWebsite(profile.website)}
                    </a>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-zinc-500">
                Contact details will appear here once the salon publishes them.
              </p>
            )}
          </section>

          {data.staff.length > 0 ? (
            <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-zinc-950">Team</h2>
                <button
                  className="text-sm font-semibold text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline"
                  onClick={() => setSelectedTab("team")}
                  type="button"
                >
                  View team
                </button>
              </div>
              <div className="mt-4 grid gap-3">
                {data.staff.slice(0, 3).map((member) => (
                  <div className="flex items-center gap-3" key={member.id}>
                    <div className="grid h-11 w-11 place-items-center rounded-full bg-zinc-950 text-xs font-semibold text-white">
                      {initialsFor(member.displayName)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-950">
                        {member.displayName}
                      </p>
                      {member.jobTitle ? (
                        <p className="text-xs text-zinc-500">{member.jobTitle}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    );
  }

  function renderGallery() {
    const galleryLooks = selectedMood
      ? sortedLooks.filter((look) => look.mood === selectedMood)
      : sortedLooks;

    if (galleryLooks.length === 0) {
      return (
        <EmptyState title="Gallery is waiting">
          Published looks will build this gallery automatically.
        </EmptyState>
      );
    }

    return (
      <section className="grid gap-5">
        {moodOptions.length > 1 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              className={[
                "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold",
                selectedMood
                  ? "border-zinc-200 bg-white text-zinc-700"
                  : "border-zinc-950 bg-zinc-950 text-white",
              ].join(" ")}
              onClick={() => {
                setSelectedMood(null);
                setFeaturedLookId(null);
              }}
              type="button"
            >
              All looks
            </button>
            {moodOptions
              .filter((mood) => mood !== "Surprise me")
              .map((mood) => (
                <button
                  className={[
                    "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold",
                    selectedMood === mood
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-200 bg-white text-zinc-700",
                  ].join(" ")}
                  key={mood}
                  onClick={() => selectMood(mood)}
                  type="button"
                >
                  {mood}
                </button>
              ))}
          </div>
        ) : null}
        <div className="columns-2 gap-3 sm:columns-3 xl:columns-4">
          {galleryLooks.map((look, index) => (
            <button
              className="group relative mb-3 block w-full break-inside-avoid overflow-hidden rounded-2xl bg-zinc-100 text-left shadow-[0_14px_40px_rgba(24,24,27,.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              key={look.id}
              onClick={() => setDetailLook(look)}
              type="button"
            >
              <LookImage
                className={[
                  "w-full transition duration-300 group-hover:scale-[1.02] motion-reduce:transition-none",
                  index % 3 === 0 ? "aspect-[4/5]" : "aspect-square",
                ].join(" ")}
                imageUrl={look.imageUrl}
                title={look.title}
              />
              <span className="absolute inset-x-0 bottom-0 bg-white/92 p-3 opacity-0 shadow-[0_-12px_30px_rgba(24,24,27,.08)] transition group-hover:opacity-100 group-focus-visible:opacity-100">
                <span className="block text-sm font-semibold text-zinc-950">
                  {look.title}
                </span>
                <span className="mt-1 block text-xs text-zinc-600">
                  {joinMeta([
                    look.mood,
                    look.serviceName,
                    (saveCounts.get(look.id) ?? 0) > 0
                      ? `${saveCounts.get(look.id)} save${
                          saveCounts.get(look.id) === 1 ? "" : "s"
                        }`
                      : null,
                  ])}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  function renderServices() {
    if (data.services.length === 0) {
      return (
        <EmptyState title="No services published">
          Services will appear once the salon has active catalog items.
        </EmptyState>
      );
    }

    const groups = data.services.reduce<Array<{ category: string; services: PublicSalonProfileService[] }>>(
      (output, service) => {
        const category = service.category?.trim() || "Services";
        const existing = output.find((group) => group.category === category);

        if (existing) {
          existing.services.push(service);
        } else {
          output.push({ category, services: [service] });
        }

        return output;
      },
      [],
    );

    return (
      <div className="grid gap-6">
        {groups.map((group) => (
          <section className="grid gap-3" key={group.category}>
            <h2 className="text-xl font-semibold text-zinc-950">
              {group.category}
            </h2>
            <div className="grid gap-3">
              {group.services.map((service) => (
                <ServiceRow
                  canBook={capabilities.canBook}
                  key={service.id}
                  onBook={openBooking}
                  service={service}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  function renderTeam() {
    if (data.staff.length === 0) {
      return (
        <EmptyState title="Team is not published yet">
          Artists will appear when active staff profiles are available.
        </EmptyState>
      );
    }

    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.staff.map((member) => (
          <TeamCard
            canBook={capabilities.canBook}
            key={member.id}
            member={member}
            onBook={openBooking}
            onOpen={setDetailStaff}
          />
        ))}
      </div>
    );
  }

  function renderReviews() {
    const visibleReviews =
      reviewFilter === "verified"
        ? data.reviews.filter(
            (review) => review.verificationStatus === "verified",
          )
        : data.reviews;
    const reviewDisabledReason = !capabilities.isAuthenticated
      ? "Sign in to write a public review."
      : isManagedViewer
        ? "Open the public profile as a customer to write a review."
        : null;

    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,.45fr)]">
        <div className="grid gap-4">
          <ReviewSummaryPanel summary={data.reviewSummary} />
          <div className="flex flex-wrap gap-2">
            {(["all", "verified"] as const).map((filter) => (
              <button
                aria-pressed={reviewFilter === filter}
                className={[
                  "rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
                  reviewFilter === filter
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
                ].join(" ")}
                key={filter}
                onClick={() => setReviewFilter(filter)}
                type="button"
              >
                {filter === "all" ? "All reviews" : "Verified visits"}
              </button>
            ))}
          </div>
          {visibleReviews.length > 0 ? (
            <div className="grid gap-3">
              {visibleReviews.map((review) => (
                <ReviewCard
                  canReplyAsSalon={capabilities.canReplyAsSalon}
                  key={review.id}
                  onPosted={refresh}
                  review={review}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="No reviews yet">
              {reviewFilter === "verified"
                ? "Verified appointment reviews will appear after customers review completed bookings."
                : "Customer reviews will appear here when they are posted."}
            </EmptyState>
          )}
        </div>
        <ReviewComposer
          disabledReason={reviewDisabledReason}
          onPosted={refresh}
          salonId={profile.salonId}
        />
      </div>
    );
  }

  function renderAbout() {
    const website = normalizeWebsite(profile.website);
    const phone = formatPhone(profile.phone);
    const serviceSummary = profile.serviceNames.slice(0, 8);

    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,.58fr)]">
        <section className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            About
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-zinc-950">
            {profile.name}
          </h3>
          <p className="mt-4 text-sm leading-7 text-zinc-600">
            {profile.story ??
              profile.description ??
              "This salon is still shaping its public story."}
          </p>
          {serviceSummary.length > 0 ? (
            <div className="mt-6">
              <h4 className="text-sm font-semibold text-zinc-950">
                Known for
              </h4>
              <div className="mt-3 flex flex-wrap gap-2">
                {serviceSummary.map((serviceName) => (
                  <span
                    className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm text-zinc-700"
                    key={serviceName}
                  >
                    {serviceName}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>
        <aside className="grid gap-4">
          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 text-sm text-zinc-600 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
            <h4 className="font-semibold text-zinc-950">Visit details</h4>
            <div className="mt-4 grid gap-4">
              {address ? (
                <div>
                  <p className="font-semibold text-zinc-950">Address</p>
                  <p className="mt-1 leading-6">{address}</p>
                  <a
                    className="mt-2 inline-flex font-semibold text-zinc-950 underline-offset-4 hover:underline"
                    href={directionsUrl(address)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Directions
                  </a>
                </div>
              ) : null}
              {phone ? (
                <div>
                  <p className="font-semibold text-zinc-950">Phone</p>
                  <a
                    className="mt-1 inline-flex underline-offset-4 hover:underline"
                    href={`tel:${profile.phone?.replace(/\D/g, "")}`}
                  >
                    {phone}
                  </a>
                </div>
              ) : null}
              {profile.email ? (
                <div>
                  <p className="font-semibold text-zinc-950">Email</p>
                  <a
                    className="mt-1 inline-flex underline-offset-4 hover:underline"
                    href={`mailto:${profile.email}`}
                  >
                    {profile.email}
                  </a>
                </div>
              ) : null}
              {website ? (
                <div>
                  <p className="font-semibold text-zinc-950">Website</p>
                  <a
                    className="mt-1 inline-flex underline-offset-4 hover:underline"
                    href={website}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {displayWebsite(profile.website)}
                  </a>
                </div>
              ) : null}
            </div>
          </section>
          {data.staff.length > 0 ? (
            <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
              <h4 className="font-semibold text-zinc-950">Team preview</h4>
              <div className="mt-4 grid gap-3">
                {data.staff.slice(0, 3).map((member) => (
                  <div className="flex items-center gap-3" key={member.id}>
                    <Avatar
                      logoUrl={member.avatarUrl}
                      name={member.displayName}
                      size="sm"
                    />
                    <div>
                      <p className="text-sm font-semibold text-zinc-950">
                        {member.displayName}
                      </p>
                      {member.jobTitle ? (
                        <p className="text-xs text-zinc-500">{member.jobTitle}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    );
  }

  const tabPanel =
    selectedTab === "discover"
      ? renderDiscover()
      : selectedTab === "gallery"
        ? renderGallery()
        : selectedTab === "services"
          ? renderServices()
          : selectedTab === "team"
            ? renderTeam()
            : selectedTab === "reviews"
              ? renderReviews()
              : renderAbout();
  const locationLabel = formatLocation(profile);
  const identityMeta = [
    locationLabel,
    profile.activeServiceCount > 0
      ? `${profile.activeServiceCount} service${
          profile.activeServiceCount === 1 ? "" : "s"
        }`
      : null,
    followerCount > 0
      ? `${followerCount} follower${followerCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);
  const canShowFollow = capabilities.canFollow && !isManagedViewer;
  const canShowBook = capabilities.canBook && !isManagedViewer;
  const canOpenPublicProfile =
    Boolean(manageData?.publicHref) && Boolean(manageData?.readiness.isExploreEligible);
  const canShowManageMenu = isManagedViewer && capabilities.canPublish;

  return (
    <div className="min-w-0 overflow-x-hidden bg-[#f6f5f3] text-zinc-950">
      <div className="mx-auto grid w-full max-w-[88rem] gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="group rounded-2xl border border-zinc-200/80 bg-white shadow-[0_24px_80px_rgba(24,24,27,.08)]">
          <div className="relative z-0 h-[13rem] overflow-hidden rounded-t-2xl bg-zinc-100 sm:h-[16rem] lg:h-[17rem]">
            <SalonCover coverImageUrl={profile.coverImageUrl} name={profile.name} />
            {capabilities.canEditProfile ? (
              <div className="absolute right-4 top-4 z-10 opacity-100 transition sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
                <MediaApplyButton
                  className="h-11 min-h-11 w-11"
                  iconOnly
                  kind="cover"
                  label="Change cover"
                  salonId={profile.salonId}
                />
              </div>
            ) : null}
          </div>

          <div className="relative z-10 px-4 pb-0 sm:px-6 lg:px-8">
            <div className="-mt-12 flex flex-col gap-5 pb-6 sm:-mt-16 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end">
                <div className="relative w-max shrink-0">
                  <Avatar logoUrl={profile.logoImageUrl} name={profile.name} size="lg" />
                  {capabilities.canEditProfile ? (
                    <div className="absolute bottom-2 right-2 z-20 opacity-100 transition sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
                      <MediaApplyButton
                        className="h-10 min-h-10 w-10"
                        iconOnly
                        kind="logo"
                        label="Change logo"
                        salonId={profile.salonId}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="relative z-10 min-w-0 pt-1 sm:pb-2">
                  <h2 className="text-3xl font-semibold leading-tight text-zinc-950 sm:text-4xl">
                    {profile.name}
                  </h2>
                  {profile.description ? (
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                      {profile.description}
                    </p>
                  ) : null}
                  {identityMeta.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
                      {identityMeta.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="relative flex flex-wrap gap-2 lg:justify-end">
                {capabilities.canCreateContent ? (
                  <Button onClick={() => setComposerType("auto")} variant="primary">
                    Create post
                  </Button>
                ) : null}
                {capabilities.canEditProfile ? (
                  <Button
                    onClick={() => setProfileEditorOpen(true)}
                    variant="secondary"
                  >
                    Edit profile
                  </Button>
                ) : null}
                {canOpenPublicProfile && manageData ? (
                  <a
                    className="inline-flex min-h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                    href={manageData.publicHref}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View public profile
                  </a>
                ) : null}
                {canShowFollow ? (
                  <Button disabled={isPending} onClick={toggleFollow} variant="secondary">
                    {isFollowing ? "Following" : "Follow"}
                  </Button>
                ) : null}
                {canShowBook ? (
                  <Button
                    onClick={() => openBooking({ title: "Book now" })}
                    variant="primary"
                  >
                    Book now
                  </Button>
                ) : null}
                {!canShowManageMenu ? (
                  <Button onClick={() => void shareSalon()} variant="secondary">
                    Share
                  </Button>
                ) : (
                  <button
                    aria-expanded={ownerMenuOpen}
                    aria-haspopup="menu"
                    className="inline-flex min-h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:text-zinc-400"
                    onClick={() => setOwnerMenuOpen((current) => !current)}
                    ref={ownerMenuButtonRef}
                    type="button"
                  >
                    Manage
                  </button>
                )}
                {ownerMenuOpen && canShowManageMenu ? (
                  <div
                    className="absolute right-0 top-12 z-40 grid min-w-56 gap-1 rounded-xl border border-zinc-200 bg-white p-2 text-zinc-950 shadow-xl"
                    ref={ownerMenuRef}
                    role="menu"
                  >
                    {capabilities.canPublish && manageData ? (
                      <button
                        className="rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-zinc-50"
                        onClick={() => {
                          setOwnerMenuOpen(false);
                          setPublicationOpen(true);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        Publication settings
                      </button>
                    ) : null}
                    <button
                      className="rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-zinc-50"
                      onClick={() => {
                        setOwnerMenuOpen(false);
                        void shareSalon();
                      }}
                      role="menuitem"
                      type="button"
                    >
                      Share profile
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div
              aria-label="Salon profile sections"
              className="sticky top-0 z-20 -mx-4 flex gap-1 overflow-x-auto border-t border-zinc-100 bg-white/95 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
              onKeyDown={onTabKeyDown}
              role="tablist"
            >
              {TABS.map((tab) => {
                const isActive = selectedTab === tab.id;

                return (
                  <button
                    aria-controls={`salon-profile-${tab.id}`}
                    aria-selected={isActive}
                    className={[
                      "min-h-14 shrink-0 border-b-2 px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
                      isActive
                        ? "border-zinc-950 text-zinc-950"
                        : "border-transparent text-zinc-500 hover:text-zinc-950",
                    ].join(" ")}
                    id={`salon-profile-tab-${tab.id}`}
                    key={tab.id}
                    onClick={() => setSelectedTab(tab.id)}
                    role="tab"
                    type="button"
                  >
                    {tab.label}
                    {tab.id === "gallery" && sortedLooks.length > 0 ? (
                      <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                        {sortedLooks.length}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid gap-4">
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
        {statusMessage ? (
          <p className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 shadow-sm">
            {statusMessage}
          </p>
        ) : null}
        </section>
      </div>

      <section
        aria-labelledby={`salon-profile-tab-${selectedTab}`}
        className="mx-auto w-full max-w-[88rem] px-4 pb-24 sm:px-6 lg:px-8"
        id={`salon-profile-${selectedTab}`}
        role="tabpanel"
      >
        {tabPanel}
      </section>

      {primaryMobileLook && canShowBook ? (
        <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-[.28fr_.32fr_.4fr] gap-2 border-t border-zinc-200 bg-white/95 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-10px_30px_rgba(24,24,27,.12)] backdrop-blur md:hidden">
          <Button
            className="min-h-11 px-3"
            disabled={isPending}
            onClick={() => toggleSave(primaryMobileLook)}
            variant="secondary"
          >
            {savedLookIds.has(primaryMobileLook.id) ? "Saved" : "Save"}
          </Button>
          <Button
            className="min-h-11 px-3"
            onClick={() =>
              setCommentTarget({
                lookId: primaryMobileLook.id,
                title: primaryMobileLook.title,
              })
            }
            variant="secondary"
          >
            Comment
          </Button>
          <Button
            className="min-h-11 px-3"
            onClick={() =>
              openBooking({
                lookId: primaryMobileLook.id,
                note: primaryMobileLook.caption ?? primaryMobileLook.bookingNote,
                serviceId: primaryMobileLook.serviceId,
                staffId: primaryMobileLook.recommendedStaffId,
                title: "Book this exact look",
              })
            }
            variant="primary"
          >
            Book
          </Button>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {statusMessage}
      </p>

      {composerType ? (
        <ComposerModal
          data={data}
          initialType={composerType}
          onClose={() => setComposerType(null)}
          onPosted={() => setStatusMessage("Post published.")}
        />
      ) : null}
      {profileEditorOpen && manageData ? (
        <ProfileEditor
          onClose={() => setProfileEditorOpen(false)}
          setting={manageData.setting}
        />
      ) : null}
      {publicationOpen && manageData ? (
        <PublicationDrawer
          onClose={() => setPublicationOpen(false)}
          publicHref={manageData.publicHref}
          readiness={manageData.readiness}
          setting={manageData.setting}
        />
      ) : null}
      {commentTarget ? (
        <Modal onClose={() => setCommentTarget(null)} title="Comments">
          <CommentsPanel
            capabilities={capabilities}
            comments={comments}
            onPosted={refresh}
            salonId={profile.salonId}
            target={commentTarget}
          />
        </Modal>
      ) : null}
      {detailLook ? (
        <LookDetailDialog
          capabilities={capabilities}
          comments={comments}
          isSaved={savedLookIds.has(detailLook.id)}
          look={detailLook}
          onBook={openBooking}
          onClose={() => setDetailLook(null)}
          onCommentPosted={refresh}
          onSave={toggleSave}
          onShare={() => void shareSalon()}
          saveCount={saveCounts.get(detailLook.id) ?? 0}
          salonId={profile.salonId}
        />
      ) : null}
      {detailStaff ? (
        <StaffDetailDialog
          canBook={capabilities.canBook}
          looks={sortedLooks}
          member={detailStaff}
          onBook={openBooking}
          onClose={() => setDetailStaff(null)}
          onOpenLook={(look) => {
            setDetailLook(look);
            setDetailStaff(null);
          }}
        />
      ) : null}
    </div>
  );
}
