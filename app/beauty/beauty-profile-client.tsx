"use client";

import {
  createBeautyPostAction,
  deleteBeautyAvatarMediaAction,
  deleteBeautyMediaAction,
  deleteBeautyPostAction,
  getBeautyAvatarUploadSessionAction,
  getBeautyMediaUploadSessionAction,
  loadBeautyTimelineAction,
  searchBeautyAttributionSalonsAction,
  updateBeautyPostCaptionAction,
  updateBeautyProfileAction,
} from "@/app/beauty/actions";
import { PostCommentThread } from "@/app/post-comments/post-comment-thread";
import { SavePostButton } from "@/app/saved-post/save-post-button";
import { BeforeAfterCompare } from "@/components/before-after-compare";
import {
  ACCOUNT_AVATAR_ALLOWED_IMAGE_TYPES,
  ACCOUNT_AVATAR_IMAGE_LIMIT,
} from "@/lib/account-avatar";
import {
  BEAUTY_ALLOWED_IMAGE_TYPES,
  BEAUTY_IMAGE_LIMIT,
  encodeStoragePath,
} from "@/lib/beauty-media";
import type {
  BeautyAttributionSalon,
  BeautyAttributionStaff,
  BeautyPostMediaInput,
  BeautyProfileSummary,
  BeautyProfileVisibility,
  BeautyRecentVisitCandidate,
  BeautyTimelineCursor,
  BeautyTimelinePage,
  BeautyTimelinePost,
} from "@/types/beauty";
import type { PostCommentViewer } from "@/types/post-comments";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ChangeEvent,
  type FormEvent,
} from "react";

type BeautyProfileClientProps = {
  commentViewer: PostCommentViewer;
  initialTimeline: BeautyTimelinePage;
  profile: BeautyProfileSummary;
  visitCandidates: BeautyRecentVisitCandidate[];
};

type ComposerMode = "before_after" | "regular";
type TimelineFilter = "all" | "before_after";

type UploadedBeautyMedia = BeautyPostMediaInput & {
  id: string;
  previewUrl: string;
};

type UploadedProfileImage = {
  path: string;
  previewUrl: string;
  publicUrl?: string;
};

type ProfileUploadTarget = "avatar" | "cover";

type SelectedAttribution = {
  salonId: string;
  salonName: string;
  staffId: string | null;
  staffName: string | null;
  staffOptions: BeautyAttributionStaff[];
  source: "customer_claimed" | "recent_visit_suggestion";
};

const acceptedMimeTypes = new Set<string>(BEAUTY_ALLOWED_IMAGE_TYPES);
const acceptedAvatarMimeTypes = new Set<string>(ACCOUNT_AVATAR_ALLOWED_IMAGE_TYPES);
const composerImageTargetBytes = 1.6 * 1024 * 1024;
const timelineFilters: Array<{ id: TimelineFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "before_after", label: "Before & After" },
];

function classNames(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatVisitDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Recent visit";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(date);
}

function sourceLabel(source: BeautyRecentVisitCandidate["source"]) {
  if (source === "receipt") {
    return "Receipt";
  }

  if (source === "check_in") {
    return "Check-in";
  }

  return "Booking";
}

function verificationLabel(
  verification: BeautyTimelinePost["verification"],
) {
  if (!verification) {
    return null;
  }

  if (verification.state === "verified") {
    return "Verified visit";
  }

  if (verification.state === "unverified" || verification.state === "rejected") {
    return "Not verified";
  }

  return "Visit verification pending";
}

function publicBeautyPostHref(post: BeautyTimelinePost) {
  return `/explore/beauty/${encodeURIComponent(
    post.author.profileId,
  )}/posts/${encodeURIComponent(post.id)}`;
}

function subscribeToLocationOrigin() {
  return () => {};
}

function getLocationOriginSnapshot() {
  return typeof window === "undefined" ? "" : window.location.origin;
}

function getServerOriginSnapshot() {
  return "";
}

