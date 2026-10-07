"use client";
import {SalonTrustLine,SalonVerifiedBadge} from "@/components/salon-trust-line";
import {salonPopularPrice} from "@/lib/salon-identity";
import { salonAboutParagraphs, visibleSalonPosts } from "@/lib/salon-profile-content";
import { isDefaultNailImage } from "@/lib/default-nail-images";
import { NailIllustrationCredit } from "@/components/nail-illustration-credit";
import { useCloseOnNavigation } from "@/components/overlay-dismissal";
import { PostActions } from "./post-actions";
import { ServiceMenu } from "./service-menu";
import { TeamMenu } from "./team-menu";

import { SalonProfilePreferencesPanel } from "@/app/settings/salon-profile-preferences-panel";
import { OperatingHoursQuick } from "./operating-hours-quick";
import { OperatingHoursDisplay } from "./operating-hours-display";
import { SalonWebsiteHome, WebsiteServices, WebsiteTeam } from "./salon-website-home";
import { SalonWebsiteHeader } from "./salon-website-header";
import websitePageStyles from "./salon-website-header.module.css";
import { DEFAULT_PROFILE_PREFERENCES, type SalonProfilePreferences } from "@/lib/salon-profile-preferences";
import { InspirationAvailability } from "@/components/inspiration-availability";
import {
  createSalonProfileReviewReplyAction,
  createSalonProfileSocialPostAction,
  deleteSalonProfileLookDirectAction,
  getSalonProfileMediaUploadSessionAction,
  setSalonProfilePublicationAction,
  setSalonProfileLookStatusDirectAction,
  toggleSalonFollowAction,
  toggleSalonLookSaveAction,
  updateSalonProfileIdentityAction,
  updateSalonProfileIdentityMediaAction,
} from "@/app/salon-profile/actions";
import { PostCommentThread } from "@/app/post-comments/post-comment-thread";
import { ExploreBookButton } from "@/components/explore-account-actions";
import { SavePostButton } from "@/app/saved-post/save-post-button";
import { AuthIntentPrompt } from "@/components/auth-intent-prompt";
import { BeforeAfterCompare } from "@/components/before-after-compare";
import {
  LumiTrustSpark,
} from "@/components/reylumi-trust";
import {
  SALON_PROFILE_ALLOWED_IMAGE_TYPES,
  SALON_PROFILE_IMAGE_LIMITS,
  type SalonProfileMediaKind,
} from "@/lib/salon-profile-media";
import { buildReylumiTrustSummary } from "@/lib/reylumi-trust";
import { mergePublishedItems } from "@/lib/salon-profile-published";
import { searchTextMatches } from "@/lib/search-normalization";
import {
  formatSalonProfileTeamCount,
  formatSalonProfileTeamOverflowLabel,
  getSalonProfileTeamPreview,
} from "@/lib/salon-profile-team";
import type {
  ProfileFeedItem,
  PublicSalonProfileBeautyPost,
  PublicSalonProfileData,
  PublicSalonProfileExperience,
  PublicSalonProfileLook,
  PublicSalonProfileStaff,
  PublicSalonProfileService,
  SalonProfileReadiness,
  SalonProfileSetting,
  SalonProfileViewerCapabilities,
} from "@/types/salon-profile";
import type {
  PostCommentTarget,
  PostCommentViewer,
} from "@/types/post-comments";
import { useRouter, usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ButtonHTMLAttributes,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

const ProfilePreferencesContext = createContext<SalonProfilePreferences>(DEFAULT_PROFILE_PREFERENCES);

function ProfileSavePostButton(props: Parameters<typeof SavePostButton>[0]) {
  const preferences = useContext(ProfilePreferencesContext);
  const pathname=usePathname();
  return preferences.allow_saves || pathname?.startsWith('/explore') ? <SavePostButton {...props} /> : null;
}
function ProfilePostCommentThread(props: Parameters<typeof PostCommentThread>[0]) {
  const preferences = useContext(ProfilePreferencesContext);
  return preferences.allow_comments ? <PostCommentThread {...props} /> : <p className="text-xs text-zinc-500">Comments are disabled for this salon.</p>;
}

type SalonProfileViewProps = {
  capabilities?: SalonProfileViewerCapabilities;
  data: PublicSalonProfileData;
  error?: string;
  manageData?: {
    ownedLookIds?: string[];
    publicHref: string;
    readiness: SalonProfileReadiness;
    setting: SalonProfileSetting;
  };
  notice?: string;
};

type TabId =
  | "about"
  | "discover"
  | "experiences"
  | "gallery"
  | "services"
  | "team";

type AuthPromptIntent = "follow" | "save";
type ComposerType = "auto" | "look" | "opening" | "update";
type SalonProfileUploadableKind = Extract<
  SalonProfileMediaKind,
  "cover" | "logo" | "look" | "update"
>;
type BookingContext = {
  startAt?: string | null;
  lookId?: string | null;
  note?: string | null;
  serviceId?: string | null;
  staffId?: string | null;
  title: string;
  updateId?: string | null;
} | null;

type TimelineItem =
  | { id: string; item: ProfileFeedItem; publishedAt: string | null; type: "post" }
  | {
      id: string;
      posts: PublicSalonProfileBeautyPost[];
      publishedAt: string | null;
      type: "shared";
    };

type GalleryItem =
  | {
      id: string;
      imageUrl: string;
      item: ProfileFeedItem;
      publishedAt: string | null;
      title: string;
      type: "feed";
    }
  | {
      id: string;
      imageUrl: string;
      post: PublicSalonProfileBeautyPost;
      publishedAt: string | null;
      title: string;
      type: "beauty";
    };

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "discover", label: "Discover" },
  { id: "gallery", label: "Gallery" },
  { id: "services", label: "Services" },
  { id: "team", label: "Team" },
  { id: "experiences", label: "Experiences" },
  { id: "about", label: "About" },
];

const INITIAL_TIMELINE_ITEM_COUNT = 6;
const TIMELINE_LOAD_STEP = 4;