function SharePostAction({ post }: { post: BeautyTimelinePost }) {
  const relativeHref = publicBeautyPostHref(post);
  const origin = useSyncExternalStore(
    subscribeToLocationOrigin,
    getLocationOriginSnapshot,
    getServerOriginSnapshot,
  );
  const shareUrl = origin ? new URL(relativeHref, origin).toString() : relativeHref;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const shareButtonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const hintId = `share-reward-hint-${post.id}`;
  const dialogTitleId = `share-post-title-${post.id}`;
  const shareText =
    "Share this post. Bookings from your post may earn Beauty points and qualify for salon rewards.";
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedText = encodeURIComponent(shareText);
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=144x144&data=${encodedUrl}`;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const fallbackFocus = shareButtonRef.current;
    const focusTimer = window.setTimeout(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("button, a, summary")
        ?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      } else {
        fallbackFocus?.focus();
      }
    };
  }, [open]);

  async function copyShareLink() {
    try {
      if (!navigator.clipboard) {
        setStatus("Copy the link from the opened post.");
        return;
      }

      await navigator.clipboard.writeText(shareUrl);
      setStatus("Link copied.");
    } catch {
      setStatus("Copy the link from the opened post.");
    }
  }

  async function shareWithDevice() {
    if (navigator.share) {
      try {
        await navigator.share({
          text: shareText,
          title: "My Reylumi post",
          url: shareUrl,
        });
        setStatus("Share opened.");
        return;
      } catch {
        return;
      }
    }

    await copyShareLink();
  }

  return (
    <>
      <span className="group relative inline-flex">
        <button
          aria-describedby={hintId}
          className="inline-flex min-h-10 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-extrabold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          onClick={() => {
            setStatus("");
            setOpen(true);
          }}
          ref={shareButtonRef}
          type="button"
        >
          Share
        </button>
        <span
          className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 hidden w-64 rounded-2xl bg-text-primary px-3 py-2 text-left text-xs font-semibold leading-5 text-white shadow-lg group-hover:block group-focus-within:block"
          id={hintId}
          role="tooltip"
        >
          {shareText}
        </span>
      </span>

      {open ? (
        <div
          aria-labelledby={dialogTitleId}
          aria-modal="true"
          className="fixed inset-0 z-[70] grid place-items-end bg-zinc-950/45 p-0 backdrop-blur-sm sm:place-items-center sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
            }
          }}
          role="dialog"
        >
          <div
            className="grid max-h-[calc(100dvh-1rem)] w-full gap-4 overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl ring-1 ring-divider-subtle sm:max-w-sm sm:rounded-2xl sm:p-5"
            ref={dialogRef}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  className="text-base font-extrabold text-text-primary"
                  id={dialogTitleId}
                >
                  Share this post
                </h2>
                <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
                  {shareText}
                </p>
              </div>
              <button
                aria-label="Close share options"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-muted text-lg font-extrabold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                onClick={() => setOpen(false)}
                type="button"
              >
                &times;
              </button>
            </div>

            <div className="grid gap-2">
              <button
                className="min-h-11 rounded-full bg-brand-orange px-4 text-sm font-extrabold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                onClick={() => void shareWithDevice()}
                type="button"
              >
                Share with device
              </button>
              <button
                className="min-h-11 rounded-full bg-surface-muted px-4 text-sm font-extrabold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                onClick={() => void copyShareLink()}
                type="button"
              >
                Copy link
              </button>
              <a
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-surface-muted px-4 text-sm font-extrabold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={relativeHref}
              >
                Open post
              </a>
            </div>

            <div className="flex flex-wrap gap-2 text-xs font-extrabold text-text-secondary">
              <a
                className="rounded-full bg-surface-muted px-3 py-2 ring-1 ring-divider-subtle transition hover:text-brand-orange"
                href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
                rel="noreferrer"
                target="_blank"
              >
                Facebook
              </a>
              <a
                className="rounded-full bg-surface-muted px-3 py-2 ring-1 ring-divider-subtle transition hover:text-brand-orange"
                href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`}
                rel="noreferrer"
                target="_blank"
              >
                X
              </a>
              <a
                className="rounded-full bg-surface-muted px-3 py-2 ring-1 ring-divider-subtle transition hover:text-brand-orange"
                href={`mailto:?subject=${encodeURIComponent("My Reylumi post")}&body=${encodedText}%0A%0A${encodedUrl}`}
              >
                Email
              </a>
              <a
                className="rounded-full bg-surface-muted px-3 py-2 ring-1 ring-divider-subtle transition hover:text-brand-orange"
                href={`sms:?&body=${encodedText}%20${encodedUrl}`}
              >
                SMS
              </a>
            </div>

            <details className="rounded-2xl bg-surface-muted p-3 text-xs font-bold text-text-secondary ring-1 ring-divider-subtle">
              <summary className="cursor-pointer text-text-primary">
                QR code
              </summary>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="QR code for this Reylumi post"
                className="mt-3 h-36 w-36 rounded-xl bg-white"
                src={qrCodeUrl}
              />
            </details>

            {status ? (
              <p className="text-xs font-bold text-brand-teal" role="status">
                {status}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
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

async function processBeautyImage(file: File) {
  const image = await readImage(file);
  const maxWidth = 1800;
  const maxHeight = 2200;
  const scale = Math.min(
    1,
    maxWidth / image.naturalWidth,
    maxHeight / image.naturalHeight,
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Image processor is not available.");
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  let quality = 0.9;
  let blob = await canvasToBlob(canvas, quality);

  while (blob.size > composerImageTargetBytes && quality > 0.7) {
    quality -= 0.06;
    blob = await canvasToBlob(canvas, quality);
  }

  return {
    file: new File([blob], `beauty-${crypto.randomUUID()}.webp`, {
      type: "image/webp",
    }),
    height,
    width,
  };
}

async function processAvatarImage(file: File) {
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

  return new File([blob], `beauty-avatar-${crypto.randomUUID()}.webp`, {
    type: "image/webp",
  });
}

async function processCoverImage(file: File) {
  const image = await readImage(file);
  const targetRatio = 3.35;
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  let sx = 0;
  let sy = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;

  if (sourceRatio > targetRatio) {
    sourceWidth = Math.round(image.naturalHeight * targetRatio);
    sx = Math.round((image.naturalWidth - sourceWidth) / 2);
  } else {
    sourceHeight = Math.round(image.naturalWidth / targetRatio);
    sy = Math.round((image.naturalHeight - sourceHeight) / 2);
  }

  const width = Math.min(1900, sourceWidth);
  const height = Math.max(1, Math.round(width / targetRatio));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Image processor is not available.");
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(
    image,
    sx,
    sy,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );

  let quality = 0.9;
  let blob = await canvasToBlob(canvas, quality);

  while (blob.size > composerImageTargetBytes && quality > 0.7) {
    quality -= 0.06;
    blob = await canvasToBlob(canvas, quality);
  }

  return {
    file: new File([blob], `beauty-cover-${crypto.randomUUID()}.webp`, {
      type: "image/webp",
    }),
    height,
    width,
  };
}

function uploadToSupabase(input: {
  accessToken: string;
  anonKey: string;
  blob: File;
  bucket: string;
  onProgress?: (value: number) => void;
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
        input.onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress?.(100);
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

function ProfileAvatar({
  className,
  profile,
}: {
  className?: string;
  profile: BeautyProfileSummary;
}) {
  return (
    <span
      className={classNames(
        "grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border border-border-subtle bg-brand-orange-soft text-base font-extrabold text-brand-orange shadow-sm sm:h-20 sm:w-20",
        className,
      )}
    >
      {profile.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${profile.displayName} profile`}
          className="h-full w-full object-cover"
          src={profile.avatarUrl}
        />
      ) : (
        profile.initials
      )}
    </span>
  );
}

function VerificationBadge({
  verification,
}: {
  verification: BeautyTimelinePost["verification"];
}) {
  const label = verificationLabel(verification);

  if (!label) {
    return null;
  }

  const verified = verification?.state === "verified";
  const unavailable =
    verification?.state === "unverified" || verification?.state === "rejected";

  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold",
        verified
          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
          : unavailable
            ? "bg-surface-muted text-text-secondary ring-1 ring-divider-subtle"
            : "bg-amber-50 text-amber-900 ring-1 ring-amber-200",
      )}
    >
      <span
        aria-hidden
        className={classNames(
          "grid h-4 w-4 place-items-center rounded-full text-[9px]",
          verified
            ? "bg-emerald-600 text-white"
            : unavailable
              ? "bg-text-muted text-white"
              : "bg-amber-500 text-white",
        )}
      >
        {verified ? "V" : unavailable ? "N" : "P"}
      </span>
      {label}
    </span>
  );
}

function mediaAspectClass(media: BeautyTimelinePost["media"][number]) {
  if (!media.width || !media.height) {
    return "aspect-[4/5]";
  }

  const ratio = media.width / media.height;

  if (ratio > 1.22) {
    return "aspect-[16/10]";
  }

  if (ratio < 0.82) {
    return "aspect-[4/5]";
  }

  return "aspect-square";
}

function PostMedia({ post }: { post: BeautyTimelinePost }) {
  if (post.type === "before_after") {
    const before = post.media.find((item) => item.role === "before");
    const after = post.media.find((item) => item.role === "after");

    return (
      <BeforeAfterCompare
        after={
          after?.url
            ? {
                alt: "After image for Beauty transformation",
                id: after.id,
                url: after.url,
              }
            : null
        }
        before={
          before?.url
            ? {
                alt: "Before image for Beauty transformation",
                id: before.id,
                url: before.url,
              }
            : null
        }
        roundedClassName="rounded-[1.15rem]"
        sizes="(max-width: 768px) 100vw, 720px"
      />
    );
  }

  if (post.media.length === 0) {
    return post.caption ? (
      <div className="rounded-[1.15rem] bg-brand-orange-soft px-5 py-6 text-text-primary ring-1 ring-brand-orange/10">
        <p className="whitespace-pre-wrap text-base font-semibold leading-7">
          {post.caption}
        </p>
      </div>
    ) : null;
  }

  if (post.media.length === 1) {
    const media = post.media[0];

    return (
      <div
        className={classNames(
          "overflow-hidden rounded-[1.15rem] bg-surface-muted shadow-[0_16px_40px_rgba(35,25,22,0.065)] ring-1 ring-divider-subtle/75",
          mediaAspectClass(media),
        )}
      >
        {media.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt="Beauty post image"
            className="h-full w-full object-cover"
            loading="lazy"
            src={media.url}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-[1.15rem] bg-surface-muted shadow-[0_16px_40px_rgba(35,25,22,0.065)] ring-1 ring-divider-subtle/75">
      {post.media.slice(0, 4).map((media, index) => (
        <div className="relative aspect-square bg-surface-muted" key={media.id}>
          {media.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`Beauty post image ${index + 1}`}
              className="h-full w-full object-cover"
              loading="lazy"
              src={media.url}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PostCard({
  canManage,
  commentViewer,
  onCaptionUpdated,
  onCommentCountChange,
  onDeleted,
  post,
}: {
  canManage: boolean;
  commentViewer: PostCommentViewer;
  onCaptionUpdated: (postId: string, caption: string | null) => void;
  onCommentCountChange: (postId: string, count: number) => void;
  onDeleted: (postId: string) => void;
  post: BeautyTimelinePost;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCountState, setCommentCountState] = useState(() => ({
    count: post.commentCount,
    postId: post.id,
  }));
  const [draftCaption, setDraftCaption] = useState(post.caption ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const attribution = post.attribution;
  const showCaptionBelowMedia = post.media.length > 0;
  const commentTarget = {
    profileId: post.profileId,
    salonId: attribution?.salonId ?? null,
    sourceId: post.id,
    sourceType: "beauty_post" as const,
    title: post.caption ?? "Beauty post",
  };
  const commentCount =
    commentCountState.postId === post.id ? commentCountState.count : post.commentCount;

  function handleCommentCountChange(count: number) {
    setCommentCountState({ count, postId: post.id });
    onCommentCountChange(post.id, count);
  }

  function saveCaption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    startTransition(async () => {
      const result = await updateBeautyPostCaptionAction({
        caption: draftCaption,
        postId: post.id,
      });

      if (result.error) {
        setError(result.error);
        return;
      }

      onCaptionUpdated(post.id, draftCaption.trim() || null);
      setEditing(false);
    });
  }

  function deletePost() {
    setError("");
    startTransition(async () => {
      const result = await deleteBeautyPostAction(post.id);

      if (result.error) {
        setError(result.error);
        return;
      }

      setConfirmingDelete(false);
      onDeleted(post.id);
    });
  }

  return (
    <article className="grid gap-3 rounded-[1.35rem] bg-surface p-3 shadow-[0_18px_52px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle/80 sm:p-4">
      <div className="flex items-start justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-orange-soft text-xs font-extrabold text-brand-orange ring-1 ring-brand-orange/10">
            {post.author.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${post.author.displayName} profile`}
                className="h-full w-full object-cover"
                src={post.author.avatarUrl}
              />
            ) : (
              post.author.displayName.slice(0, 2).toUpperCase()
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-text-primary">
              {post.author.displayName}
            </p>
            <p className="text-xs font-bold text-text-muted">
              {formatDate(post.createdAt)}
            </p>
          </div>
        </div>
        <VerificationBadge verification={post.verification} />
      </div>

      {post.visibility === "public" && post.media.length > 0 ? (
        <div className="relative">
          <PostMedia post={post} />
          <SavePostButton
            className="absolute bottom-3 right-3"
            target={{
              sourceId: post.id,
              sourceType: "beauty_post",
            }}
          />
        </div>
      ) : (
        <PostMedia post={post} />
      )}

      <div className="grid gap-3 px-1 pb-1">
        {attribution ? (
          <div className="grid gap-1 text-sm">
            <p className="font-extrabold text-text-primary">
              {attribution.salonName}
            </p>
            {attribution.staffName ? (
              <p className="font-semibold text-text-secondary">
                with {attribution.staffName}
              </p>
            ) : null}
          </div>
        ) : null}

        {editing ? (
          <form className="grid gap-3" onSubmit={saveCaption}>
            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase text-text-secondary">
                Caption
              </span>
              <textarea
                className="min-h-24 rounded-2xl border border-border-subtle bg-surface-muted px-3 py-2 text-sm font-semibold text-text-primary outline-none transition focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                maxLength={2200}
                onChange={(event) => setDraftCaption(event.currentTarget.value)}
                value={draftCaption}
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                className="min-h-10 rounded-full border border-border-subtle px-4 text-sm font-bold text-text-primary transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60"
                disabled={pending}
                onClick={() => {
                  setDraftCaption(post.caption ?? "");
                  setEditing(false);
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-10 rounded-full bg-brand-orange px-4 text-sm font-extrabold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60"
                disabled={pending}
                type="submit"
              >
                {pending ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        ) : showCaptionBelowMedia && post.caption ? (
          <p className="whitespace-pre-wrap text-sm font-semibold leading-6 text-text-primary">
            {post.caption}
          </p>
        ) : null}

        {error ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
            {error}
          </p>
        ) : null}

        {post.visibility === "public" ? (
          <div className="grid gap-3 border-t border-divider-subtle pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-bold">
              <button
                aria-expanded={commentsOpen}
                className="rounded-full bg-surface-muted px-4 py-2 text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                onClick={() => setCommentsOpen((current) => !current)}
                type="button"
              >
                {commentCount} comment{commentCount === 1 ? "" : "s"}
              </button>
              <a
                className="rounded-full px-3 py-2 text-text-secondary transition hover:bg-surface-muted hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={publicBeautyPostHref(post)}
              >
                Open post
              </a>
            </div>
            {commentsOpen ? (
              <PostCommentThread
                compact
                initialCount={commentCount}
                onCountChange={handleCommentCountChange}
                target={commentTarget}
                viewer={commentViewer}
              />
            ) : null}
          </div>
        ) : null}

        {canManage && !editing ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-divider-subtle pt-3">
            {post.visibility === "public" ? (
              <SharePostAction post={post} />
            ) : null}
            <button
              className="min-h-10 rounded-full bg-surface-muted px-4 text-sm font-bold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60"
              disabled={pending}
              onClick={() => setEditing(true)}
              type="button"
            >
              Edit
            </button>
            <details className="relative">
              <summary
                aria-label="More post actions"
                className="grid min-h-10 min-w-10 cursor-pointer list-none place-items-center rounded-full bg-surface-muted px-3 text-sm font-extrabold text-text-primary ring-1 ring-divider-subtle transition marker:hidden hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              >
                ...
              </summary>
              <div className="absolute right-0 top-12 z-20 grid min-w-32 gap-1 rounded-2xl bg-surface p-2 shadow-xl ring-1 ring-divider-subtle">
                <button
                  className="min-h-10 rounded-xl px-3 text-left text-sm font-bold text-red-700 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-wait disabled:opacity-60"
                  disabled={pending}
                  onClick={() => setConfirmingDelete(true)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </details>
          </div>
        ) : null}
      </div>

      {confirmingDelete ? (
        <div
          aria-labelledby={`delete-beauty-post-${post.id}`}
          aria-modal="true"
          className="fixed inset-0 z-[60] grid place-items-end bg-zinc-950/45 p-0 backdrop-blur-sm sm:place-items-center sm:p-6"
          role="dialog"
        >
          <div className="grid max-h-[calc(100dvh-1rem)] w-full gap-4 overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl ring-1 ring-divider-subtle sm:max-w-sm sm:rounded-2xl sm:p-5">
            <div>
              <h2
                className="text-lg font-extrabold text-text-primary"
                id={`delete-beauty-post-${post.id}`}
              >
                Delete this Beauty post?
              </h2>
              <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
                This removes it from your Beauty timeline.
              </p>
            </div>
            {error ? (
              <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                {error}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                className="min-h-11 rounded-full bg-surface-muted px-4 text-sm font-extrabold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60"
                disabled={pending}
                onClick={() => setConfirmingDelete(false)}
                type="button"
              >
                Keep post
              </button>
              <button
                className="min-h-11 rounded-full bg-red-600 px-4 text-sm font-extrabold text-white transition hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-wait disabled:opacity-60"
                disabled={pending}
                onClick={deletePost}
                type="button"
              >
                {pending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function BeautyProfileClient({
  commentViewer,
  initialTimeline,
  profile: initialProfile,
  visitCandidates,
}: BeautyProfileClientProps) {
  const normalFileInputRef = useRef<HTMLInputElement | null>(null);
  const beforeInputRef = useRef<HTMLInputElement | null>(null);
  const afterInputRef = useRef<HTMLInputElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const composerDialogRef = useRef<HTMLDivElement | null>(null);
  const profileEditorDialogRef = useRef<HTMLFormElement | null>(null);
  const profileEditButtonRef = useRef<HTMLButtonElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const loadingMoreRef = useRef(false);
  const publishingRef = useRef(false);
  const profileSavingRef = useRef(false);
  const objectUrlsRef = useRef(new Set<string>());
  const [profile, setProfile] = useState(initialProfile);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileDraftBio, setProfileDraftBio] = useState(initialProfile.bio ?? "");
  const [profileDraftVisibility, setProfileDraftVisibility] =
    useState<BeautyProfileVisibility>(initialProfile.visibility);
  const [profileEditorError, setProfileEditorError] = useState("");
  const [profileUpload, setProfileUpload] = useState<ProfileUploadTarget | null>(
    null,
  );
  const [profileUploadProgress, setProfileUploadProgress] = useState(0);
  const [coverUpload, setCoverUpload] = useState<UploadedProfileImage | null>(
    null,
  );
  const [avatarUpload, setAvatarUpload] = useState<UploadedProfileImage | null>(
    null,
  );
  const [removeCover, setRemoveCover] = useState(false);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [posts, setPosts] = useState(initialTimeline.items);
  const [activeFilter, setActiveFilter] = useState<TimelineFilter>("all");
  const [cursor, setCursor] = useState<BeautyTimelineCursor | null>(
    initialTimeline.nextCursor,
  );
  const [hasMore, setHasMore] = useState(initialTimeline.hasMore);
  const [timelineError, setTimelineError] = useState(
    initialTimeline.error ?? "",
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("regular");
  const [caption, setCaption] = useState("");
  const [normalMedia, setNormalMedia] = useState<UploadedBeautyMedia[]>([]);
  const [beforeMedia, setBeforeMedia] = useState<UploadedBeautyMedia | null>(
    null,
  );
  const [afterMedia, setAfterMedia] = useState<UploadedBeautyMedia | null>(null);
  const [composerError, setComposerError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [attribution, setAttribution] = useState<SelectedAttribution | null>(
    null,
  );
  const [manualSalonSearchOpen, setManualSalonSearchOpen] = useState(
    visitCandidates.length === 0,
  );
  const [salonQuery, setSalonQuery] = useState("");
  const [salonResults, setSalonResults] = useState<BeautyAttributionSalon[]>(
    [],
  );
  const [searchingSalons, setSearchingSalons] = useState(false);
  const [successNotice, setSuccessNotice] = useState("");
  const [savingProfile, startSavingProfile] = useTransition();
  const [publishing, startPublishing] = useTransition();
  const currentComposerMedia =
    composerMode === "regular"
      ? normalMedia
      : [beforeMedia, afterMedia].filter(
          (item): item is UploadedBeautyMedia => Boolean(item),
        );
  const composerBusy = uploading || publishing;
  const profileEditorBusy = profileUpload !== null || savingProfile;
  const displayedCoverUrl = removeCover
    ? null
    : (coverUpload?.previewUrl ?? profile.coverImageUrl);
  const displayedAvatarUrl = removeAvatar
    ? null
    : (avatarUpload?.previewUrl ?? profile.avatarUrl);
  const visiblePosts = useMemo(
    () =>
      activeFilter === "before_after"
        ? posts.filter((post) => post.type === "before_after")
        : posts,
    [activeFilter, posts],
  );
  const composerTitle =
    composerMode === "before_after" ? "Create Before & After" : "Share a beauty moment";
  const composerDescription =
    composerMode === "before_after"
      ? "Add the transformation, then choose the salon visit if it applies."
      : "Add a caption, photos, or both. Keep it easy.";

  const loadMorePosts = useCallback(async () => {
    if (!cursor || loadingMoreRef.current) {
      return;
    }

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setTimelineError("");

    try {
      const page = await loadBeautyTimelineAction(profile.id, cursor);

      if (page.error) {
        setTimelineError(page.error);
        return;
      }

      setPosts((current) => {
        const seen = new Set(current.map((post) => post.id));
        const next = page.items.filter((post) => !seen.has(post.id));

        return [...current, ...next];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [cursor, profile.id]);

  useEffect(() => {
    const objectUrls = objectUrlsRef.current;

    return () => {
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
      objectUrls.clear();
    };
  }, []);

  useEffect(() => {
    if (!successNotice) {
      return;
    }

    const timer = window.setTimeout(() => setSuccessNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [successNotice]);

  useEffect(() => {
    if (!composerOpen) {
      return;
    }

    composerDialogRef.current?.focus();
  }, [composerOpen]);

  useEffect(() => {
    if (!profileEditorOpen) {
      return;
    }

    profileEditorDialogRef.current?.focus();
  }, [profileEditorOpen]);

  useEffect(() => {
    if (!composerOpen || composerMode !== "before_after" || !manualSalonSearchOpen) {
      return;
    }

    const query = salonQuery.trim();

    if (query.length < 2 || query === attribution?.salonName) {
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setSearchingSalons(true);
      void searchBeautyAttributionSalonsAction(query)
        .then((results) => {
          if (active) {
            setSalonResults(results);
          }
        })
        .finally(() => {
          if (active) {
            setSearchingSalons(false);
          }
        });
    }, 280);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    attribution?.salonName,
    composerMode,
    composerOpen,
    manualSalonSearchOpen,
    salonQuery,
  ]);

  useEffect(() => {
    const node = sentinelRef.current;

    if (!node || !hasMore || loadingMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMorePosts();
        }
      },
      {
        rootMargin: "480px",
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMorePosts, loadingMore]);

  const selectedStaffOptions = useMemo(
    () => attribution?.staffOptions ?? [],
    [attribution],
  );

  function rememberObjectUrl(url: string) {
    objectUrlsRef.current.add(url);
  }

  function releaseObjectUrl(url: string | null | undefined) {
    if (url && objectUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(url);
    }
  }

  function releaseProfileImage(
    image: UploadedProfileImage | null,
    target: ProfileUploadTarget,
    deleteRemote: boolean,
  ) {
    if (!image) {
      return;
    }

    releaseObjectUrl(image.previewUrl);

    if (!deleteRemote) {
      return;
    }

    if (target === "cover") {
      void deleteBeautyMediaAction(image.path);
    } else {
      void deleteBeautyAvatarMediaAction(image.path);
    }
  }

  function resetProfileEditorUploads(deleteRemote: boolean) {
    releaseProfileImage(coverUpload, "cover", deleteRemote);
    releaseProfileImage(avatarUpload, "avatar", deleteRemote);
    setCoverUpload(null);
    setAvatarUpload(null);
  }

  function openProfileEditor() {
    setProfileDraftBio(profile.bio ?? "");
    setProfileDraftVisibility(profile.visibility);
    setProfileEditorError("");
    setProfileUpload(null);
    setProfileUploadProgress(0);
    setRemoveCover(false);
    setRemoveAvatar(false);
    resetProfileEditorUploads(true);
    setProfileEditorOpen(true);
  }

  function closeProfileEditor() {
    if (profileEditorBusy) {
      setProfileEditorError("Finish saving or uploading before closing.");
      return;
    }

    setProfileEditorError("");
    setProfileUploadProgress(0);
    setRemoveCover(false);
    setRemoveAvatar(false);
    resetProfileEditorUploads(true);
    setProfileEditorOpen(false);
    window.setTimeout(() => profileEditButtonRef.current?.focus(), 0);
  }

  async function uploadCoverImage(file: File | null) {
    setProfileEditorError("");

    if (!file) {
      return;
    }

    if (!acceptedMimeTypes.has(file.type)) {
      setProfileEditorError("Use a JPEG, PNG, or WebP cover image.");
      return;
    }

    if (file.size > BEAUTY_IMAGE_LIMIT) {
      setProfileEditorError(
        `Cover image must be ${formatBytes(BEAUTY_IMAGE_LIMIT)} or smaller.`,
      );
      return;
    }

    setProfileUpload("cover");
    setProfileUploadProgress(0);

    let previewUrl: string | null = null;
    let uploadedPath: string | null = null;

    try {
      const processed = await processCoverImage(file);
      previewUrl = URL.createObjectURL(processed.file);
      rememberObjectUrl(previewUrl);
      const session = await getBeautyMediaUploadSessionAction("cover");
      uploadedPath = session.path;

      await uploadToSupabase({
        accessToken: session.accessToken,
        anonKey: session.anonKey,
        blob: processed.file,
        bucket: session.bucket,
        onProgress: setProfileUploadProgress,
        path: session.path,
        supabaseUrl: session.supabaseUrl,
      });

      releaseProfileImage(coverUpload, "cover", true);
      setCoverUpload({
        path: session.path,
        previewUrl,
      });
      setRemoveCover(false);
    } catch (error) {
      releaseObjectUrl(previewUrl);

      if (uploadedPath) {
        void deleteBeautyMediaAction(uploadedPath);
      }

      setProfileEditorError(
        error instanceof Error ? error.message : "Cover upload failed.",
      );
    } finally {
      setProfileUpload(null);
      setProfileUploadProgress(0);

      if (coverInputRef.current) {
        coverInputRef.current.value = "";
      }
    }
  }

  async function uploadAvatarImage(file: File | null) {
    setProfileEditorError("");

    if (!file) {
      return;
    }

    if (!acceptedAvatarMimeTypes.has(file.type)) {
      setProfileEditorError("Use a JPEG, PNG, or WebP profile photo.");
      return;
    }

    if (file.size > ACCOUNT_AVATAR_IMAGE_LIMIT) {
      setProfileEditorError(
        `Profile photo must be ${formatBytes(
          ACCOUNT_AVATAR_IMAGE_LIMIT,
        )} or smaller.`,
      );
      return;
    }

    setProfileUpload("avatar");
    setProfileUploadProgress(0);

    let previewUrl: string | null = null;
    let uploadedPath: string | null = null;

    try {
      const processed = await processAvatarImage(file);
      previewUrl = URL.createObjectURL(processed);
      rememberObjectUrl(previewUrl);
      const session = await getBeautyAvatarUploadSessionAction();
      uploadedPath = session.path;

      await uploadToSupabase({
        accessToken: session.accessToken,
        anonKey: session.anonKey,
        blob: processed,
        bucket: session.bucket,
        onProgress: setProfileUploadProgress,
        path: session.path,
        supabaseUrl: session.supabaseUrl,
      });

      releaseProfileImage(avatarUpload, "avatar", true);
      setAvatarUpload({
        path: session.path,
        previewUrl,
        publicUrl: session.publicUrl,
      });
      setRemoveAvatar(false);
    } catch (error) {
      releaseObjectUrl(previewUrl);

      if (uploadedPath) {
        void deleteBeautyAvatarMediaAction(uploadedPath);
      }

      setProfileEditorError(
        error instanceof Error ? error.message : "Profile photo upload failed.",
      );
    } finally {
      setProfileUpload(null);
      setProfileUploadProgress(0);

      if (avatarInputRef.current) {
        avatarInputRef.current.value = "";
      }
    }
  }

  function removeCoverImage() {
    releaseProfileImage(coverUpload, "cover", true);
    setCoverUpload(null);
    setRemoveCover(true);
  }

  function removeAvatarImage() {
    releaseProfileImage(avatarUpload, "avatar", true);
    setAvatarUpload(null);
    setRemoveAvatar(true);
  }

  function saveBeautyProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (profileEditorBusy || profileSavingRef.current) {
      return;
    }

    setProfileEditorError("");
    profileSavingRef.current = true;

    startSavingProfile(async () => {
      try {
        const result = await updateBeautyProfileAction({
          avatarPath: avatarUpload?.path ?? null,
          bio: profileDraftBio,
          coverMediaPath: coverUpload?.path ?? null,
          removeAvatar,
          removeCover,
          visibility: profileDraftVisibility,
        });

        if (result.error !== null) {
          setProfileEditorError(result.error);
          return;
        }

        setProfile(result.profile);
        setProfileDraftBio(result.profile.bio ?? "");
        setProfileDraftVisibility(result.profile.visibility);
        setRemoveCover(false);
        setRemoveAvatar(false);
        resetProfileEditorUploads(false);
        setProfileEditorOpen(false);
        setSuccessNotice("Beauty profile updated.");
        window.setTimeout(() => profileEditButtonRef.current?.focus(), 0);
      } finally {
        profileSavingRef.current = false;
      }
    });
  }

  function updateSalonQuery(value: string) {
    setManualSalonSearchOpen(true);
    setSalonQuery(value);

    if (value.trim().length < 2) {
      setSalonResults([]);
      setSearchingSalons(false);
    }
  }

  function releaseMedia(media: UploadedBeautyMedia | null) {
    if (!media) {
      return;
    }

    if (objectUrlsRef.current.has(media.previewUrl)) {
      URL.revokeObjectURL(media.previewUrl);
      objectUrlsRef.current.delete(media.previewUrl);
    }

    void deleteBeautyMediaAction(media.objectPath);
  }

  function openComposer(mode: ComposerMode) {
    setComposerMode(mode);
    setComposerOpen(true);
    setComposerError("");
    setManualSalonSearchOpen(mode === "before_after" && visitCandidates.length === 0);
  }

  function resetComposer(cleanup: boolean) {
    if (cleanup) {
      normalMedia.forEach(releaseMedia);
      releaseMedia(beforeMedia);
      releaseMedia(afterMedia);
    }

    setCaption("");
    setNormalMedia([]);
    setBeforeMedia(null);
    setAfterMedia(null);
    setComposerError("");
    setUploadProgress(0);
    setAttribution(null);
    setManualSalonSearchOpen(visitCandidates.length === 0);
    setSalonQuery("");
    setSalonResults([]);
  }

  function closeComposer() {
    if (composerBusy) {
      setComposerError("Finish publishing or uploading before closing.");
      return;
    }

    resetComposer(true);
    setComposerOpen(false);
  }

  async function uploadBeautyFile(file: File, role: BeautyPostMediaInput["role"]) {
    if (!acceptedMimeTypes.has(file.type)) {
      throw new Error("Use a JPEG, PNG, or WebP image.");
    }

    if (file.size > BEAUTY_IMAGE_LIMIT) {
      throw new Error(`Image must be ${formatBytes(BEAUTY_IMAGE_LIMIT)} or smaller.`);
    }

    let previewUrl: string | null = null;
    let uploadedPath: string | null = null;

    try {
      const processed = await processBeautyImage(file);
      previewUrl = URL.createObjectURL(processed.file);
      rememberObjectUrl(previewUrl);
      const session = await getBeautyMediaUploadSessionAction(role);
      uploadedPath = session.path;

      await uploadToSupabase({
        accessToken: session.accessToken,
        anonKey: session.anonKey,
        blob: processed.file,
        bucket: session.bucket,
        onProgress: setUploadProgress,
        path: session.path,
        supabaseUrl: session.supabaseUrl,
      });

      return {
        bytes: processed.file.size,
        height: processed.height,
        id: crypto.randomUUID(),
        mimeType: processed.file.type,
        objectPath: session.path,
        previewUrl,
        role,
        width: processed.width,
      } satisfies UploadedBeautyMedia;
    } catch (error) {
      if (previewUrl && objectUrlsRef.current.has(previewUrl)) {
        URL.revokeObjectURL(previewUrl);
        objectUrlsRef.current.delete(previewUrl);
      }

      if (uploadedPath) {
        try {
          await deleteBeautyMediaAction(uploadedPath);
        } catch {
          // Keep the original upload error visible to the customer.
        }
      }

      throw error;
    }
  }

  async function addNormalFiles(files: FileList | null) {
    const selected = Array.from(files ?? []).slice(0, 4 - normalMedia.length);

    if (selected.length === 0) {
      return;
    }

    setComposerError("");
    setUploading(true);
    setUploadProgress(0);

    const uploaded: UploadedBeautyMedia[] = [];

    try {
      for (const file of selected) {
        uploaded.push(await uploadBeautyFile(file, "image"));
      }

      setNormalMedia((current) => [...current, ...uploaded].slice(0, 4));
    } catch (error) {
      uploaded.forEach(releaseMedia);
      setComposerError(
        error instanceof Error ? error.message : "Upload failed.",
      );
    } finally {
      setUploading(false);
      setUploadProgress(0);

      if (normalFileInputRef.current) {
        normalFileInputRef.current.value = "";
      }
    }
  }

  async function replaceBeforeAfterFile(
    file: File | null,
    role: "after" | "before",
  ) {
    if (!file) {
      return;
    }

    setComposerError("");
    setUploading(true);
    setUploadProgress(0);

    try {
      const uploaded = await uploadBeautyFile(file, role);

      if (role === "before") {
        releaseMedia(beforeMedia);
        setBeforeMedia(uploaded);
      } else {
        releaseMedia(afterMedia);
        setAfterMedia(uploaded);
      }
    } catch (error) {
      setComposerError(
        error instanceof Error ? error.message : "Upload failed.",
      );
    } finally {
      setUploading(false);
      setUploadProgress(0);

      if (beforeInputRef.current) {
        beforeInputRef.current.value = "";
      }
      if (afterInputRef.current) {
        afterInputRef.current.value = "";
      }
    }
  }

  function removeNormalMedia(media: UploadedBeautyMedia) {
    releaseMedia(media);
    setNormalMedia((current) => current.filter((item) => item.id !== media.id));
  }

  function selectVisitCandidate(candidate: BeautyRecentVisitCandidate) {
    const staffOptions = candidate.staffId && candidate.staffName
      ? [{ staffId: candidate.staffId, staffName: candidate.staffName }]
      : [];

    setAttribution({
      salonId: candidate.salonId,
      salonName: candidate.salonName,
      source: "recent_visit_suggestion",
      staffId: candidate.staffId,
      staffName: candidate.staffName,
      staffOptions,
    });
    setSalonQuery(candidate.salonName);
    setSalonResults([]);
    setManualSalonSearchOpen(false);
  }

  function selectSalonResult(salon: BeautyAttributionSalon) {
    setAttribution({
      salonId: salon.salonId,
      salonName: salon.salonName,
      source: "customer_claimed",
      staffId: null,
      staffName: null,
      staffOptions: salon.staff,
    });
    setSalonQuery(salon.salonName);
    setSalonResults([]);
    setManualSalonSearchOpen(true);
  }

  function updateSelectedStaff(staffId: string) {
    setAttribution((current) => {
      if (!current) {
        return current;
      }

      const selectedStaff = current.staffOptions.find(
        (staff) => staff.staffId === staffId,
      );

      return {
        ...current,
        staffId: selectedStaff?.staffId ?? null,
        staffName: selectedStaff?.staffName ?? null,
      };
    });
  }

  function publishPost() {
    if (composerBusy || publishingRef.current) {
      return;
    }

    setComposerError("");

    const media = currentComposerMedia.map((item) => ({
      bytes: item.bytes,
      height: item.height,
      mimeType: item.mimeType,
      objectPath: item.objectPath,
      role: item.role,
      width: item.width,
    }));

    if (composerMode === "regular" && !caption.trim() && media.length === 0) {
      setComposerError("Write a caption or add a photo.");
      return;
    }

    if (composerMode === "before_after") {
      if (!beforeMedia || !afterMedia) {
        setComposerError("Add one before image and one after image.");
        return;
      }

      if (!attribution) {
        setComposerError("Choose the salon for this Before & After.");
        return;
      }
    }

    publishingRef.current = true;

    startPublishing(async () => {
      try {
        const result = await createBeautyPostAction({
          attributionSource: attribution?.source,
          caption,
          media,
          postType: composerMode,
          salonId: attribution?.salonId ?? null,
          staffId: attribution?.staffId ?? null,
        });

        if (result.error !== null) {
          setComposerError(result.error);
          return;
        }

        const newestPost = result.timeline.items[0];
        const newestVerification = newestPost?.verification;

        setPosts(result.timeline.items);
        setCursor(result.timeline.nextCursor);
        setHasMore(result.timeline.hasMore);
        setTimelineError(result.timeline.error ?? "");
        setSuccessNotice(
          composerMode === "before_after"
            ? newestVerification?.state === "verified"
              ? "Before & After published with a verified visit. Salon approval is pending."
              : "Before & After published. Salon approval and visit verification are pending."
            : "Beauty moment shared.",
        );
        resetComposer(false);
        setComposerOpen(false);
      } finally {
        publishingRef.current = false;
      }
    });
  }

  function updatePostCaption(postId: string, nextCaption: string | null) {
    setPosts((current) =>
      current.map((post) =>
        post.id === postId ? { ...post, caption: nextCaption } : post,
      ),
    );
  }

  function updatePostCommentCount(postId: string, commentCount: number) {
    setPosts((current) => {
      const hasChange = current.some(
        (post) => post.id === postId && post.commentCount !== commentCount,
      );

      return hasChange
        ? current.map((post) =>
            post.id === postId ? { ...post, commentCount } : post,
          )
        : current;
    });
  }

  function removeDeletedPost(postId: string) {
    setPosts((current) => current.filter((post) => post.id !== postId));
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-3 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <section className="overflow-hidden rounded-[1.35rem] bg-surface shadow-[0_16px_44px_rgba(35,25,22,0.045)] ring-1 ring-divider-subtle/80">
          <div className="relative min-h-[13.5rem] overflow-hidden bg-[linear-gradient(135deg,var(--brand-orange),var(--brand-teal))] sm:min-h-[15.5rem]">
            {profile.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${profile.displayName} Beauty cover`}
                className="absolute inset-0 h-full w-full object-cover"
                src={profile.coverImageUrl}
              />
            ) : (
              <div className="absolute inset-0 bg-[linear-gradient(135deg,var(--brand-orange),var(--brand-teal))]" />
            )}
            <div
              aria-hidden
              className="absolute inset-0 bg-[linear-gradient(to_top,rgba(23,19,22,0.74),rgba(23,19,22,0.32)_48%,rgba(23,19,22,0.04))]"
            />
            {profile.isSelf ? (
              <button
                aria-label="Edit Beauty profile"
                className="absolute right-3 top-3 z-20 min-h-9 rounded-full bg-white/90 px-3 text-xs font-extrabold text-text-primary shadow-sm ring-1 ring-white/65 backdrop-blur transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                onClick={openProfileEditor}
                ref={profileEditButtonRef}
                type="button"
              >
                Edit
              </button>
            ) : null}
            <div className="absolute inset-x-0 bottom-0 z-10 flex items-end gap-3 px-4 pb-4 sm:gap-4 sm:px-5 sm:pb-5">
              <ProfileAvatar
                className="h-20 w-20 border-4 border-white text-lg shadow-[0_18px_38px_rgba(23,19,22,0.26)] sm:h-24 sm:w-24"
                profile={profile}
              />
              <div className="min-w-0 pb-1">
                <h1 className="truncate text-2xl font-extrabold text-white drop-shadow-sm">
                  {profile.displayName}
                </h1>
                {profile.bio ? (
                  <p className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-white/88 drop-shadow-sm">
                    {profile.bio}
                  </p>
                ) : profile.isSelf ? (
                  <p className="mt-1 text-sm font-semibold text-white/78 drop-shadow-sm">
                    Add a Beauty bio
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {profile.isSelf ? (
          <section className="overflow-hidden rounded-[1.25rem] bg-surface shadow-[0_14px_36px_rgba(35,25,22,0.04)] ring-1 ring-divider-subtle/75">
            <button
              className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-left transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand-orange sm:px-5"
              onClick={() => openComposer("regular")}
              type="button"
            >
              <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-brand-orange-soft text-sm font-extrabold text-brand-orange ring-1 ring-brand-orange/10">
                {profile.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={`${profile.displayName} profile`}
                    className="h-full w-full object-cover"
                    src={profile.avatarUrl}
                  />
                ) : (
                  profile.initials
                )}
              </span>
              <span>
                <span className="block text-base font-extrabold text-text-primary">
                  Share a beauty moment...
                </span>
                <span className="mt-0.5 block text-xs font-semibold text-text-secondary">
                  Photos, captions, or a real salon transformation.
                </span>
              </span>
            </button>
            <div className="grid grid-cols-2 border-t border-divider-subtle/70">
              <button
                className="min-h-12 text-sm font-extrabold text-text-primary transition hover:bg-brand-orange-soft hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand-orange"
                onClick={() => openComposer("regular")}
                type="button"
              >
                Photo
              </button>
              <button
                className="min-h-12 border-l border-divider-subtle/70 bg-brand-teal-soft/70 text-sm font-extrabold text-brand-teal transition hover:bg-brand-teal-soft focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand-teal"
                onClick={() => openComposer("before_after")}
                type="button"
              >
                <span className="block">Before & After</span>
                <span className="block text-[11px] font-bold text-brand-teal/80">
                  Transformation
                </span>
              </button>
            </div>
          </section>
        ) : null}

        {successNotice ? (
          <p
            aria-live="polite"
            className="rounded-2xl bg-brand-teal-soft px-4 py-3 text-sm font-extrabold text-brand-teal ring-1 ring-brand-teal/15"
          >
            {successNotice}
          </p>
        ) : null}

        <section className="grid gap-4" aria-label="Beauty timeline">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-extrabold text-text-primary">
                Moments & Transformations
              </h2>
            </div>
            {posts.length > 0 ? (
              <div
                aria-label="Filter Beauty posts"
                className="grid grid-cols-2 gap-1 rounded-full bg-surface p-1 shadow-sm ring-1 ring-divider-subtle/70"
                role="tablist"
              >
                {timelineFilters.map((filter) => (
                  <button
                    aria-selected={activeFilter === filter.id}
                    className={classNames(
                      "min-h-9 rounded-full px-3 text-sm font-extrabold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
                      activeFilter === filter.id
                        ? "bg-brand-orange text-white shadow-sm"
                        : "text-text-secondary hover:bg-brand-orange-soft hover:text-text-primary",
                    )}
                    key={filter.id}
                    onClick={() => setActiveFilter(filter.id)}
                    role="tab"
                    type="button"
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {posts.length === 0 ? (
            <div className="overflow-hidden rounded-[1.35rem] bg-surface p-5 text-center shadow-[0_18px_52px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle/80">
              <div className="mx-auto flex h-24 w-36 items-center justify-center">
                <span className="grid h-20 w-20 place-items-center rounded-full bg-brand-orange-soft text-xs font-extrabold uppercase text-brand-orange ring-1 ring-brand-orange/15">
                  Before
                </span>
                <span className="-ml-5 grid h-20 w-20 place-items-center rounded-full bg-brand-teal-soft text-xs font-extrabold uppercase text-brand-teal ring-1 ring-brand-teal/15">
                  After
                </span>
              </div>
              <h3 className="mt-5 text-xl font-extrabold text-text-primary">
                Start your Beauty Story
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-text-secondary">
                Share a look you love, your latest style, or a real Before & After transformation.
              </p>
              {profile.isSelf ? (
                <div className="mt-5 grid justify-items-center gap-2">
                  <button
                    className="min-h-11 rounded-full bg-brand-orange px-5 text-sm font-extrabold text-white shadow-sm transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                    onClick={() => openComposer("regular")}
                    type="button"
                  >
                    Create your first Beauty post
                  </button>
                  <button
                    className="min-h-10 px-3 text-sm font-extrabold text-brand-teal transition hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
                    onClick={() => openComposer("before_after")}
                    type="button"
                  >
                    Try Before & After
                  </button>
                </div>
              ) : null}
            </div>
          ) : visiblePosts.length === 0 ? (
            <div className="rounded-[1.35rem] bg-surface p-5 text-center shadow-sm ring-1 ring-divider-subtle/80">
              <h3 className="text-lg font-extrabold text-text-primary">
                No Before & After posts yet
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm font-semibold leading-6 text-text-secondary">
                Transformations will collect here as they are shared.
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {visiblePosts.map((post) => (
                <PostCard
                  canManage={profile.isSelf && post.profileId === profile.id}
                  commentViewer={commentViewer}
                  key={post.id}
                  onCaptionUpdated={updatePostCaption}
                  onCommentCountChange={updatePostCommentCount}
                  onDeleted={removeDeletedPost}
                  post={post}
                />
              ))}
            </div>
          )}

          {timelineError ? (
            <div className="grid gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
              <p>{timelineError}</p>
              <button
                className="w-fit rounded-full bg-red-700 px-4 py-2 text-sm font-extrabold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                onClick={() => void loadMorePosts()}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : null}

          {loadingMore ? (
            <div className="grid gap-4" aria-label="Loading more Beauty posts">
              <div className="h-[26rem] animate-pulse rounded-[1.35rem] bg-white shadow-sm ring-1 ring-divider-subtle/70" />
              <div className="h-32 animate-pulse rounded-[1.35rem] bg-white shadow-sm ring-1 ring-divider-subtle/70" />
            </div>
          ) : null}

          <div ref={sentinelRef} />

          {!hasMore && posts.length > 0 ? (
            <p className="py-4 text-center text-sm font-bold text-text-muted">
              You are all caught up
            </p>
          ) : null}
        </section>
      </div>

      {profileEditorOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/45 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-6 sm:py-6">
          <button
            aria-label="Close Beauty profile editor"
            className="absolute inset-0 cursor-default"
            onClick={closeProfileEditor}
            type="button"
          />
          <form
            aria-describedby="beauty-profile-editor-description"
            aria-labelledby="beauty-profile-editor-title"
            aria-modal="true"
            className="relative flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-[0_24px_80px_rgba(23,19,22,0.22)] sm:max-h-[90vh] sm:max-w-xl sm:rounded-2xl"
            onSubmit={saveBeautyProfile}
            ref={profileEditorDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="flex min-h-16 items-start justify-between gap-3 border-b border-border-subtle px-4 py-4 sm:px-5">
              <div>
                <h2
                  className="text-lg font-extrabold text-text-primary"
                  id="beauty-profile-editor-title"
                >
                  Beauty profile
                </h2>
                <p
                  className="mt-0.5 text-xs font-semibold leading-5 text-text-secondary"
                  id="beauty-profile-editor-description"
                >
                  Shape the public look of your Beauty profile.
                </p>
              </div>
              <button
                className="min-h-10 rounded-full px-3 text-sm font-bold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                disabled={profileEditorBusy}
                onClick={closeProfileEditor}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overscroll-contain overflow-auto px-4 py-4 sm:px-5">
              <div className="grid gap-5">
                <section className="grid gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase text-text-secondary">
                      Cover
                    </p>
                    <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
                      A shallow image that sets the tone of your Beauty profile.
                    </p>
                  </div>
                  <div className="relative aspect-[3.35/1] overflow-hidden rounded-2xl bg-brand-orange-soft ring-1 ring-divider-subtle/80">
                    {displayedCoverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={`${profile.displayName} Beauty cover preview`}
                        className="h-full w-full object-cover"
                        src={displayedCoverUrl}
                      />
                    ) : (
                      <div className="h-full w-full bg-[linear-gradient(135deg,var(--brand-orange-soft),var(--surface-muted))]" />
                    )}
                  </div>
                  <input
                    accept={BEAUTY_ALLOWED_IMAGE_TYPES.join(",")}
                    className="sr-only"
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      void uploadCoverImage(event.currentTarget.files?.[0] ?? null)
                    }
                    ref={coverInputRef}
                    type="file"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="min-h-10 rounded-full bg-surface-muted px-4 text-sm font-extrabold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60"
                      disabled={profileEditorBusy}
                      onClick={() => coverInputRef.current?.click()}
                      type="button"
                    >
                      Replace cover
                    </button>
                    <button
                      className="min-h-10 rounded-full px-4 text-sm font-extrabold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={profileEditorBusy || !displayedCoverUrl}
                      onClick={removeCoverImage}
                      type="button"
                    >
                      Remove cover
                    </button>
                  </div>
                </section>

                <section className="grid gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase text-text-secondary">
                      Profile photo
                    </p>
                    <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
                      Uses your ReyLUMI account profile photo.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-orange-soft text-lg font-extrabold text-brand-orange ring-1 ring-brand-orange/15">
                      {displayedAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={`${profile.displayName} profile photo preview`}
                          className="h-full w-full object-cover"
                          src={displayedAvatarUrl}
                        />
                      ) : (
                        profile.initials
                      )}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <input
                        accept={ACCOUNT_AVATAR_ALLOWED_IMAGE_TYPES.join(",")}
                        className="sr-only"
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          void uploadAvatarImage(
                            event.currentTarget.files?.[0] ?? null,
                          )
                        }
                        ref={avatarInputRef}
                        type="file"
                      />
                      <button
                        className="min-h-10 rounded-full bg-surface-muted px-4 text-sm font-extrabold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60"
                        disabled={profileEditorBusy}
                        onClick={() => avatarInputRef.current?.click()}
                        type="button"
                      >
                        Replace photo
                      </button>
                      <button
                        className="min-h-10 rounded-full px-4 text-sm font-extrabold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={profileEditorBusy || !displayedAvatarUrl}
                        onClick={removeAvatarImage}
                        type="button"
                      >
                        Remove photo
                      </button>
                    </div>
                  </div>
                </section>

                <label className="grid gap-1.5">
                  <span className="text-xs font-bold uppercase text-text-secondary">
                    Beauty bio
                  </span>
                  <textarea
                    className="min-h-24 rounded-2xl border border-border-subtle bg-surface-muted px-3 py-2 text-sm font-semibold text-text-primary outline-none transition placeholder:text-text-muted focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                    maxLength={500}
                    onChange={(event) => setProfileDraftBio(event.currentTarget.value)}
                    placeholder="Soft glam, nail art, fresh color..."
                    value={profileDraftBio}
                  />
                  <span className="text-right text-xs font-bold text-text-muted">
                    {profileDraftBio.length}/500
                  </span>
                </label>

                <section className="grid gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase text-text-secondary">
                      Profile visibility
                    </p>
                    <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
                      Private hides you from discovery and keeps Beauty content
                      hidden from salons.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      {
                        description:
                          "Anyone on ReyLUMI can view your Beauty profile.",
                        label: "Public",
                        value: "public" as const,
                      },
                      {
                        description:
                          "Hidden from discovery. Salons can only see that it is private.",
                        label: "Private",
                        value: "self" as const,
                      },
                    ].map((option) => {
                      const selected = profileDraftVisibility === option.value;

                      return (
                        <button
                          aria-pressed={selected}
                          className={classNames(
                            "grid gap-1 rounded-2xl border px-4 py-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-60",
                            selected
                              ? "border-brand-orange bg-brand-orange-soft text-brand-orange"
                              : "border-border-subtle bg-surface-muted text-text-primary hover:border-brand-orange/50",
                          )}
                          disabled={profileEditorBusy}
                          key={option.value}
                          onClick={() => setProfileDraftVisibility(option.value)}
                          type="button"
                        >
                          <span className="text-sm font-extrabold">
                            {option.label}
                          </span>
                          <span className="text-xs font-semibold leading-5 text-text-secondary">
                            {option.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {profileUpload ? (
                  <p
                    aria-live="polite"
                    className="rounded-2xl border border-brand-orange/20 bg-brand-orange-soft px-3 py-2 text-sm font-extrabold text-brand-orange"
                  >
                    Uploading {profileUpload}
                    {profileUploadProgress ? ` ${profileUploadProgress}%` : "..."}
                  </p>
                ) : null}

                {profileEditorError ? (
                  <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                    {profileEditorError}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-border-subtle px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:flex-row sm:justify-end sm:px-5 sm:py-4">
              <button
                className="min-h-11 w-full rounded-full border border-border-subtle px-4 text-sm font-extrabold text-text-primary sm:w-auto"
                disabled={profileEditorBusy}
                onClick={closeProfileEditor}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-11 w-full rounded-full bg-brand-orange px-5 text-sm font-extrabold text-white disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                disabled={profileEditorBusy}
                type="submit"
              >
                {savingProfile ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {composerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/45 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-6 sm:py-6">
          <button
            aria-label="Close composer"
            className="absolute inset-0 cursor-default"
            onClick={closeComposer}
            type="button"
          />
          <div
            aria-describedby="beauty-composer-description"
            aria-labelledby="beauty-composer-title"
            aria-modal="true"
            className="relative flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-[0_24px_80px_rgba(23,19,22,0.22)] sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl"
            ref={composerDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="flex min-h-16 items-start justify-between gap-3 border-b border-border-subtle px-4 py-4 sm:px-5">
              <div>
                <h2
                  className="text-lg font-extrabold text-text-primary"
                  id="beauty-composer-title"
                >
                  {composerTitle}
                </h2>
                <p
                  className="mt-0.5 text-xs font-semibold leading-5 text-text-secondary"
                  id="beauty-composer-description"
                >
                  {composerDescription}
                </p>
              </div>
              <button
                className="min-h-10 rounded-full px-3 text-sm font-bold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                disabled={composerBusy}
                onClick={closeComposer}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overscroll-contain overflow-auto px-4 py-4 sm:px-5">
              <div className="grid gap-5">
                {composerMode === "regular" ? (
                  <>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-bold uppercase text-text-secondary">
                        Caption
                      </span>
                      <textarea
                        className="min-h-28 rounded-2xl border border-border-subtle bg-surface-muted px-3 py-2 text-sm font-semibold text-text-primary outline-none transition placeholder:text-text-muted focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                        maxLength={2200}
                        onChange={(event) => setCaption(event.currentTarget.value)}
                        placeholder="What changed, what you loved, or how it feels..."
                        value={caption}
                      />
                    </label>
                    <div className="grid gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase text-text-secondary">
                          Photos
                        </p>
                        <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
                          Add up to four images.
                        </p>
                      </div>
                      <input
                        accept={BEAUTY_ALLOWED_IMAGE_TYPES.join(",")}
                        className="sr-only"
                        multiple
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          void addNormalFiles(event.currentTarget.files)
                        }
                        ref={normalFileInputRef}
                        type="file"
                      />
                      <button
                        className="min-h-28 rounded-2xl border border-dashed border-border-subtle bg-surface-muted px-4 text-sm font-extrabold text-text-secondary transition hover:border-brand-orange/40 hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={composerBusy || normalMedia.length >= 4}
                        onClick={() => normalFileInputRef.current?.click()}
                        type="button"
                      >
                        {normalMedia.length >= 4
                          ? "Photo limit reached"
                          : "Add photos"}
                      </button>
                      {normalMedia.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {normalMedia.map((media) => (
                            <div
                              className="relative aspect-square overflow-hidden rounded-2xl bg-surface-muted"
                              key={media.id}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                alt="Selected Beauty post preview"
                                className="h-full w-full object-cover"
                                src={media.previewUrl}
                              />
                              <button
                                aria-label="Remove photo"
                                className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-sm font-extrabold text-text-primary shadow-sm"
                                disabled={composerBusy}
                                onClick={() => removeNormalMedia(media)}
                                type="button"
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <section className="grid gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase text-brand-teal">
                          Transformation
                        </p>
                        <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
                          Add one Before image and one After image.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:gap-3">
                        {[
                          {
                            inputRef: beforeInputRef,
                            label: "Before",
                            media: beforeMedia,
                            role: "before" as const,
                          },
                          {
                            inputRef: afterInputRef,
                            label: "After",
                            media: afterMedia,
                            role: "after" as const,
                          },
                        ].map((slot) => (
                          <div className="grid gap-2" key={slot.role}>
                            <input
                              accept={BEAUTY_ALLOWED_IMAGE_TYPES.join(",")}
                              className="sr-only"
                              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                void replaceBeforeAfterFile(
                                  event.currentTarget.files?.[0] ?? null,
                                  slot.role,
                                )
                              }
                              ref={slot.inputRef}
                              type="file"
                            />
                            <button
                              className="relative aspect-[4/5] max-h-56 overflow-hidden rounded-2xl border border-dashed border-border-subtle bg-surface-muted text-sm font-extrabold text-text-secondary transition hover:border-brand-orange/40 hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-60 sm:max-h-none"
                              disabled={composerBusy}
                              onClick={() => slot.inputRef.current?.click()}
                              type="button"
                            >
                              {slot.media ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  alt={`${slot.label} preview`}
                                  className="h-full w-full object-cover"
                                  src={slot.media.previewUrl}
                                />
                              ) : (
                                slot.label
                              )}
                              <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-extrabold uppercase text-text-primary shadow-sm">
                                {slot.label}
                              </span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>

                    <label className="grid gap-1.5">
                      <span className="text-xs font-bold uppercase text-text-secondary">
                        Caption
                      </span>
                      <textarea
                        className="min-h-24 rounded-2xl border border-border-subtle bg-surface-muted px-3 py-2 text-sm font-semibold text-text-primary outline-none transition placeholder:text-text-muted focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                        maxLength={2200}
                        onChange={(event) => setCaption(event.currentTarget.value)}
                        placeholder="Optional: what changed or how it feels..."
                        value={caption}
                      />
                    </label>

                    <section className="grid gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase text-text-secondary">
                          Where was this done?
                        </p>
                        <p className="mt-1 text-sm font-semibold leading-6 text-text-secondary">
                          Verified salon transformations may qualify for Beauty rewards.
                        </p>
                      </div>

                      {visitCandidates.length > 0 && !manualSalonSearchOpen ? (
                        <div className="grid gap-2">
                          <p className="text-sm font-extrabold text-text-primary">
                            Was this from a recent visit?
                          </p>
                          <div className="grid gap-2">
                            {visitCandidates.slice(0, 4).map((candidate) => (
                              <button
                                className={classNames(
                                  "rounded-2xl px-3 py-3 text-left text-sm ring-1 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal",
                                  attribution?.salonId === candidate.salonId &&
                                    attribution.source ===
                                      "recent_visit_suggestion"
                                    ? "bg-brand-teal-soft text-brand-teal ring-brand-teal/35"
                                    : "bg-surface-muted text-text-primary ring-divider-subtle hover:ring-brand-teal/35",
                                )}
                                disabled={composerBusy}
                                key={candidate.visitKey}
                                onClick={() => selectVisitCandidate(candidate)}
                                type="button"
                              >
                                <span className="block font-extrabold">
                                  {candidate.salonName}
                                </span>
                                <span className="mt-1 block font-semibold text-text-secondary">
                                  {sourceLabel(candidate.source)} -{" "}
                                  {formatVisitDate(candidate.occurredAt)}
                                  {candidate.staffName
                                    ? ` with ${candidate.staffName}`
                                    : ""}
                                </span>
                              </button>
                            ))}
                          </div>
                          <button
                            className="w-fit rounded-full bg-surface-muted px-4 py-2 text-sm font-extrabold text-text-primary ring-1 ring-divider-subtle transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                            disabled={composerBusy}
                            onClick={() => {
                              setManualSalonSearchOpen(true);
                              setSalonQuery("");
                              setSalonResults([]);
                            }}
                            type="button"
                          >
                            Choose another salon
                          </button>
                        </div>
                      ) : null}

                      {manualSalonSearchOpen ? (
                        <div className="grid gap-2">
                          <label className="grid gap-1.5">
                            <span className="text-xs font-bold uppercase text-text-secondary">
                              Salon
                            </span>
                            <input
                              className="min-h-12 rounded-2xl border border-border-subtle bg-surface-muted px-3 text-sm font-semibold text-text-primary outline-none transition focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                              onChange={(event) =>
                                updateSalonQuery(event.currentTarget.value)
                              }
                              placeholder="Search salon"
                              value={salonQuery}
                            />
                          </label>
                          {searchingSalons ? (
                            <p className="text-sm font-semibold text-text-secondary">
                              Searching...
                            </p>
                          ) : null}
                          {salonResults.length > 0 ? (
                            <div className="grid gap-2">
                              {salonResults.map((salon) => (
                                <button
                                  className="rounded-2xl bg-surface-muted px-3 py-3 text-left text-sm ring-1 ring-divider-subtle transition hover:ring-brand-orange/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                                  key={salon.salonId}
                                  onClick={() => selectSalonResult(salon)}
                                  type="button"
                                >
                                  <span className="block font-extrabold text-text-primary">
                                    {salon.salonName}
                                  </span>
                                  {[salon.city, salon.state].filter(Boolean)
                                    .length > 0 ? (
                                    <span className="mt-1 block font-semibold text-text-secondary">
                                      {[salon.city, salon.state]
                                        .filter(Boolean)
                                        .join(", ")}
                                    </span>
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {attribution ? (
                        <div className="grid gap-3 rounded-2xl bg-brand-teal-soft p-3 ring-1 ring-brand-teal/20">
                          <p className="text-sm font-extrabold text-brand-teal">
                            {attribution.salonName}
                            {attribution.staffName
                              ? ` with ${attribution.staffName}`
                              : ""}
                          </p>
                          {attribution.source === "customer_claimed" &&
                          selectedStaffOptions.length > 0 ? (
                            <label className="grid gap-1.5">
                              <span className="text-xs font-bold uppercase text-brand-teal">
                                Professional
                              </span>
                              <select
                                className="min-h-11 rounded-xl border border-brand-teal/20 bg-white px-3 text-sm font-semibold text-text-primary"
                                onChange={(event) =>
                                  updateSelectedStaff(event.currentTarget.value)
                                }
                                value={attribution.staffId ?? ""}
                              >
                                <option value="">No specific professional</option>
                                {selectedStaffOptions.map((staff) => (
                                  <option key={staff.staffId} value={staff.staffId}>
                                    {staff.staffName}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                        </div>
                      ) : null}
                    </section>
                  </>
                )}

                {uploading ? (
                  <p className="rounded-2xl border border-brand-orange/20 bg-brand-orange-soft px-3 py-2 text-sm font-extrabold text-brand-orange">
                    Uploading{uploadProgress ? ` ${uploadProgress}%` : "..."}
                  </p>
                ) : null}

                {composerError ? (
                  <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">
                    {composerError}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 border-t border-border-subtle px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:flex-row sm:justify-end sm:px-5 sm:py-4">
              <button
                className="min-h-11 w-full rounded-full border border-border-subtle px-4 text-sm font-extrabold text-text-primary sm:w-auto"
                disabled={composerBusy}
                onClick={closeComposer}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-11 w-full rounded-full bg-brand-orange px-5 text-sm font-extrabold text-white shadow-sm transition hover:bg-brand-orange-hover disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                disabled={composerBusy}
                onClick={publishPost}
                type="button"
              >
                {publishing ? "Publishing..." : "Publish"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