function tabFromHash(hash: string) {
  const value = hash.replace(/^#/, "");

  if (["reviews","customer-experiences","feedback-good","feedback-issue"].includes(value)) {
    return "experiences";
  }

  if (value === "lumi-trust" || value === "lumi-trust-details") {
    return "experiences";
  }

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
  currentUserId: null,
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

function isAuthIntentMessage(message: string | null | undefined) {
  return /sign in/i.test(message ?? "");
}

function postCommentViewer(
  capabilities: SalonProfileViewerCapabilities,
): PostCommentViewer {
  return {
    canModerate: capabilities.canModerateComments,
    canReplyAsSalon: capabilities.canReplyAsSalon,
    isAuthenticated: capabilities.isAuthenticated,
    userId: capabilities.currentUserId,
  };
}

function profileFeedCommentTarget(
  item: ProfileFeedItem,
  title: string,
): PostCommentTarget {
  return {
    salonId: item.salonId,
    sourceId: item.id,
    sourceType:
      item.contentType === "look"
        ? "salon_profile_look"
        : "salon_profile_update",
    title,
  };
}

function beautyPostCommentTarget(
  post: PublicSalonProfileBeautyPost,
  salonId: string,
): PostCommentTarget {
  return {
    profileId: post.profileId,
    salonId,
    sourceId: post.id,
    sourceType: "beauty_post",
    title: post.caption ?? "Beauty post",
  };
}

function postCommentKey(target: Pick<PostCommentTarget, "sourceId" | "sourceType">) {
  return `${target.sourceType}:${target.sourceId}`;
}

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

function timestampValue(value: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function beautyPostPublishedAt(post: PublicSalonProfileBeautyPost) {
  return post.publishedAt;
}

function buildTimelineItems(input: {
  beautyPosts: PublicSalonProfileBeautyPost[];
  feedItems: ProfileFeedItem[];
}): TimelineItem[] {
  const postItems: TimelineItem[] = input.feedItems.map((item) => ({
    id: `${item.contentType}-${item.id}`,
    item,
    publishedAt: item.publishedAt,
    type: "post",
  }));
  const sharedItems: TimelineItem[] = input.beautyPosts.map((post) => ({
    id: `shared-${post.id}`,
    posts: [post],
    publishedAt: beautyPostPublishedAt(post),
    type: "shared",
  }));

  return [...postItems, ...sharedItems].sort(
    (left, right) =>
      timestampValue(right.publishedAt) - timestampValue(left.publishedAt),
  );
}

function buildGalleryItems(input: {
  beautyPosts: PublicSalonProfileBeautyPost[];
  feedItems: ProfileFeedItem[];
}): GalleryItem[] {
  const feedImages: GalleryItem[] = input.feedItems
    .filter((item) => Boolean(item.imageUrl))
    .map((item) => ({
      id: `${item.contentType}-${item.id}`,
      imageUrl: item.imageUrl ?? "",
      item,
      publishedAt: item.publishedAt,
      title: item.title,
      type: "feed",
    }));
  const beautyImages: GalleryItem[] = input.beautyPosts.flatMap((post) =>
    post.media
      .filter((media) => Boolean(media.url))
      .map((media) => ({
        id: `beauty-${post.id}-${media.id}`,
        imageUrl: media.url ?? "",
        post,
        publishedAt: beautyPostPublishedAt(post),
        title: post.caption ?? `Shared by ${post.authorDisplayName}`,
        type: "beauty",
      })),
  );

  return [...feedImages, ...beautyImages].sort(
    (left, right) =>
      timestampValue(right.publishedAt) - timestampValue(left.publishedAt),
  );
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
  variant?: "primary" | "secondary" | "subtle" | "brand";
}) {
  const styles = {
    brand: "bg-brand-orange text-white hover:bg-brand-orange-hover disabled:bg-brand-orange/50",
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

type TimelineActionIconName =
  | "book"
  | "comment"
  | "love"
  | "open"
  | "share"
  | "timeline";

function TimelineActionIcon({ name }: { name: TimelineActionIconName }) {
  const common = {
    "aria-hidden": true,
    className: "h-4 w-4 shrink-0",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 2,
    viewBox: "0 0 24 24",
  } as const;

  if (name === "book") {
    return (
      <svg {...common}>
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <path d="M3.5 9h17" />
        <path d="M5 4h14a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2Z" />
        <path d="m9 15 2 2 4-5" />
      </svg>
    );
  }

  if (name === "comment") {
    return (
      <svg {...common}>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      </svg>
    );
  }

  if (name === "love") {
    return (
      <svg {...common}>
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
      </svg>
    );
  }

  if (name === "open") {
    return (
      <svg {...common}>
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
        <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
      </svg>
    );
  }

  if (name === "timeline") {
    return (
      <svg {...common}>
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h10" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="m16 6-4-4-4 4" />
      <path d="M12 2v14" />
    </svg>
  );
}

function TimelineActionButton({
  active = false,
  children,
  className = "",
  icon,
  tone = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon: TimelineActionIconName;
  tone?: "default" | "primary";
}) {
  const preferences = useContext(ProfilePreferencesContext);
  if ((icon === "comment" && !preferences.allow_comments) || (icon === "share" && !preferences.allow_sharing) || (icon === "love" && !preferences.allow_saves)) return null;
  return (
    <button
      className={[
        "inline-flex min-h-9 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 px-1.5 py-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:text-zinc-400",
        tone === "primary"
          ? "text-brand-orange hover:bg-brand-orange-soft hover:text-brand-orange"
          : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950",
        active ? "bg-zinc-50 text-zinc-950" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      type="button"
      {...props}
    >
      <TimelineActionIcon name={icon} />
      <span className="min-w-0 truncate">{children}</span>
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
      <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={isDefaultNailImage(coverImageUrl) ? "AI-generated nail-service illustration" : `${name} salon cover`}
        className="absolute inset-0 h-full w-full object-cover"
        src={coverImageUrl}
      />
      <NailIllustrationCredit imageUrl={coverImageUrl} className="absolute right-3 top-3 z-20" />
      </>
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

const subscribeToModalMount = () => () => {};
const getModalClientSnapshot = () => true;
const getModalServerSnapshot = () => false;

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
  useCloseOnNavigation(onClose);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const latestOnCloseRef = useRef(onClose);
  const previousActiveElementRef = useRef<Element | null>(null);
  const titleId = useId();
  const mounted = useSyncExternalStore(
    subscribeToModalMount,
    getModalClientSnapshot,
    getModalServerSnapshot,
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    function fitVisibleViewport() {
      if (!overlayRef.current || !viewport) return;
      overlayRef.current.style.height = `${viewport.height}px`;
      overlayRef.current.style.top = `${viewport.offsetTop}px`;
    }
    fitVisibleViewport();
    viewport.addEventListener("resize", fitVisibleViewport);
    viewport.addEventListener("scroll", fitVisibleViewport);
    return () => {
      viewport.removeEventListener("resize", fitVisibleViewport);
      viewport.removeEventListener("scroll", fitVisibleViewport);
    };
  }, [mounted]);

  useEffect(() => {
    latestOnCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!mounted) return;
    previousActiveElementRef.current = document.activeElement;
    const target = initialFocusRef?.current ?? dialogRef.current;

    target?.focus({ preventScroll: true });

    return () => {
      const previousActiveElement = previousActiveElementRef.current;

      if (previousActiveElement instanceof HTMLElement) {
        previousActiveElement.focus({ preventScroll: true });
      }
    };
  }, [initialFocusRef, mounted]);

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

  return mounted ? createPortal(
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-[100] grid h-[100dvh] min-h-0 min-w-0 overflow-hidden bg-zinc-950/45 p-0 backdrop-blur-sm sm:p-5"
      onKeyDown={onDialogKeyDown}
      ref={overlayRef}
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
          "relative mt-auto grid max-h-full min-h-0 min-w-0 w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:m-auto sm:max-h-[min(92dvh,900px)] sm:max-w-2xl sm:rounded-2xl",
          panelClassName,
        ].join(" ")}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="z-10 flex min-h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 sm:px-5">
          <h2 className="min-w-0 text-base font-semibold text-zinc-950" id={titleId}>
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
        <div className={["min-h-0 min-w-0 overscroll-contain overflow-x-hidden overflow-y-auto p-4 sm:p-5", bodyClassName].join(" ")}>
          {children}
        </div>
        {footer ? (
          <div className="z-10 border-t border-zinc-200 bg-white px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-5 sm:py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  ) : null;
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
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 sm:flex-row sm:justify-end">
          <Button className="w-full sm:w-auto" onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button className="w-full sm:w-auto" type="submit" variant="primary">
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
    <section className="flex min-w-0 items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-sm sm:p-4">
      <Avatar logoUrl={logoUrl} name={name} size="md" />
      <button className="min-h-12 min-w-0 flex-1 rounded-full bg-zinc-100 px-4 text-left text-sm text-zinc-500 transition hover:bg-zinc-200/70 focus-visible:outline-2 focus-visible:outline-brand-orange" onClick={() => onOpen("auto")} type="button">
        Share something with your customers…
      </button>
      <button aria-label="Create a photo post" title="Add a photo" className="grid size-12 shrink-0 place-items-center rounded-full text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-brand-orange" onClick={() => onOpen("look")} type="button">
        <PostPhotoIcon />
      </button>
    </section>
  );
}

function PostPhotoIcon() {
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></svg>;
}

function PostSuggestionField({ label, placeholder, options, value, onChange, allowCustom = false }: {
  label: string; placeholder: string; options: { id: string; label: string }[];
  value: string; onChange: (id: string) => void; allowCustom?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.find((option) => option.id === value);
  const matches = query.trim() ? options.filter((option) => searchTextMatches([option.label], query)).slice(0, 6) : [];
  const open = focused && matches.length > 0;
  function choose(option: { id: string; label: string }) { onChange(option.id); setQuery(""); setFocused(false); }
  return <div className="relative min-w-0">
    <label className="mb-1.5 block text-xs font-medium text-zinc-600" htmlFor={id}>{label}</label>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-suggestions`} aria-activedescendant={open ? `${id}-option-${Math.min(active, matches.length - 1)}` : undefined} autoComplete="off"
      className="min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-base outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/10"
      placeholder={placeholder} value={selected?.label ?? (allowCustom ? value : query)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={(event) => { onChange(allowCustom ? event.currentTarget.value : ""); setQuery(event.currentTarget.value); setActive(0); setFocused(true); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setFocused(false); return; }
        if (!open) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((current) => (current + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length); }
        if (event.key === "Enter") { event.preventDefault(); choose(matches[Math.min(active, matches.length - 1)]); }
      }} />
    {open ? <ul id={`${id}-suggestions`} role="listbox" className="mt-1 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      {matches.map((option, index) => <li id={`${id}-option-${index}`} key={option.id} role="option" aria-selected={index === active}>
        <button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)} className={`w-full px-3 py-2.5 text-left text-sm ${index === active ? "bg-brand-orange-soft text-zinc-900" : "hover:bg-zinc-50"}`}>{option.label}</button>
      </li>)}
    </ul> : null}
    {!allowCustom && focused && query.trim() && !matches.length ? <p className="mt-1 text-xs text-zinc-500">No matching options. You can leave this optional field empty.</p> : null}
  </div>;
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
  onPosted: (result: { post: ProfileFeedItem; look: PublicSalonProfileLook | null }) => void;
}) {
  const captionRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const formId = useId();
  const [caption, setCaption] = useState("");
  const [additionalServiceIds, setAdditionalServiceIds] = useState<string[]>([]);
  const [bookingCtaEnabled, setBookingCtaEnabled] = useState(true);
  const [contentType, setContentType] = useState<ComposerType>(initialType);
  const [durationMinutes, setDurationMinutes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [mood, setMood] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
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

      if (result.error !== null) {
        setError(result.error);
        return;
      }

      onPosted(result);
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

  const primaryLabel = "Post";
  const pendingLabel = contentType === "opening" ? "Sharing" : "Posting";
  const suggestedService = hashtagSuggestionsForServices(caption, data.services);
  const onlineStaff = data.staff.filter((member) => member.onlineBookingEnabled);
  const fieldClass = "min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-3 text-base outline-none focus:border-brand-orange focus:ring-2 focus:ring-brand-orange/10";
  const serviceOptions = data.services.map((service) => ({ id: service.id, label: service.name }));

  return (
    <Modal
      bodyClassName="p-0"
      footer={
        <div className="grid gap-2 sm:flex sm:items-center sm:justify-between sm:gap-3">
          <p className="min-w-0 text-xs leading-5 text-zinc-500 sm:text-sm" aria-live="polite">
            {submitting
              ? `${pendingLabel} ${progress}%`
              : "Share with your salon’s customers."}
          </p>
          <button
            className="min-h-12 w-full shrink-0 rounded-xl bg-brand-orange px-8 text-sm font-semibold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:bg-brand-orange/50 sm:w-auto"
            disabled={submitting}
            form={formId}
            type="submit"
          >
            {submitting ? `${pendingLabel}...` : primaryLabel}
          </button>
        </div>
      }
      initialFocusRef={captionRef}
      onClose={requestClose}
      panelClassName="sm:max-w-[46rem]"
      title={contentType === "opening" ? "Share opening" : "Create post"}
    >
      <form className="grid gap-4 p-4 sm:p-5" id={formId} onSubmit={submit}>
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
          className="max-h-56 min-h-28 w-full resize-none border-0 bg-white py-2 text-base leading-7 text-zinc-950 outline-none placeholder:text-zinc-400"
          id={`${formId}-caption`}
          onChange={(event) => {
            setCaption(event.currentTarget.value);
            resizeCaptionTextarea();
          }}
          placeholder="Share a new look, a little inspiration, or news from your salon…"
          ref={captionRef}
          value={caption}
        />
        <input accept={SALON_PROFILE_ALLOWED_IMAGE_TYPES.join(",")} className="sr-only" aria-label="Choose a post photo" onChange={(event) => { acceptFile(event.currentTarget.files?.[0] ?? null); event.currentTarget.value = ""; }} ref={fileInputRef} type="file" />
        {previewUrl ? <div className="relative overflow-hidden rounded-2xl bg-zinc-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="Selected post preview" className="max-h-64 w-full object-contain" src={previewUrl} />
          <button aria-label="Remove selected image" className="absolute right-2 top-2 rounded-full bg-white/95 px-3 py-2 text-xs font-medium shadow" type="button" onClick={() => { setFile(null); setPreviewUrl(null); }}>Remove</button>
        </div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-y border-zinc-100 py-3">
          <button className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-medium text-brand-orange hover:bg-brand-orange-soft" type="button" onClick={() => fileInputRef.current?.click()}><PostPhotoIcon />{file ? "Change photo" : "Add photo"}</button>
          <div aria-label="Post type" className="flex flex-wrap gap-1">
            {([{ id: "auto", label: "Post" }, { id: "opening", label: "Opening" }] as const).map((type) => <button key={type.id} type="button" aria-pressed={type.id === "auto" ? contentType !== "opening" : contentType === "opening"} className={`min-h-9 rounded-full px-3 text-xs font-medium ${ (type.id === "opening") === (contentType === "opening") ? "bg-brand-orange-soft text-brand-orange" : "text-zinc-500 hover:bg-zinc-100"}`} onClick={() => setContentType(type.id)}>{type.label}</button>)}
          </div>
        </div>
        <section className="grid gap-3">
          <div><h3 className="text-sm font-semibold text-zinc-900">Service & booking</h3><p className="mt-1 text-xs text-zinc-500">Optional · type to find a service or professional.</p></div>
          {suggestedService && suggestedService.service.id !== serviceId ? <button type="button" className="rounded-xl bg-brand-orange-soft px-3 py-2 text-left text-xs text-zinc-700" onClick={() => { setServiceId(suggestedService.service.id); setAdditionalServiceIds((current) => current.filter((id) => id !== suggestedService.service.id)); }}>Suggested from your caption: <strong>{suggestedService.service.name}</strong> · Add</button> : null}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <PostSuggestionField label="Primary service" placeholder="e.g. Full set" options={serviceOptions} value={serviceId} onChange={(id) => { setServiceId(id); setAdditionalServiceIds((current) => current.filter((item) => item !== id)); }} />
            <PostSuggestionField label="Professional" placeholder="Type a name" options={onlineStaff.map((member) => ({ id: member.id, label: member.displayName }))} value={staffId} onChange={setStaffId} />
          </div>
          <PostSuggestionField label="Additional services" placeholder="Type to add another service" options={serviceOptions.filter((option) => option.id !== serviceId && !additionalServiceIds.includes(option.id))} value="" onChange={(id) => { if (id) setAdditionalServiceIds((current) => [...current, id]); }} />
          {additionalServiceIds.length ? <div className="flex flex-wrap gap-2">{additionalServiceIds.map((id) => <button key={id} type="button" aria-label={`Remove ${data.services.find((service) => service.id === id)?.name}`} className="rounded-full bg-brand-orange-soft px-3 py-1.5 text-xs text-zinc-700" onClick={() => setAdditionalServiceIds((current) => current.filter((item) => item !== id))}>{data.services.find((service) => service.id === id)?.name} <span aria-hidden="true">×</span></button>)}</div> : null}
          <div className="grid min-w-0 grid-cols-2 gap-3">
            <label className="grid min-w-0 gap-1.5"><span className="text-xs font-medium text-zinc-600">Duration · minutes</span><input className={fieldClass} min="0" onChange={(event) => setDurationMinutes(event.currentTarget.value)} placeholder="e.g. 45" type="number" value={durationMinutes} /></label>
            <label className="grid min-w-0 gap-1.5"><span className="text-xs font-medium text-zinc-600">Starting price · $</span><input className={fieldClass} min="0" step="0.01" onChange={(event) => setStartingPrice(event.currentTarget.value)} placeholder="e.g. 55" type="number" value={startingPrice} /></label>
          </div>
          {contentType === "opening" ? <label className="grid min-w-0 gap-1.5"><span className="text-xs font-medium text-zinc-600">Opening time</span><input className={fieldClass} onChange={(event) => setStartsAt(event.currentTarget.value)} type="datetime-local" value={startsAt} /></label> : null}
          <label className="flex min-h-10 items-center gap-2 text-xs text-zinc-600"><input className="size-4 accent-brand-orange" checked={bookingCtaEnabled} onChange={(event) => setBookingCtaEnabled(event.currentTarget.checked)} type="checkbox" />Let customers book from this post</label>
        </section>
        <section className="grid gap-3 border-t border-zinc-100 pt-4">
          <div><h3 className="text-sm font-semibold text-zinc-900">A little more detail</h3><p className="mt-1 text-xs text-zinc-500">Optional · add only what fits your post.</p></div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1.5"><span className="text-xs font-medium text-zinc-600">Title</span><input className={fieldClass} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="e.g. A fresh summer set" value={title} /></label>
            <PostSuggestionField allowCustom label="Mood" placeholder="e.g. Soft & clean" options={["Soft & clean", "Summer bright", "Rich & modern", "Special moment"].map((label) => ({ id: label, label }))} value={mood} onChange={setMood} />
          </div>
        </section>
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

function TeamPreviewRows({
  onViewTeam,
  staff,
}: {
  onViewTeam: () => void;
  staff: PublicSalonProfileStaff[];
}) {
  const preview = getSalonProfileTeamPreview(staff);
  const overflowLabel = formatSalonProfileTeamOverflowLabel(
    preview.hiddenMembers,
  );

  return (
    <div className="mt-4 grid gap-3">
      {preview.previewMembers.map((member) => (
        <div className="flex items-center gap-3" key={member.id}>
          <Avatar logoUrl={member.avatarUrl} name={member.displayName} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-950">
              {member.displayName}
            </p>
            {member.jobTitle ? (
              <p className="truncate text-xs text-zinc-500">{member.jobTitle}</p>
            ) : null}
          </div>
        </div>
      ))}
      {preview.hasOverflow ? (
        <button
          className="flex w-full items-center gap-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 p-2 text-left transition hover:border-zinc-300 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          onClick={onViewTeam}
          type="button"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-xs font-semibold text-zinc-700 shadow-sm">
            +{preview.hiddenCount}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-zinc-950">
              {overflowLabel}
            </span>
            <span className="block text-xs text-zinc-500">
              View all {formatSalonProfileTeamCount(preview.totalCount)}
            </span>
          </span>
        </button>
      ) : null}
    </div>
  );
}

function FeedCard({
  capabilities,
  commentCount: initialCommentCount,
  item,
  look,
  logoUrl,
  onBook,
  onCommentCountChange,
  onOpenPost,
  onRefresh,
  canFeature = false,
  onSavedChange,
  onShare,
  saved,
  saveCount,
}: {
  capabilities: SalonProfileViewerCapabilities;
  commentCount: number;
  item: ProfileFeedItem;
  look: PublicSalonProfileLook | null;
  logoUrl: string | null;
  onBook: (context: BookingContext) => void;
  onCommentCountChange: (target: PostCommentTarget, count: number) => void;
  onOpenPost: (item: ProfileFeedItem) => void;
  onRefresh: () => void;
  canFeature?: boolean;
  onSavedChange: (look: PublicSalonProfileLook, saved: boolean) => void;
  onShare: (item?: ProfileFeedItem) => void;
  saved: boolean;
  saveCount: number;
}) {
  const preferences = useContext(ProfilePreferencesContext);
  const [managing, startManageTransition] = useTransition();
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [commentCountState, setCommentCountState] = useState(() => ({
    count: initialCommentCount,
    itemId: item.id,
  }));
  const commentsPanelId = useId();
  const title =
    item.contentType === "look"
      ? item.title
      : item.caption || item.title || "Salon update";
  const commentTarget = profileFeedCommentTarget(item, title);
  const viewer = postCommentViewer(capabilities);
  const commentCount =
    commentCountState.itemId === item.id
      ? commentCountState.count
      : initialCommentCount;

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");

    if (hash === `${item.contentType}-${item.id}`) {
      const params = new URLSearchParams(window.location.search);

      if (params.has("comment")) {
        const timer = window.setTimeout(() => setCommentsExpanded(true), 0);
        return () => window.clearTimeout(timer);
      }
    }

    return undefined;
  }, [item.contentType, item.id]);

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

  function updateCommentCount(count: number) {
    setCommentCountState({ count, itemId: item.id });
    onCommentCountChange(commentTarget, count);
  }

  return (
    <article
      className="min-h-[calc(100svh-8rem)] scroll-mt-24 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_18px_55px_rgba(24,24,27,.06)]"
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
        <PostActions disabled={managing} onOpen={()=>onOpenPost(item)} onShare={preferences.allow_sharing?()=>onShare(item):undefined} onFeature={canFeature && item.contentType === "look" && item.imageUrl ? ()=>updateLookStatus(undefined,!item.isPinned):undefined} isFeatured={item.isPinned} onArchive={capabilities.canManageContent && look?()=>updateLookStatus("archived"):undefined} onDelete={capabilities.canManageContent && look?()=>deleteLook():undefined}/>

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
        <div className="relative bg-zinc-100">
          <button
            className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950"
            onClick={() => onOpenPost(item)}
            type="button"
          >
            <LookImage
              className="aspect-[4/5] max-h-[760px] w-full"
              imageUrl={item.imageUrl}
              title={title}
            />
          </button>
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3 text-xs font-medium text-zinc-500">
          <span>
            {item.contentType === "look" && saveCount > 0
              ? `${saveCount} save${saveCount === 1 ? "" : "s"}`
              : null}
          </span>
          <span>
            {commentCount} comment
            {commentCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="grid auto-cols-fr grid-flow-col overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {look && preferences.allow_saves ? (
            <ProfileSavePostButton
              className="min-w-0 flex-1 border-r border-zinc-100 last:border-r-0"
              initialSaved={saved}
              onSavedChange={(active) => onSavedChange(look, active)}
              saveCount={saveCount}
              size="toolbar"
              target={{
                salonId: item.salonId,
                sourceId: look.id,
                sourceType: "salon_profile_look",
              }}
            />
          ) : item.contentType === "update" ? (
            <ProfileSavePostButton
              className="min-w-0 flex-1 border-r border-zinc-100 last:border-r-0"
              size="toolbar"
              target={{
                salonId: item.salonId,
                sourceId: item.id,
                sourceType: "salon_profile_update",
              }}
            />
          ) : null}
          <TimelineActionButton
            aria-label="View post"
            className="border-r border-zinc-100 last:border-r-0"
            icon="open"
            onClick={() => onOpenPost(item)}
            title="View post"
          >
            View
          </TimelineActionButton>
          {preferences.allow_comments ? <>
          <TimelineActionButton
            active={commentsExpanded}
            aria-controls={commentsPanelId}
            aria-expanded={commentsExpanded}
            aria-label={
              commentCount > 0
                ? `Read ${commentCount} comments or write a comment`
                : "Write a comment"
            }
            className="border-r border-zinc-100 last:border-r-0"
            icon="comment"
            onClick={() => setCommentsExpanded((current) => !current)}
            title="Comment"
          >
            Comment
          </TimelineActionButton>
          </> : null}
          {preferences.allow_sharing ? <>
          <TimelineActionButton
            aria-label={`Share ${title}`}
            className="border-r border-zinc-100 last:border-r-0"
            icon="share"
            onClick={() => void onShare(item)}
            title="Share"
          >
            Share
          </TimelineActionButton>
          </> : null}
          {capabilities.canBook ? <InspirationAvailability href={`/book/${item.salonId}?inspiration=${item.id}&source=public_profile`} /> : null}
          {capabilities.canBook || !capabilities.isOwnSalon ? (
            <TimelineActionButton
              aria-label={
                item.contentType === "look" ? "Book look" : "Book inspiration"
              }
              icon="book"
              onClick={() =>
                onBook({
                  lookId: item.contentType === "look" ? item.id : null,
                  note: item.caption,
                  title:
                    item.contentType === "look"
                      ? "Book this look"
                      : "Book with this inspiration",
                  updateId: item.contentType === "update" ? item.id : null,
                    startAt: item.contentType === "update" && item.updateType === "last_minute_opening" ? item.startsAt : null,
                })
              }
              title={
                item.contentType === "look" ? "Book look" : "Book inspiration"
              }
              tone="primary"
            >
              Book
            </TimelineActionButton>
          ) : null}
        </div>
        {commentsExpanded && preferences.allow_comments ? (
          <div
            className="rounded-xl border border-zinc-200 bg-zinc-50/75 p-3"
            id={commentsPanelId}
          >
            <ProfilePostCommentThread
              autoFocusComposer
              compact
              initialCount={commentCount}
              onCountChange={updateCommentCount}
              target={commentTarget}
              viewer={viewer}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function beautyBookedCountLabel(count: number) {
  return `${count} booked`;
}

function BeautyTransformationsSection({
  commentCountForPost,
  onOpenPost,
  posts,
}: {
  commentCountForPost?: (post: PublicSalonProfileBeautyPost) => number;
  onOpenPost?: (post: PublicSalonProfileBeautyPost) => void;
  posts: PublicSalonProfileBeautyPost[];
}) {
  if (posts.length === 0) {
    return null;
  }

  return (
    <section className="grid min-h-[calc(100svh-8rem)] scroll-mt-24 content-center gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Client transformations
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-zinc-950">
          Shared by customers
        </h2>
      </div>
      <div className="grid gap-3">
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
            post.verificationState === "verified" ? "Verified Visit" : null,
            timeAgo(post.publishedAt),
          ]);
          const booking = post.booking?.eligible ? post.booking : null;
          const bookingHref = booking?.href ?? null;
          const bookedCount = booking?.bookedCount ?? null;
          const displayedCommentCount =
            commentCountForPost?.(post) ?? post.commentCount;

          return (
            <article
              className="group overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-[0_18px_55px_rgba(24,24,27,.06)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_70px_rgba(24,24,27,.08)]"
              key={post.id}
            >
              <div className="relative">
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
              </div>
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
                  <p className="text-xs font-semibold text-zinc-500">
                    {displayedCommentCount} comment
                    {displayedCommentCount === 1 ? "" : "s"}
                  </p>
                  <div className="grid auto-cols-fr grid-flow-col overflow-hidden rounded-xl border border-zinc-200 bg-white">
                    <ProfileSavePostButton
                      className="min-w-0 flex-1 border-r border-zinc-100 last:border-r-0"
                      size="toolbar"
                      target={{
                        sourceId: post.id,
                        sourceType: "beauty_post",
                      }}
                    />
                    {onOpenPost ? (
                      <TimelineActionButton
                        aria-label="Read or write comments"
                        className="border-r border-zinc-100 last:border-r-0"
                        icon="comment"
                        onClick={() => onOpenPost(post)}
                        title="Comment"
                      >
                        Comment
                      </TimelineActionButton>
                    ) : (
                      <a
                        aria-label="Read or write comments"
                        className="inline-flex min-h-9 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 border-r border-zinc-100 px-1.5 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950"
                        href={`${post.postHref}#comments`}
                        title="Comment"
                      >
                        <TimelineActionIcon name="comment" />
                        <span className="truncate">Comment</span>
                      </a>
                    )}
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
                        className="inline-flex min-h-9 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 border-r border-zinc-100 px-1.5 py-2 text-xs font-semibold text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950"
                        href={bookingHref}
                        title={booking?.label ?? "Book"}
                      >
                        <TimelineActionIcon name="book" />
                        <span className="truncate">Book</span>
                      </a>
                    ) : null}
                    {onOpenPost ? (
                      <button
                        aria-label="View post"
                        className="inline-flex min-h-9 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 px-1.5 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950"
                        onClick={() => onOpenPost(post)}
                        title="View post"
                        type="button"
                      >
                        <TimelineActionIcon name="open" />
                        <span className="truncate">View</span>
                      </button>
                    ) : (
                      <a
                        aria-label="View post"
                        className="inline-flex min-h-9 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 px-1.5 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950"
                        href={post.postHref}
                        title="View post"
                      >
                        <TimelineActionIcon name="open" />
                        <span className="truncate">View</span>
                      </a>
                    )}
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

function profileTrustSummary(
  summary: PublicSalonProfileData["reputationSummary"],
) {
  return buildReylumiTrustSummary(
    {
      trustEvidence: summary.trustEvidence ?? null,
      averageRating: summary.averageRating,
      noIssueRate: summary.noIssueRate,
      sharedExperienceCount: summary.experienceCount,
      uniqueCustomerCount: summary.uniqueCustomerCount,
      verifiedVisitCount: summary.verifiedVisitCount,
    },
  );
}

function ExperienceSummaryPanel({ summary }: { summary: PublicSalonProfileData["reputationSummary"] }) {
  const trustSummary = profileTrustSummary(summary);
  const evidence = summary.trustEvidence;
  return (
    <section aria-labelledby="lumi-trust-profile-title" className="rounded-xl border border-zinc-200 bg-white p-4" id="lumi-trust">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-brand-orange">LUMI Trust</p>
          <h3 className="mt-1 text-lg font-semibold text-zinc-950" id="lumi-trust-profile-title">Current trust evidence</h3>
        </div>
        <div className="flex items-center gap-2">
          <LumiTrustSpark level={trustSummary.level} size="md" />
          <span className="text-sm font-semibold">{trustSummary.mark.label}</span>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-600">Customer feedback and returning customers determine trust together. Lifetime visit volume does not increase quality. This signal is not a guarantee of service quality or future visits.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {trustSummary.evidenceRows.map((row) => (
          <div className="text-xs leading-5" key={row.kind}>
            <p className="font-semibold text-zinc-950">{row.label}{row.value ? `: ${row.value}` : ""}</p>
            <p className="text-zinc-600">{row.detail}</p>
          </div>
        ))}
      </div>
      {!trustSummary.evidenceRows.length ? <p className="mt-3 text-xs text-zinc-600">{trustSummary.mark.detail}</p> : null}
      {evidence ? <p className="mt-3 text-xs text-zinc-500">Feedback window: {evidence.feedbackDays} days. Return cohort: {evidence.cohortDays} days, ending {evidence.returnDays} days ago. Updated {new Date(evidence.asOf).toLocaleDateString("en-US", { timeZone: "UTC" })}.</p> : null}
      <a className="mt-3 inline-flex min-h-9 items-center text-xs font-semibold text-brand-orange underline" href="#customer-experiences">Read customer experiences</a>
    </section>
  );
}

function ReviewReplyForm({
  onPosted,
  review,
}: {
  onPosted: () => void;
  review: PublicSalonProfileExperience;
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

function experienceStateLabel(experience: PublicSalonProfileExperience) {
  if (experience.feedbackState === "issue") {
    return experience.issueStatus === "resolved"
      ? "Issue resolved"
      : "Issue shared";
  }

  if (experience.feedbackState === "good") {
    return "Good experience";
  }

  return "Experience";
}

function ExperienceCard({
  canReplyAsSalon,
  experience,
  onPosted,
}: {
  canReplyAsSalon: boolean;
  experience: PublicSalonProfileExperience;
  onPosted: () => void;
}) {
  const canReplyToExperience =
    canReplyAsSalon && experience.source === "legacy_review";
  const meta = [

    timeAgo(experience.createdAt),
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <article className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_14px_42px_rgba(24,24,27,.05)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-zinc-950">
            {experience.authorDisplayName}
          </p>
          {meta ? <p className="mt-1 text-sm text-zinc-500">{meta}</p> : null}
        </div>
        <span
          className={[
            "rounded-full px-3 py-1 text-xs font-semibold",
            experience.verificationStatus === "verified"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-zinc-100 text-zinc-600",
          ].join(" ")}
        >
          {experience.verificationStatus === "verified"
            ? "Verified Visit"
            : "Experience"}
        </span>
      </div>
      <p className="mt-4 text-sm font-semibold text-zinc-950">
        {experienceStateLabel(experience)}
      </p>
      {experience.title ? (
        <h3 className="mt-2 font-semibold text-zinc-950">{experience.title}</h3>
      ) : null}
      {experience.body ? (
        <p className="mt-3 text-sm leading-6 text-zinc-700">
          {experience.body}
        </p>
      ) : (
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          Quick feedback, no details added.
        </p>
      )}
      {experience.replyBody ? (
        <div className="mt-4 rounded-xl bg-zinc-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Salon reply
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            {experience.replyBody}
          </p>
        </div>
      ) : canReplyToExperience ? (
        <ReviewReplyForm onPosted={onPosted} review={experience} />
      ) : null}
    </article>
  );
}

function LookDetailDialog({
  capabilities,
  commentCount: initialCommentCount,
  isSaved,
  look,
  onBook,
  onClose,
  onCommentCountChange,
  onSave,
  onShare,
  onViewInTimeline,
  saveCount,
  salonId,
}: {
  capabilities: SalonProfileViewerCapabilities;
  commentCount: number;
  isSaved: boolean;
  look: PublicSalonProfileLook;
  onBook: (context: BookingContext) => void;
  onClose: () => void;
  onCommentCountChange: (target: PostCommentTarget, count: number) => void;
  onSave: (look: PublicSalonProfileLook) => void;
  onShare: () => void;
  onViewInTimeline: (targetId: string) => void;
  saveCount: number;
  salonId: string;
}) {
  const titleId = useId();
  const commentsPanelId = useId();
  const [commentCountState, setCommentCountState] = useState(() => ({
    count: initialCommentCount,
    lookId: look.id,
  }));
  const viewer = postCommentViewer(capabilities);
  const commentTarget: PostCommentTarget = {
    salonId,
    sourceId: look.id,
    sourceType: "salon_profile_look",
    title: look.title,
  };
  const commentCount =
    commentCountState.lookId === look.id
      ? commentCountState.count
      : initialCommentCount;

  function updateCommentCount(count: number) {
    setCommentCountState({ count, lookId: look.id });
    onCommentCountChange(commentTarget, count);
  }

  function focusCommentsPanel() {
    const panel = document.getElementById(commentsPanelId);

    panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    panel
      ?.querySelector<HTMLTextAreaElement>("textarea")
      ?.focus({ preventScroll: true });
  }

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
      <div className="mt-auto grid max-h-[100dvh] overflow-auto overscroll-contain rounded-t-xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:m-auto sm:max-h-[88vh] sm:w-full sm:max-w-5xl sm:rounded-xl sm:pb-0">
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
            <div className="grid auto-cols-fr grid-flow-col overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <TimelineActionButton
                active={isSaved}
                aria-label={isSaved ? "Remove saved look" : "Love this look"}
                aria-pressed={isSaved}
                className="border-r border-zinc-100 last:border-r-0"
                icon="love"
                onClick={() => onSave(look)}
                title={isSaved ? "Saved" : "Love"}
              >
                {isSaved ? "Loved" : "Love"}
              </TimelineActionButton>
              <TimelineActionButton
                aria-label="Share"
                className="border-r border-zinc-100 last:border-r-0"
                icon="share"
                onClick={onShare}
                title="Share"
              >
                Share
              </TimelineActionButton>
              <TimelineActionButton
                aria-controls={commentsPanelId}
                aria-label="Read or write comments"
                className="border-r border-zinc-100 last:border-r-0"
                icon="comment"
                onClick={focusCommentsPanel}
                title="Comment"
              >
                Comment
              </TimelineActionButton>
              <TimelineActionButton
                aria-label="View in timeline"
                className="border-r border-zinc-100 last:border-r-0"
                icon="timeline"
                onClick={() => onViewInTimeline(`look-${look.id}`)}
                title="View in timeline"
              >
                Timeline
              </TimelineActionButton>
              <TimelineActionButton
                aria-label="Book exact look"
                className="border-r border-zinc-100 last:border-r-0"
                disabled={!capabilities.canBook}
                icon="book"
                onClick={() =>
                  onBook({
                    lookId: look.id,
                    note: look.caption ?? look.bookingNote,
                    serviceId: look.serviceId,
                    staffId: look.recommendedStaffId,
                    title: "Book this exact look",
                  })
                }
                title="Book exact look"
                tone="primary"
              >
                Book
              </TimelineActionButton>
            </div>
            <div id={commentsPanelId}>
              <ProfilePostCommentThread
                initialCount={commentCount}
                onCountChange={updateCommentCount}
                target={commentTarget}
                viewer={viewer}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedPostDetailDialog({
  capabilities,
  commentCount: initialCommentCount,
  item,
  onBook,
  onClose,
  onCommentCountChange,
  onShare,
  onViewInTimeline,
  postActions,
}: {
  capabilities: SalonProfileViewerCapabilities;
  commentCount: number;
  item: ProfileFeedItem;
  onBook: (context: BookingContext) => void;
  onClose: () => void;
  onCommentCountChange: (target: PostCommentTarget, count: number) => void;
  onShare: (item?: ProfileFeedItem) => void;
  onViewInTimeline: (targetId: string) => void;
  postActions?: ReactNode;
}) {
  const titleId = useId();
  const commentsPanelId = useId();
  const [commentCountState, setCommentCountState] = useState(() => ({
    count: initialCommentCount,
    itemId: item.id,
  }));
  const title =
    item.contentType === "look"
      ? item.title
      : item.caption || item.title || "Salon update";
  const viewer = postCommentViewer(capabilities);
  const commentTarget = profileFeedCommentTarget(item, title);
  const meta = joinMeta([
    item.contentType === "look" ? item.mood : null,
    item.serviceName,
    item.contentType === "look" && item.recommendedStaffName
      ? `With ${item.recommendedStaffName}`
      : null,
    item.contentType === "update" && item.staffName
      ? `With ${item.staffName}`
      : null,
    timeAgo(item.publishedAt),
  ]);
  const commentCount =
    commentCountState.itemId === item.id
      ? commentCountState.count
      : initialCommentCount;

  function focusCommentsPanel() {
    const panel = document.getElementById(commentsPanelId);

    panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    panel
      ?.querySelector<HTMLTextAreaElement>("textarea")
      ?.focus({ preventScroll: true });
  }

  function updateCommentCount(count: number) {
    setCommentCountState({ count, itemId: item.id });
    onCommentCountChange(commentTarget, count);
  }

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
      <div className="mt-auto grid max-h-[100dvh] overflow-auto overscroll-contain rounded-t-xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:m-auto sm:max-h-[88vh] sm:w-full sm:max-w-5xl sm:rounded-xl sm:pb-0">
        <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,.8fr)]">
          {item.imageUrl ? (
            <LookImage
              className="aspect-[4/5] w-full lg:h-full lg:min-h-[34rem]"
              imageUrl={item.imageUrl}
              title={title}
            />
          ) : (
            <div className="grid min-h-[18rem] place-items-center bg-zinc-100 p-6 text-center text-zinc-500">
              No image attached
            </div>
          )}
          <div className="grid content-start gap-5 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-3">
              {postActions}
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    logoUrl={item.authorAvatarUrl}
                    name={item.authorName}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-950">
                      {item.authorName}
                    </p>
                    {meta ? (
                      <p className="truncate text-xs text-zinc-500">{meta}</p>
                    ) : null}
                  </div>
                </div>
                <h2
                  className="mt-5 text-3xl font-semibold text-zinc-950"
                  id={titleId}
                >
                  {title}
                </h2>
                {item.caption ? (
                  <p className="mt-3 text-sm leading-6 text-zinc-700">
                    <CaptionWithHashtags text={item.caption} />
                  </p>
                ) : null}
                {item.hashtags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
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
              </div>
              <Button onClick={onClose} variant="secondary">
                Close
              </Button>
            </div>
            <div className="grid auto-cols-fr grid-flow-col overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <TimelineActionButton
                aria-label={`Share ${title}`}
                className="border-r border-zinc-100 last:border-r-0"
                icon="share"
                onClick={() => void onShare(item)}
                title="Share"
              >
                Share
              </TimelineActionButton>
              <TimelineActionButton
                aria-controls={commentsPanelId}
                aria-label="Read or write comments"
                className="border-r border-zinc-100 last:border-r-0"
                icon="comment"
                onClick={focusCommentsPanel}
                title="Comment"
              >
                Comment
              </TimelineActionButton>
              <TimelineActionButton
                aria-label="View in timeline"
                className="border-r border-zinc-100 last:border-r-0"
                icon="timeline"
                onClick={() => onViewInTimeline(`${item.contentType}-${item.id}`)}
                title="View in timeline"
              >
                Timeline
              </TimelineActionButton>
              <TimelineActionButton
                aria-label={
                  item.contentType === "look" ? "Book look" : "Book inspiration"
                }
                className="border-r border-zinc-100 last:border-r-0"
                disabled={!capabilities.canBook}
                icon="book"
                onClick={() =>
                  onBook({
                    lookId: item.contentType === "look" ? item.id : null,
                    note: item.caption,
                    title:
                      item.contentType === "look"
                        ? "Book this look"
                        : "Book with this inspiration",
                    updateId: item.contentType === "update" ? item.id : null,
                    startAt: item.contentType === "update" && item.updateType === "last_minute_opening" ? item.startsAt : null,
                  })
                }
                title={
                  item.contentType === "look" ? "Book look" : "Book inspiration"
                }
                tone="primary"
              >
                Book
              </TimelineActionButton>
            </div>
            <div id={commentsPanelId}>
              <ProfilePostCommentThread
                initialCount={commentCount}
                onCountChange={updateCommentCount}
                target={commentTarget}
                viewer={viewer}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BeautyPostDetailDialog({
  capabilities,
  commentCount: initialCommentCount,
  onClose,
  onCommentCountChange,
  onViewInTimeline,
  post,
  salonId,
}: {
  capabilities: SalonProfileViewerCapabilities;
  commentCount: number;
  onClose: () => void;
  onCommentCountChange: (target: PostCommentTarget, count: number) => void;
  onViewInTimeline: (targetId: string) => void;
  post: PublicSalonProfileBeautyPost;
  salonId: string;
}) {
  const titleId = useId();
  const commentsPanelId = useId();
  const [commentCountState, setCommentCountState] = useState(() => ({
    count: initialCommentCount,
    postId: post.id,
  }));
  const viewer = postCommentViewer(capabilities);
  const commentTarget = beautyPostCommentTarget(post, salonId);
  const before = post.media.find((item) => item.role === "before") ?? post.media[0];
  const after =
    post.media.find((item) => item.role === "after") ??
    post.media.find((item) => item.id !== before?.id) ??
    post.media[1] ??
    before;
  const meta = joinMeta([
    post.staffName ? `With ${post.staffName}` : null,
    post.verificationState === "verified" ? "Verified Visit" : null,
    timeAgo(post.publishedAt),
  ]);
  const commentCount =
    commentCountState.postId === post.id
      ? commentCountState.count
      : initialCommentCount;

  function updateCommentCount(count: number) {
    setCommentCountState({ count, postId: post.id });
    onCommentCountChange(commentTarget, count);
  }

  function focusCommentsPanel() {
    const panel = document.getElementById(commentsPanelId);

    panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    panel
      ?.querySelector<HTMLTextAreaElement>("textarea")
      ?.focus({ preventScroll: true });
  }

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
      <div className="mt-auto grid max-h-[100dvh] overflow-auto overscroll-contain rounded-t-xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:m-auto sm:max-h-[88vh] sm:w-full sm:max-w-5xl sm:rounded-xl sm:pb-0">
        <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,.8fr)]">
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
            aspectClassName="aspect-[4/5] lg:min-h-[34rem]"
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
            sizes="(max-width: 1024px) 100vw, 60vw"
          />
          <div className="grid content-start gap-5 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-950 text-xs font-semibold text-white">
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
                      <p className="truncate text-xs text-zinc-500">{meta}</p>
                    ) : null}
                  </div>
                </div>
                <h2
                  className="mt-5 text-3xl font-semibold text-zinc-950"
                  id={titleId}
                >
                  Shared by customers
                </h2>
                {post.caption ? (
                  <p className="mt-3 text-sm leading-6 text-zinc-700">
                    {post.caption}
                  </p>
                ) : null}
              </div>
              <Button onClick={onClose} variant="secondary">
                Close
              </Button>
            </div>
            <div className="grid auto-cols-fr grid-flow-col overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <ProfileSavePostButton
                className="min-w-0 flex-1 border-r border-zinc-100 last:border-r-0"
                size="toolbar"
                target={{
                  sourceId: post.id,
                  sourceType: "beauty_post",
                }}
              />
              <a
                className="inline-flex min-h-9 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 border-r border-zinc-100 px-1.5 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-950"
                href={post.postHref}
                title="Open Beauty post"
              >
                <TimelineActionIcon name="open" />
                <span className="truncate">Open</span>
              </a>
              <TimelineActionButton
                aria-controls={commentsPanelId}
                aria-label="Read or write comments"
                className="border-r border-zinc-100 last:border-r-0"
                icon="comment"
                onClick={focusCommentsPanel}
                title="Comment"
              >
                Comment
              </TimelineActionButton>
              <TimelineActionButton
                aria-label="View in timeline"
                className="border-r border-zinc-100 last:border-r-0"
                icon="timeline"
                onClick={() => onViewInTimeline(`shared-${post.id}`)}
                title="View in timeline"
              >
                Timeline
              </TimelineActionButton>
            </div>
            <div id={commentsPanelId}>
              <ProfilePostCommentThread
                initialCount={commentCount}
                onCountChange={updateCommentCount}
                target={commentTarget}
                viewer={viewer}
              />
            </div>
          </div>
        </div>
      </div>
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
        <form action={setSalonProfilePublicationAction} className="grid gap-2 border-t border-zinc-200 pt-4">
          <input name="salon_id" type="hidden" value={setting.salon_id} />
          <input
            name="public_discovery_enabled"
            type="hidden"
            value={nextEnabled ? "true" : "false"}
          />
          <Button
            className="w-full sm:w-auto"
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
  const isWebsiteView = !manageData || capabilities.isOwnSalon;
  const [editedPreferences, setEditedPreferences] = useState<SalonProfilePreferences | null>(null);
  const preferences = editedPreferences ?? data.preferences ?? DEFAULT_PROFILE_PREFERENCES;
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [operatingHoursOpen, setOperatingHoursOpen] = useState(false);
  const [hoursInfoOpen, setHoursInfoOpen] = useState(false);
  const [contentManagerOpen, setContentManagerOpen] = useState(false);
  const [publishedPosts, setPublishedPosts] = useState<ProfileFeedItem[]>([]);
  const hasGalleryPhotos = [...data.feed, ...publishedPosts].some(post => post.imageUrl)
    || data.looks.some(look => look.imageUrl) || data.beautyPosts.some(post => post.media.some(media => media.url));
  const visibleTabs = TABS.filter(tab => {
    if (tab.id === "services") return preferences.show_services && (!isWebsiteView || data.services.length > 0);
    if (tab.id === "team") return preferences.show_team && (!isWebsiteView || data.staff.length > 0);
    if (tab.id === "gallery") return !isWebsiteView || hasGalleryPhotos;
    if (tab.id === "about") return !isWebsiteView || salonAboutParagraphs(profile).length > 0 || Boolean(profile.addressLine1 || profile.phone || profile.website);
    return true;
  });
  const mainTabs = visibleTabs.filter(tab => ["discover", "gallery", "services", "team"].includes(tab.id));
  const [publishedLooks, setPublishedLooks] = useState<PublicSalonProfileLook[]>([]);
  const sortedLooks = useMemo(
    () =>
      mergePublishedItems(publishedLooks, data.looks).sort((left, right) => {
        if (left.isPinned !== right.isPinned) {
          return left.isPinned ? -1 : 1;
        }

        return (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "");
      }),
    [data.looks, publishedLooks],
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
  const [detailPost, setDetailPost] = useState<ProfileFeedItem | null>(null);
  const [detailBeautyPost, setDetailBeautyPost] =
    useState<PublicSalonProfileBeautyPost | null>(null);
  const [detailStaff, setDetailStaff] =
    useState<PublicSalonProfileStaff | null>(null);
  const [composerType, setComposerType] = useState<ComposerType | null>(null);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [publicationOpen, setPublicationOpen] = useState(false);
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  useCloseOnNavigation(() => setOwnerMenuOpen(false), ownerMenuOpen);
  const ownerMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const ownerMenuRef = useRef<HTMLDivElement | null>(null);
  const [experienceFilter, setExperienceFilter] =
    useState<"all" | "issues" | "verified" | "good">("all");
  const [commentTarget, setCommentTarget] = useState<PostCommentTarget | null>(null);
  const [commentCountOverrides, setCommentCountOverrides] = useState(
    new Map<string, number>(),
  );
  const [savedLookIds, setSavedLookIds] = useState(
    new Set(sortedLooks.filter((look) => look.isSaved).map((look) => look.id)),
  );
  const [saveCounts, setSaveCounts] = useState(
    new Map(sortedLooks.map((look) => [look.id, look.saveCount])),
  );
  const [visibleTimelineCount, setVisibleTimelineCount] = useState(
    INITIAL_TIMELINE_ITEM_COUNT,
  );
  const timelineSentinelRef = useRef<HTMLDivElement | null>(null);
  const timelineHashHandledRef = useRef<string | null>(null);
  const tabScrollPositions = useRef<Record<TabId, number>>({
    about: 0,
    discover: 0,
    experiences: 0,
    gallery: 0,
    services: 0,
    team: 0,
  });

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
          if(window.location.hash==="#feedback-good")setExperienceFilter("good");
          else if(window.location.hash==="#feedback-issue")setExperienceFilter("issues");
          else if(window.location.hash==="#customer-experiences")setExperienceFilter("all");
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
  useEffect(() => {
    if (selectedTab !== "experiences") {
      return undefined;
    }

    const hash = window.location.hash.replace(/^#/, "");

    if (!["lumi-trust","lumi-trust-details","customer-experiences","feedback-good","feedback-issue"].includes(hash)) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      document
        .getElementById("lumi-trust")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [selectedTab]);

  const [isFollowing, setFollowing] = useState(profile.isFollowing);
  const [, setFollowerCount] = useState(profile.followerCount);
  const [statusMessage, setStatusMessage] = useState("");
  const [authPromptIntent, setAuthPromptIntent] =
    useState<AuthPromptIntent | null>(null);
  const [surpriseIndex, setSurpriseIndex] = useState(0);
  const [isPending, startTransition] = useTransition();
  function bookingHref(context: BookingContext) {
    const params = new URLSearchParams({ source: "public_profile" });
    if (context?.startAt) params.set("startAt", context.startAt);

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
    window.dispatchEvent(new CustomEvent("reylumi:quick-book", { detail: { href: bookingHref(context) } }));
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
  const primaryMobileLook = matchingLooks[0] ?? sortedLooks[0] ?? null;
  const existingFeedItems = data.feed.length
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
  const feedItems = visibleSalonPosts(mergePublishedItems(publishedPosts, existingFeedItems), data.directoryListing);
  const timelineItems = buildTimelineItems({
    beautyPosts: data.beautyPosts,
    feedItems,
  });
  const visibleTimelineItems = timelineItems.slice(0, visibleTimelineCount);

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");

    if (
      !hash.startsWith("look-") &&
      !hash.startsWith("update-") &&
      !hash.startsWith("shared-")
    ) {
      return undefined;
    }

    if (timelineHashHandledRef.current === hash) {
      return undefined;
    }

    const targetIndex = timelineItems.findIndex((item) => item.id === hash);

    if (targetIndex < 0) {
      return undefined;
    }

    let scrollTimer: number | undefined;
    const stateTimer = window.setTimeout(() => {
      timelineHashHandledRef.current = hash;
      setSelectedTab("gallery");
      const target = timelineItems[targetIndex];
      if (target.type === "post") setDetailPost(target.item);
      else setDetailBeautyPost(target.posts[0] ?? null);
      setVisibleTimelineCount((current) =>
        Math.max(current, targetIndex + 1, INITIAL_TIMELINE_ITEM_COUNT),
      );
      scrollTimer = window.setTimeout(() => {
        document
          .getElementById(hash)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    }, 0);

    return () => {
      window.clearTimeout(stateTimer);

      if (scrollTimer !== undefined) {
        window.clearTimeout(scrollTimer);
      }
    };
  }, [timelineItems]);

  const galleryItems = buildGalleryItems({
    beautyPosts: data.beautyPosts,
    feedItems,
  });
  const address = formatAddress(profile);

  useEffect(() => {
    if (!ownerMenuOpen) {
      return;
    }

    function onPointerDown(event: Event) {
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

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ownerMenuOpen]);

  useEffect(() => {
    if (
      selectedTab !== "discover" ||
      visibleTimelineCount >= timelineItems.length
    ) {
      return;
    }

    const sentinel = timelineSentinelRef.current;

    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleTimelineCount((current) =>
            Math.min(timelineItems.length, current + TIMELINE_LOAD_STEP),
          );
        }
      },
      { rootMargin: "720px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [selectedTab, timelineItems.length, visibleTimelineCount]);

  function refresh() {
    router.refresh();
  }

  function commentCountForTarget(target: PostCommentTarget, fallback: number) {
    return commentCountOverrides.get(postCommentKey(target)) ?? fallback;
  }

  function updateCommentCountForTarget(
    target: PostCommentTarget,
    commentCount: number,
  ) {
    setCommentCountOverrides((current) => {
      if (current.get(postCommentKey(target)) === commentCount) {
        return current;
      }

      const next = new Map(current);

      next.set(postCommentKey(target), commentCount);
      return next;
    });
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

  function changeTab(tab: TabId) {
    if (tab === selectedTab) {
      return;
    }

    tabScrollPositions.current[selectedTab] = window.scrollY;
    setSelectedTab(tab);
    window.requestAnimationFrame(() => {
      window.scrollTo({
        behavior: "auto",
        top: tabScrollPositions.current[tab],
      });
    });
  }

  function canFeaturePost(item: ProfileFeedItem) {
    return Boolean(capabilities.canFeatureOwnContent && item.contentType === "look" && item.imageUrl && item.publishedAt && (manageData?.ownedLookIds?.includes(item.id) || publishedLooks.some(look=>look.id === item.id)));
  }
  function renderPostActions(item: ProfileFeedItem) {
    const actions = <PostActions onOpen={()=>openTimelinePost(item)} onShare={preferences.allow_sharing?()=>shareSalon(item):undefined} isFeatured={item.isPinned} onFeature={canFeaturePost(item)?async()=>{
      const result=await setSalonProfileLookStatusDirectAction({salonId:profile.salonId,lookId:item.id,isPinned:!item.isPinned});
      if(result.error){setStatusMessage(result.error);return;}
      setStatusMessage("");refresh();
    }:undefined} onArchive={capabilities.canManageContent && item.contentType === "look"?async()=>{
      const result=await setSalonProfileLookStatusDirectAction({salonId:profile.salonId,lookId:item.id,status:"archived"});if(result.error)setStatusMessage(result.error);else{setDetailPost(null);refresh();}
    }:undefined} onDelete={capabilities.canManageContent && item.contentType === "look"?async()=>{
      if(!window.confirm("Delete this post? This cannot be undone."))return;
      const result=await deleteSalonProfileLookDirectAction({salonId:profile.salonId,lookId:item.id});if(result.error)setStatusMessage(result.error);else{setDetailPost(null);refresh();}
    }:undefined}/>;
    return isManagedViewer ? actions : <div className="flex items-center gap-1"><SavePostButton isAuthenticated={capabilities.isAuthenticated} target={{salonId:item.salonId,sourceId:item.id,sourceType:item.contentType === "look" ? "salon_profile_look" : "salon_profile_update"}} size="compact"/><ExploreBookButton compact href={capabilities.canBook?bookingHref({lookId:item.contentType === "look"?item.id:null,updateId:item.contentType === "update"?item.id:null,title:"Book inspiration"}):null} name={profile.name} contactHref={`/explore/salons/${profile.salonId}`} phoneHref={profile.phone?`tel:${profile.phone}`:null}/>{actions}</div>;
  }

  function openTimelinePost(item: ProfileFeedItem) {
    setDetailPost(item);
  }

  function openGalleryItem(item: GalleryItem) {
    if (item.type === "beauty") {
      setDetailBeautyPost(item.post);
      return;
    }

    openTimelinePost(item.item);
  }

  function viewInTimeline(targetId: string) {
    tabScrollPositions.current[selectedTab] = window.scrollY;

    const targetIndex = timelineItems.findIndex((item) => item.id === targetId);

    if (targetIndex >= 0) {
      setVisibleTimelineCount((current) =>
        Math.max(current, targetIndex + 1, INITIAL_TIMELINE_ITEM_COUNT),
      );
    }

    setDetailLook(null);
    setDetailPost(null);
    setDetailBeautyPost(null);
    setSelectedTab("discover");
    window.setTimeout(() => {
      document
        .getElementById(targetId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
      return;
    }

    event.preventDefault();
    const currentIndex = mainTabs.findIndex((tab) => tab.id === selectedTab);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + mainTabs.length) % mainTabs.length;
    changeTab(mainTabs[nextIndex].id);
  }

  function applyLookSaveState(look: PublicSalonProfileLook, active: boolean) {
    setSavedLookIds((current) => {
      const wasSaved = current.has(look.id);

      if (wasSaved === active) {
        return current;
      }

      setSaveCounts((counts) => {
        const nextCounts = new Map(counts);
        const currentCount = nextCounts.get(look.id) ?? 0;

        nextCounts.set(look.id, Math.max(0, currentCount + (active ? 1 : -1)));
        return nextCounts;
      });

      const next = new Set(current);

      if (active) {
        next.add(look.id);
      } else {
        next.delete(look.id);
      }

      return next;
    });
  }

  function toggleSave(look: PublicSalonProfileLook) {
    startTransition(async () => {
      const result = await toggleSalonLookSaveAction(look.id, profile.salonId);

      if (result.error) {
        if (isAuthIntentMessage(result.error)) {
          setAuthPromptIntent("save");
          return;
        }

        setStatusMessage(result.error);
        return;
      }

      applyLookSaveState(look, result.active);
      setStatusMessage(result.active ? "Look saved." : "Look removed.");
    });
  }

  function toggleFollow() {
    startTransition(async () => {
      const result = await toggleSalonFollowAction(profile.salonId);

      if (result.error) {
        if (isAuthIntentMessage(result.error)) {
          setAuthPromptIntent("follow");
          return;
        }

        setStatusMessage(result.error);
        return;
      }

      setFollowing(result.active);
      setFollowerCount((current) =>
        Math.max(0, current + (result.active ? 1 : -1)),
      );
      setStatusMessage("");
    });
  }

  async function shareSalon(item?: ProfileFeedItem) {
    if (!preferences.allow_sharing) return;
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

  function renderDiscover(asTimeline = false) {
    if (!asTimeline && (!manageData || capabilities.isOwnSalon)) {
      return <SalonWebsiteHome libraryPhotos={galleryItems} onLibraryPhoto={photo => { const item = galleryItems.find(item => item.id === photo.id); if (item) openGalleryItem(item); }} renderLibraryActions={photo => { const item = galleryItems.find(item => item.id === photo.id); return item?.type === "feed" ? renderPostActions(item.item) : <div className="flex gap-1">{item?.type === "beauty" && !isManagedViewer ? <><SavePostButton target={{sourceId:item.post.id,sourceType:"beauty_post"}} isAuthenticated={capabilities.isAuthenticated} size="compact"/><ExploreBookButton compact href={item.post.booking?.eligible?item.post.booking.href:null} name={profile.name} contactHref={`/explore/salons/${profile.salonId}`} phoneHref={profile.phone?`tel:${profile.phone}`:null}/></>:null}<PostActions onOpen={() => { if (item) openGalleryItem(item); }}/></div>; }} data={data} preferences={preferences} posts={feedItems} canBook={capabilities.canBook} onPost={openTimelinePost} onGallery={() => changeTab("gallery")} onServices={() => changeTab("services")} onTeam={() => changeTab("team")} onBook={openBooking} onStaff={setDetailStaff} onReviews={() => changeTab("experiences")} renderPostActions={renderPostActions} composer={capabilities.isOwnSalon && capabilities.canCreateContent ? <div className="grid gap-2"><ComposerCard logoUrl={profile.logoImageUrl} name={profile.name} onOpen={setComposerType}/>{capabilities.canManageContent ? <button type="button" className="justify-self-end text-xs font-medium text-zinc-500 hover:text-brand-orange" onClick={() => setContentManagerOpen(true)}>Manage posts</button> : null}</div> : null}/>;
    }
    return (
      <div className="mx-auto grid w-full max-w-4xl gap-3">
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
        {visibleTimelineItems.length === 0 ? (
          <EmptyState title="No recent posts">
            Published looks, salon updates, and customer shares will appear here
            from newest to oldest.
          </EmptyState>
        ) : (
          <section aria-label="Salon timeline" className="grid gap-3">
            {visibleTimelineItems.map((timelineItem) => {
              if (timelineItem.type === "shared") {
                return (
                  <div id={timelineItem.id} key={timelineItem.id}>
                    <BeautyTransformationsSection
                      commentCountForPost={(post) =>
                        commentCountForTarget(
                          beautyPostCommentTarget(post, profile.salonId),
                          post.commentCount,
                        )
                      }
                      onOpenPost={setDetailBeautyPost}
                      posts={timelineItem.posts}
                    />
                  </div>
                );
              }

              const item = timelineItem.item;
              const look =
                item.contentType === "look" ? lookById.get(item.id) ?? null : null;

              return (
                <FeedCard
                  capabilities={capabilities}
                  commentCount={commentCountForTarget(
                    profileFeedCommentTarget(
                      item,
                      item.contentType === "look"
                        ? item.title
                        : item.caption || item.title || "Salon update",
                    ),
                    item.commentCount,
                  )}
                  item={item}
                  key={timelineItem.id}
                  look={look}
                  logoUrl={profile.logoImageUrl}
                  onBook={openBooking}
                  onCommentCountChange={updateCommentCountForTarget}
                  onOpenPost={openTimelinePost}
                  onRefresh={refresh}
                  canFeature={canFeaturePost(item)}
                  onSavedChange={applyLookSaveState}
                  onShare={shareSalon}
                  saved={look ? savedLookIds.has(look.id) : false}
                  saveCount={look ? saveCounts.get(look.id) ?? 0 : 0}
                />
              );
            })}
            <div
              className="grid min-h-24 place-items-center text-sm font-semibold text-zinc-500"
              ref={timelineSentinelRef}
            >
              {visibleTimelineCount < timelineItems.length
                ? "Loading older posts"
                : "End of timeline"}
            </div>
          </section>
        )}
      </div>
    );
  }

  function renderGallery() {
    const visibleGalleryItems = selectedMood
      ? galleryItems.filter(
          (item) =>
            item.type === "feed" &&
            item.item.contentType === "look" &&
            item.item.mood === selectedMood,
        )
      : galleryItems;

    if (visibleGalleryItems.length === 0) {
      return (
        <EmptyState title="Gallery is waiting">
          Images from published posts and customer shares will build this
          gallery automatically.
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
              All images
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {visibleGalleryItems.map((galleryItem) => {
            const feedGalleryItem =
              galleryItem.type === "feed" ? galleryItem : null;
            const galleryLook =
              feedGalleryItem?.item.contentType === "look"
                ? lookById.get(feedGalleryItem.item.id) ?? null
                : null;

            return (
              <div
                className="group relative aspect-[4/5] rounded-2xl bg-zinc-100 shadow-[0_14px_40px_rgba(24,24,27,.06)]"
                key={galleryItem.id}
              >
                <button
                  className="block h-full w-full overflow-hidden rounded-2xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                  onClick={() => openGalleryItem(galleryItem)}
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={galleryItem.title}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
                    src={galleryItem.imageUrl}
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-white/92 p-3 opacity-0 shadow-[0_-12px_30px_rgba(24,24,27,.08)] transition group-hover:opacity-100 group-focus-within:opacity-100">
                    <span className="block text-sm font-semibold text-zinc-950">
                      {galleryItem.title}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-600">
                      {galleryItem.type === "feed"
                        ? joinMeta([
                            galleryItem.item.authorName,
                            galleryItem.item.contentType === "look"
                              ? galleryItem.item.mood
                              : "Salon update",
                            galleryItem.item.serviceName,
                            timeAgo(galleryItem.item.publishedAt),
                          ])
                        : joinMeta([
                            galleryItem.post.authorDisplayName,
                            "Shared by customer",
                            timeAgo(galleryItem.post.publishedAt),
                          ])}
                    </span>
                  </span>
                </button>
                <div className="absolute right-2 top-2">{feedGalleryItem ? renderPostActions(feedGalleryItem.item) : <PostActions onOpen={()=>openGalleryItem(galleryItem)}/>}</div>
                {galleryLook && feedGalleryItem ? (
                  <ProfileSavePostButton
                    className="absolute bottom-3 right-3"
                    initialSaved={savedLookIds.has(galleryLook.id)}
                    onSavedChange={(active) =>
                      applyLookSaveState(galleryLook, active)
                    }
                    saveCount={saveCounts.get(galleryLook.id) ?? 0}
                    target={{
                      salonId: feedGalleryItem.item.salonId,
                      sourceId: galleryLook.id,
                      sourceType: "salon_profile_look",
                    }}
                  />
                ) : feedGalleryItem &&
                  feedGalleryItem.item.contentType === "update" ? (
                  <ProfileSavePostButton
                    className="absolute bottom-3 right-3"
                    target={{
                      salonId: feedGalleryItem.item.salonId,
                      sourceId: feedGalleryItem.item.id,
                      sourceType: "salon_profile_update",
                    }}
                  />
                ) : galleryItem.type === "beauty" ? (
                  <ProfileSavePostButton
                    className="absolute bottom-3 right-3"
                    target={{
                      sourceId: galleryItem.post.id,
                      sourceType: "beauty_post",
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  function renderServices() {
    if (!manageData || capabilities.isOwnSalon) return <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6"><h3 className="mb-4 text-lg font-semibold">Our services</h3><WebsiteServices services={data.services} posts={feedItems} canBook={capabilities.canBook} onBook={openBooking} salonId={profile.salonId}/></section>;
    if (data.services.length === 0) {
      return (
        <EmptyState title="No services published">
          Services will appear once the salon has active catalog items.
        </EmptyState>
      );
    }

    return <ServiceMenu services={data.services} canBook={capabilities.canBook} bookingHref={serviceId => bookingHref({serviceId, title: "Book service"})}/>;
  }

  function renderTeam() {
    if (!manageData || capabilities.isOwnSalon) return <section className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-6"><h3 className="mb-4 text-lg font-semibold">Meet our team</h3><WebsiteTeam members={data.staff} canBook={capabilities.canBook} onBook={openBooking} onOpen={setDetailStaff} salonId={profile.salonId}/></section>;
    if (data.staff.length === 0) {
      return (
        <EmptyState title="Team is not published yet">
          Artists will appear when active staff profiles are available.
        </EmptyState>
      );
    }

    return <TeamMenu members={data.staff} canBook={capabilities.canBook} bookingHref={staffId=>bookingHref({staffId,title:"Book with professional"})} onOpen={setDetailStaff}/>;
  }

  function renderExperiences() {
    const visibleExperiences =
      experienceFilter === "verified"
        ? data.experiences.filter(
            (experience) => experience.verificationStatus === "verified",
          )
        : experienceFilter === "issues"
          ? data.experiences.filter(
              (experience) => experience.feedbackState === "issue",
            )
          : experienceFilter === "good" ? data.experiences.filter(experience=>experience.feedbackState==="good") : data.experiences;

    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,.45fr)]">
        <div className="grid gap-4">
          <ExperienceSummaryPanel summary={data.reputationSummary} />
          <div className="flex flex-wrap gap-2">
            {(["all", "verified", "good", "issues"] as const).map((filter) => (
              <button
                aria-pressed={experienceFilter === filter}
                className={[
                  "rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
                  experienceFilter === filter
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
                ].join(" ")}
                key={filter}
                onClick={() => setExperienceFilter(filter)}
                type="button"
              >
                {filter === "all"
                  ? "All Experiences"
                  : filter === "verified"
                    ? "Verified Visits"
                    : filter === "good" ? "Good feedback" : "Concerns"}
              </button>
            ))}
          </div>
          {visibleExperiences.length > 0 ? (
            <div className="grid gap-3" id="customer-experiences">
              {visibleExperiences.map((experience) => (
                <ExperienceCard
                  canReplyAsSalon={capabilities.canReplyAsSalon}
                  experience={experience}
                  key={experience.id}
                  onPosted={refresh}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="No Experiences yet">
              {experienceFilter === "verified"
                ? "Shared Experiences tied to Verified Visits will appear here after customers respond from their Activity."
                : experienceFilter === "issues"
                  ? "Issue Experiences will appear here when customers report a problem."
                  : "Customers can share a lightweight Experience after a verified POS visit."}
            </EmptyState>
          )}
        </div>
        <aside className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            After a visit
          </p>
          <h3 className="mt-3 font-semibold text-zinc-950">
            Feedback starts from a Verified Visit.
          </h3>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Customers see Good / Had an issue in their Activity after a completed
            POS ticket is linked to their active account. Details are optional.
          </p>
        </aside>
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
            {(salonAboutParagraphs(profile).length ? salonAboutParagraphs(profile) : ["This salon is still shaping its public story."]).map((text, index) => <span key={index} className="block whitespace-pre-line [&+span]:mt-4">{text}</span>)}
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
              <div><h5 className="mb-3 font-semibold text-zinc-950">Operating hours</h5><OperatingHoursDisplay salonId={profile.salonId} initialSettings={data.operatingHours} /></div>
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
          {preferences.show_team && data.staff.length > 0 ? (
            <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-[0_18px_55px_rgba(24,24,27,.06)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-zinc-950">Team preview</h4>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatSalonProfileTeamCount(data.staff.length)}
                  </p>
                </div>
                <button
                  className="text-sm font-semibold text-zinc-600 underline-offset-4 hover:text-zinc-950 hover:underline"
                  onClick={() => changeTab("team")}
                  type="button"
                >
                  View team ({data.staff.length})
                </button>
              </div>
              <TeamPreviewRows
                onViewTeam={() => changeTab("team")}
                staff={data.staff}
              />
            </section>
          ) : null}
        </aside>
      </div>
    );
  }

  const effectiveTab = visibleTabs.some((tab) => tab.id === selectedTab) ? selectedTab : "discover";
  const tabPanel =
    effectiveTab === "discover"
      ? renderDiscover()
      : effectiveTab === "gallery"
        ? renderGallery()
        : effectiveTab === "services"
          ? renderServices()
          : effectiveTab === "team"
            ? renderTeam()
            : effectiveTab === "experiences"
              ? renderExperiences()
              : renderAbout();
  const canShowFollow = capabilities.canFollow && !isManagedViewer;
  const canShowBook = capabilities.canBook && (!isManagedViewer || capabilities.isOwnSalon);

  return (
    <ProfilePreferencesContext.Provider value={preferences}>
    <div className={`min-w-0 overflow-x-hidden bg-[#f6f5f3] text-zinc-950 ${isWebsiteView ? websitePageStyles.shell : ""}`} style={effectiveTab === "services" || effectiveTab === "team" ? {backgroundColor:"white"} : undefined}>
      <div className="mx-auto grid w-full max-w-[88rem] gap-3 px-4 pb-3 pt-3 sm:px-6 lg:px-8">
        {data.directoryListing?.claimState === "unclaimed" ? (
          <aside aria-label="Unclaimed business profile" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <span className="font-semibold">Unclaimed business</span>
            <a href={`/claim/${profile.salonId}`} className="rounded-lg bg-amber-950 px-3 py-2 text-xs font-semibold text-white">Own this salon? Claim it</a>
            <span>Contact salon</span>
            {profile.phone ? <a href={`tel:${profile.phone}`} className="font-semibold underline">{profile.phone}</a> : null}
          </aside>
        ) : !capabilities.isOwnSalon ? (
          <div className="flex justify-end text-xs text-zinc-500"><a href={`/claim/${profile.salonId}`} className="underline">Manage this salon? Request access</a></div>
        ) : null}
        {isWebsiteView ? <SalonWebsiteHeader
          profile={profile} layout={preferences.layout} tabs={mainTabs} extraTabs={visibleTabs.filter(tab => !mainTabs.includes(tab))} selectedTab={effectiveTab} introVisible={preferences.show_featured !== false}
          onTab={id => changeTab(id as TabId)} onTabKeyDown={onTabKeyDown}
          verified={<SalonVerifiedBadge verified={data.reputationSummary.identityVerified}/>}
          trust={<SalonTrustLine signals={data.reputationSummary} href="#lumi-trust" name={profile.name} expanded className="text-zinc-600"/>}
          priceHint={salonPopularPrice(data.reputationSummary)}
          canBook={canShowBook} onBook={() => openBooking({title:"Book appointment"})}
          canFollow={canShowFollow} following={isFollowing} followPending={isPending} onFollow={toggleFollow}
          onHours={() => setHoursInfoOpen(true)} canShare={preferences.allow_sharing} onShare={() => { void shareSalon(); }}
          tools={capabilities.canEditProfile ? <div className="relative">
              {capabilities.canEditProfile ? <button aria-label="Profile settings" title="Profile settings" aria-expanded={ownerMenuOpen} aria-haspopup="menu" ref={ownerMenuButtonRef} className="grid size-11 place-items-center rounded-xl text-zinc-700 transition-colors hover:bg-brand-orange-soft hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange" onClick={() => setOwnerMenuOpen((current) => !current)} type="button"><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h3m4 0h11M3 12h11m4 0h3M3 18h5m4 0h9" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></svg></button> : null}
              {ownerMenuOpen && capabilities.canEditProfile ? <div ref={ownerMenuRef} role="menu" className="absolute right-0 top-12 z-40 grid w-56 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
                <button role="menuitem" type="button" className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-zinc-50" onClick={() => { setOwnerMenuOpen(false); setProfileSettingsOpen(true); }}>Profile settings</button>
                <button role="menuitem" type="button" className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-zinc-50" onClick={() => { setOwnerMenuOpen(false); setOperatingHoursOpen(true); }}>Operating hours</button>
                <button role="menuitem" type="button" className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-zinc-50" onClick={() => { setOwnerMenuOpen(false); setProfileEditorOpen(true); }}>Edit profile</button>
                {manageData && capabilities.canPublish ? <button role="menuitem" type="button" className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-zinc-50" onClick={() => { setOwnerMenuOpen(false); setPublicationOpen(true); }}>Publication settings</button> : null}
              </div> : null}
            </div> : null}
        /> : (
        <section className="group min-w-0 rounded-2xl border border-zinc-200/80 bg-white shadow-sm">
          <div className="relative h-[72px] overflow-hidden rounded-t-2xl bg-zinc-100 sm:h-24">
            <SalonCover coverImageUrl={profile.coverImageUrl} name={profile.name} />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.7) 55%, #fff 100%)" }} />
          </div>
          <div className="relative z-10 -mt-6 grid min-w-0 grid-cols-[64px_minmax(0,1fr)_auto] items-start gap-x-2 px-3 pb-3 sm:px-5">
            <div className="min-w-0">
              <div className="size-14 overflow-hidden rounded-full border-[3px] border-white bg-white shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {profile.logoImageUrl ? <img alt={`${profile.name} logo`} src={profile.logoImageUrl} className="size-full object-cover" /> : <span className="grid size-full place-items-center bg-brand-orange-soft text-sm font-semibold text-brand-orange">{profile.name.slice(0, 2)}</span>}
              </div>
            </div>
            <div className="min-w-0 px-2 py-1">
              <div className="flex min-w-0 items-center gap-1.5"><h2 className="min-w-0 break-words text-xl font-semibold leading-6">{profile.name}</h2><SalonVerifiedBadge verified={data.reputationSummary.identityVerified}/></div>
              <SalonTrustLine signals={data.reputationSummary} href="#lumi-trust" name={profile.name} expanded className="text-zinc-600"/>
              <p className="truncate text-[11px] leading-5 text-zinc-500">{salonPopularPrice(data.reputationSummary)??"Salon"}{profile.city?` · ${profile.city}${profile.state?`, ${profile.state}`:""}`:""}</p>


            </div>
            <div className="relative">
              {capabilities.canEditProfile ? <button aria-label="Profile settings" title="Profile settings" aria-expanded={ownerMenuOpen} aria-haspopup="menu" ref={ownerMenuButtonRef} className="grid size-11 place-items-center rounded-xl text-zinc-700 transition-colors hover:bg-brand-orange-soft hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange" onClick={() => setOwnerMenuOpen((current) => !current)} type="button"><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h3m4 0h11M3 12h11m4 0h3M3 18h5m4 0h9" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></svg></button> : null}
              {ownerMenuOpen && capabilities.canEditProfile ? <div ref={ownerMenuRef} role="menu" className="absolute right-0 top-12 z-40 grid w-56 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
                <button role="menuitem" type="button" className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-zinc-50" onClick={() => { setOwnerMenuOpen(false); setProfileSettingsOpen(true); }}>Profile settings</button>
                <button role="menuitem" type="button" className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-zinc-50" onClick={() => { setOwnerMenuOpen(false); setOperatingHoursOpen(true); }}>Operating hours</button>
                <button role="menuitem" type="button" className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-zinc-50" onClick={() => { setOwnerMenuOpen(false); setProfileEditorOpen(true); }}>Edit profile</button>
                {manageData && capabilities.canPublish ? <button role="menuitem" type="button" className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-zinc-50" onClick={() => { setOwnerMenuOpen(false); setPublicationOpen(true); }}>Publication settings</button> : null}
              </div> : null}
            </div>
              <button type="button" aria-label="View salon operating hours" aria-haspopup="dialog" className="col-span-3 mt-1 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-0.5 text-left text-xs leading-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-orange" onClick={() => setHoursInfoOpen(true)}>
                <span className={profile.operatingStatus.isOpen ? "font-semibold text-emerald-700" : profile.operatingStatus.kind === "hours_unset" ? "font-semibold text-zinc-500" : "font-semibold text-red-600"}>{profile.operatingStatus.label}</span>
                {profile.operatingStatus.detail ? <span className="text-zinc-500"><span aria-hidden="true" className="mr-2">·</span>{profile.operatingStatus.detail}</span> : null}
              </button>
          </div>
          {canShowFollow || canShowBook ? <div className={`flex items-center justify-end gap-3 px-3 pb-3 sm:relative sm:-mt-11 sm:px-5 ${capabilities.canEditProfile ? "sm:pr-20" : ""}`}>{canShowFollow ? <button type="button" aria-pressed={isFollowing} disabled={isPending} onClick={toggleFollow} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-brand-orange disabled:opacity-50"><span aria-hidden="true">{isFollowing ? "✓" : "+"}</span>{isFollowing ? "Following" : "Follow salon"}</button> : null}{canShowBook ? <button type="button" onClick={() => openBooking({ title: "Book now" })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-orange px-5 text-sm font-semibold text-white transition hover:bg-brand-orange-hover">Book appointment <span aria-hidden="true">→</span></button> : null}</div> : null}
          <div className="relative flex min-w-0 items-center border-t border-zinc-100 px-2 sm:px-4">
            <div aria-label="Salon profile sections" className="flex min-w-0 flex-1" onKeyDown={onTabKeyDown} role="tablist">
              {mainTabs.map((tab) => <button aria-controls={`salon-profile-${tab.id}`} aria-selected={effectiveTab === tab.id} className={`min-h-11 min-w-0 flex-1 border-b-2 px-1 text-xs font-semibold sm:text-sm ${effectiveTab === tab.id ? "border-brand-orange text-brand-orange" : "border-transparent text-zinc-500 hover:text-zinc-950"}`} id={`salon-profile-tab-${tab.id}`} key={tab.id} onClick={() => changeTab(tab.id)} role="tab" tabIndex={effectiveTab === tab.id ? 0 : -1} type="button">{tab.label}{tab.id === "gallery" && sortedLooks.length ? <span className="ml-1 text-[10px] text-zinc-400">{sortedLooks.length}</span> : null}</button>)}
            </div>
            <details data-dismissible-popover className="relative shrink-0"><summary aria-label="More profile sections and actions" className="grid size-11 cursor-pointer list-none place-items-center rounded-xl text-lg text-zinc-600 hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">•••</summary><div className="absolute right-0 top-12 z-40 grid w-48 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
              {visibleTabs.filter((tab) => !mainTabs.includes(tab)).map((tab) => <button id={`salon-profile-tab-${tab.id}`} key={tab.id} className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-zinc-50" type="button" onClick={(event) => { changeTab(tab.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{tab.label}</button>)}
              {preferences.allow_sharing ? <button className="min-h-11 rounded-lg px-3 text-left text-sm hover:bg-zinc-50" type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void shareSalon(); }}>Share profile</button> : null}
            </div></details>
          </div>
        </section>
        )}
        {error || notice || statusMessage ? <section className="grid gap-3">
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
        </section> : null}
      </div>

      <section
        aria-labelledby={`salon-profile-tab-${effectiveTab}`}
        className={effectiveTab === "services" || effectiveTab === "team" ? "mx-auto w-full max-w-[88rem] pb-24" : "mx-auto w-full max-w-[88rem] px-4 pb-24 sm:px-6 lg:px-8"}
        id={`salon-profile-${effectiveTab}`}
        role="tabpanel"
      >
        {tabPanel}
      </section>

      {primaryMobileLook && canShowBook && manageData && !capabilities.isOwnSalon ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-10px_30px_rgba(24,24,27,.12)] backdrop-blur md:hidden">
          <div className="mx-auto grid max-w-md auto-cols-fr grid-flow-col overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <ProfileSavePostButton
              className="min-w-0 flex-1 border-r border-zinc-100 last:border-r-0"
              initialSaved={savedLookIds.has(primaryMobileLook.id)}
              onSavedChange={(active) =>
                applyLookSaveState(primaryMobileLook, active)
              }
              saveCount={saveCounts.get(primaryMobileLook.id) ?? 0}
              size="toolbar"
              target={{
                salonId: profile.salonId,
                sourceId: primaryMobileLook.id,
                sourceType: "salon_profile_look",
              }}
            />
            <TimelineActionButton
              aria-label="Comment"
              className="border-r border-zinc-100 last:border-r-0"
              disabled={isPending}
              icon="comment"
              onClick={() =>
                setCommentTarget({
                  salonId: profile.salonId,
                  sourceId: primaryMobileLook.id,
                  sourceType: "salon_profile_look",
                  title: primaryMobileLook.title,
                })
              }
              title="Comment"
            >
              Comment
            </TimelineActionButton>
            <TimelineActionButton
              aria-label="Book exact look"
              icon="book"
              onClick={() =>
                openBooking({
                  lookId: primaryMobileLook.id,
                  note: primaryMobileLook.caption ?? primaryMobileLook.bookingNote,
                  serviceId: primaryMobileLook.serviceId,
                  staffId: primaryMobileLook.recommendedStaffId,
                  title: "Book this exact look",
                })
              }
              title="Book exact look"
              tone="primary"
            >
              Book
            </TimelineActionButton>
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {statusMessage}
      </p>

      {authPromptIntent ? (
        <AuthIntentPrompt
          kicker={authPromptIntent === "follow" ? "Follow intent" : "Save intent"}
          onClose={() => setAuthPromptIntent(null)}
          title={
            authPromptIntent === "follow"
              ? `Follow ${profile.name}?`
              : "Save this look?"
          }
        >
          {authPromptIntent === "follow"
            ? "Create a free ReyLUMI account to follow this shop and find it again from your discovery hub."
            : "Create a free ReyLUMI account to keep this look, follow the shop, and return when you are ready to book."}
        </AuthIntentPrompt>
      ) : null}

      {composerType ? (
        <ComposerModal
          data={data}
          initialType={composerType}
          onClose={() => setComposerType(null)}
          onPosted={({ post, look }) => {
            setPublishedPosts((current) => [post, ...current.filter((item) => item.id !== post.id)]);
            if (look) setPublishedLooks((current) => [look, ...current.filter((item) => item.id !== look.id)]);
            setSelectedTab("discover");
            setVisibleTimelineCount((current) => Math.max(current, INITIAL_TIMELINE_ITEM_COUNT));
            setStatusMessage("Post published.");
            requestAnimationFrame(() => requestAnimationFrame(() => {
              document.getElementById(`${post.contentType}-${post.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }));
          }}
        />
      ) : null}
      {profileSettingsOpen ? <Modal title="Profile settings" onClose={() => setProfileSettingsOpen(false)}>
        <div className="grid gap-5">
          <button type="button" className="flex min-h-11 items-center justify-between border-b border-zinc-200 py-3 text-left text-sm" onClick={() => { setProfileSettingsOpen(false); setOperatingHoursOpen(true); }}><span>Operating hours</span><span aria-hidden="true">›</span></button>
          <SalonProfilePreferencesPanel onSaved={(next) => { setEditedPreferences(next); if ((!next.show_team && selectedTab === "team") || (!next.show_services && selectedTab === "services")) setSelectedTab("discover"); }} />
          <div className="flex flex-wrap gap-2"><MediaApplyButton kind="cover" label="Change cover" salonId={profile.salonId} /><MediaApplyButton kind="logo" label="Change logo" salonId={profile.salonId} /></div>
          <a href="/settings?section=salon-profile" className="text-sm font-medium text-brand-orange">All profile settings</a>
        </div>
      </Modal> : null}
      {operatingHoursOpen ? <Modal title="Operating hours" onClose={() => setOperatingHoursOpen(false)}><OperatingHoursQuick salonId={profile.salonId} /></Modal> : null}
      {hoursInfoOpen ? <Modal title="Operating hours" onClose={() => setHoursInfoOpen(false)}><OperatingHoursDisplay salonId={profile.salonId} initialSettings={data.operatingHours} /></Modal> : null}
      {contentManagerOpen ? <Modal title="Featured photo & salon posts" onClose={() => setContentManagerOpen(false)}>{renderDiscover(true)}</Modal> : null}
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
          <ProfilePostCommentThread
            initialCount={commentCountForTarget(commentTarget, 0)}
            onCountChange={(count) =>
              updateCommentCountForTarget(commentTarget, count)
            }
            target={commentTarget}
            viewer={postCommentViewer(capabilities)}
          />
        </Modal>
      ) : null}
      {detailLook ? (
        <LookDetailDialog
          capabilities={capabilities}
          commentCount={commentCountForTarget(
            {
              salonId: profile.salonId,
              sourceId: detailLook.id,
              sourceType: "salon_profile_look",
              title: detailLook.title,
            },
            detailLook.commentCount,
          )}
          isSaved={savedLookIds.has(detailLook.id)}
          look={detailLook}
          onBook={openBooking}
          onClose={() => setDetailLook(null)}
          onCommentCountChange={updateCommentCountForTarget}
          onSave={toggleSave}
          onShare={() => void shareSalon()}
          onViewInTimeline={viewInTimeline}
          saveCount={saveCounts.get(detailLook.id) ?? 0}
          salonId={profile.salonId}
        />
      ) : null}
      {detailPost ? (
        <FeedPostDetailDialog
          capabilities={capabilities}
          commentCount={commentCountForTarget(
            profileFeedCommentTarget(
              detailPost,
              detailPost.contentType === "look"
                ? detailPost.title
                : detailPost.caption || detailPost.title || "Salon update",
            ),
            detailPost.commentCount,
          )}
          item={detailPost}
          onBook={openBooking}
          onClose={() => setDetailPost(null)}
          onCommentCountChange={updateCommentCountForTarget}
          onShare={shareSalon}
          onViewInTimeline={viewInTimeline}
          postActions={renderPostActions(detailPost)}
        />
      ) : null}
      {detailBeautyPost ? (
        <BeautyPostDetailDialog
          capabilities={capabilities}
          commentCount={commentCountForTarget(
            beautyPostCommentTarget(detailBeautyPost, profile.salonId),
            detailBeautyPost.commentCount,
          )}
          onClose={() => setDetailBeautyPost(null)}
          onCommentCountChange={updateCommentCountForTarget}
          onViewInTimeline={viewInTimeline}
          post={detailBeautyPost}
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
    </ProfilePreferencesContext.Provider>
  );
}
