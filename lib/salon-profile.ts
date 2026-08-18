import "server-only";

import { beautyPostBookingPresentation } from "@/lib/beauty-booking-verification";
import { loadBeautyPostVerifiedBookingCounts } from "@/lib/beauty-post-booking-counts";
import { getBeautyMediaPublicUrl } from "@/lib/beauty-media";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
  isSalonStaffContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { syncCurrentSalonMapLocationAddressState } from "@/lib/location/salon-map-location";
import { hasPermission, requirePermission } from "@/lib/permissions";
import {
  SALON_PROFILE_MEDIA_BUCKET,
  isSalonProfileMediaPathForSalon,
  normalizeSalonProfileMediaPath,
  parseSalonProfileMediaPath,
  type SalonProfileMediaKind,
} from "@/lib/salon-profile-media";
import { SERVICE_SELECT } from "@/lib/services";
import { resolveStaffAccountForSalon } from "@/lib/staff-account";
import {
  createAuthenticatedSupabaseServerClient,
  createSupabaseServerClient,
  getSupabaseConfig,
} from "@/lib/supabase/server";
import { STAFF_LEGACY_SELECT } from "@/lib/staff";
import type {
  PublicSalonProfile,
  PublicSalonProfileBeautyPost,
  PublicSalonProfileBeautyPostMedia,
  PublicSalonProfileComment,
  PublicSalonProfileData,
  PublicSalonProfileLook,
  PublicSalonProfileReview,
  PublicSalonProfileReviewSummary,
  PublicSalonProfileService,
  PublicSalonProfileStaff,
  PublicSalonProfileUpdate,
  ProfileFeedItem,
  SalonProfileReadiness,
  SalonProfileLook,
  SalonProfileLookStatus,
  SalonProfileSetting,
  SalonProfileUpdate,
  SalonProfileUpdateType,
} from "@/types/salon-profile";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";

export const SALON_PROFILE_PERMISSIONS = {
  view: "salon_profile.view",
  manage: "salon_profile.manage",
  contentManage: "salon_profile.content.manage",
} as const;

export const SALON_PROFILE_SETTING_SELECT =
  "id, salon_id, business_name, phone, email, website, address_line1, address_line2, city, state, postal_code, country, business_description, allow_staff_applications, public_discovery_enabled, public_discovery_published_at, public_profile_tagline, public_profile_story, public_profile_logo_path, public_profile_cover_path, created_at, updated_at";

export const SALON_PROFILE_LOOK_SELECT =
  "id, salon_id, author_user_id, created_by_user_id, author_staff_id, author_display_name, author_avatar_path, service_id, recommended_staff_id, title, caption, emotional_description, why_love_it, mood, duration_minutes, starting_price, palette, badge, media_path, booking_note, is_pinned, status, published_at, created_at, updated_at";

export const SALON_PROFILE_UPDATE_SELECT =
  "id, salon_id, author_user_id, created_by_user_id, author_staff_id, author_display_name, author_avatar_path, service_id, staff_id, update_type, title, caption, summary, media_path, starts_at, ends_at, cta_label, status, published_at, created_at, updated_at";

type ProfileManageData = {
  canCreateContent: boolean;
  canManageContent: boolean;
  canManageIdentity: boolean;
  canViewProfile: boolean;
  context: CurrentBusinessContext;
  looks: SalonProfileLook[];
  readiness: SalonProfileReadiness;
  services: Service[];
  setting: SalonProfileSetting;
  staff: Staff[];
  updates: SalonProfileUpdate[];
};

type RpcError = {
  code?: string;
  details?: string;
  hint?: string;
  message: string;
};

type SupabaseErrorLike = {
  code?: string;
  details?: string | null;
  hint?: string | null;
  message?: string;
};
type SalonProfileSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

function serializeSupabaseError(error: SupabaseErrorLike) {
  return {
    code: error.code ?? null,
    message: error.message ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  };
}

async function loadSalonProfileStaff(
  supabase: SalonProfileSupabaseClient,
  salonId: string,
) {
  return supabase
    .from("staff")
    .select(STAFF_LEGACY_SELECT)
    .eq("salon_id", salonId)
    .order("display_name", { ascending: true })
    .returns<Staff[]>();
}

type RpcRunner = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

type PublicProfileRow = {
  account_id: string | null;
  active_service_count: number | string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  country: string | null;
  cover_path: string | null;
  description: string | null;
  email: string | null;
  follower_count: number | string | null;
  is_following: boolean | null;
  logo_path: string | null;
  phone: string | null;
  postal_code: string | null;
  public_discovery_published_at: string | null;
  salon_id: string;
  salon_name: string;
  service_categories: string[] | null;
  service_names: string[] | null;
  state: string | null;
  story: string | null;
  tagline: string | null;
  website: string | null;
};

type PublicServiceRow = {
  base_price: number | string;
  category: string | null;
  description: string | null;
  duration_minutes: number;
  id: string;
  name: string;
};

type PublicStaffRow = {
  avatar_path: string | null;
  bio: string | null;
  display_name: string;
  id: string;
  job_title: string | null;
  online_booking_enabled: boolean | null;
  portfolio_count: number | string | null;
  specialties: string[] | null;
};

type PublicLookRow = {
  author_avatar_path: string | null;
  author_display_name: string | null;
  author_staff_id: string | null;
  badge: string | null;
  booking_note: string | null;
  caption: string | null;
  comment_count: number | string | null;
  duration_minutes: number | null;
  emotional_description: string | null;
  id: string;
  is_pinned: boolean | null;
  is_saved: boolean | null;
  media_path: string | null;
  mood: string | null;
  palette: string[] | null;
  published_at: string | null;
  recommended_staff_id: string | null;
  recommended_staff_name: string | null;
  save_count: number | string | null;
  service_id: string | null;
  service_name: string | null;
  starting_price: number | string | null;
  hashtags: string[] | null;
  title: string;
  why_love_it: string | null;
};

type PublicUpdateRow = {
  author_avatar_path: string | null;
  author_display_name: string | null;
  author_staff_id: string | null;
  caption: string | null;
  comment_count: number | string | null;
  cta_label: string | null;
  ends_at: string | null;
  id: string;
  media_path: string | null;
  published_at: string | null;
  service_id: string | null;
  service_name: string | null;
  staff_id: string | null;
  staff_name: string | null;
  hashtags: string[] | null;
  starts_at: string | null;
  summary: string | null;
  title: string;
  update_type: SalonProfileUpdateType;
};

type PublicBeautyPostMediaRow = {
  displayOrder?: number | string | null;
  height?: number | string | null;
  id?: string | null;
  mimeType?: string | null;
  objectPath?: string | null;
  role?: string | null;
  width?: number | string | null;
};

type PublicBeautyPostRow = {
  approved_at: string | null;
  author_avatar_url: string | null;
  author_display_name: string | null;
  booking_enabled: boolean | null;
  caption: string | null;
  created_at: string;
  media: unknown;
  post_id: string;
  post_type: string | null;
  profile_id: string;
  publication_id: string;
  staff_id: string | null;
  staff_name: string | null;
  verification_state: string | null;
};

type PublicCommentRow = {
  author_display_name: string | null;
  author_user_id: string | null;
  body: string;
  created_at: string;
  id: string;
  is_salon_reply: boolean | null;
  look_id: string | null;
  parent_comment_id: string | null;
  salon_id: string;
  updated_at: string;
  update_id: string | null;
};

type PublicReviewSummaryRow = {
  average_rating: number | string | null;
  rating_1_count: number | string | null;
  rating_2_count: number | string | null;
  rating_3_count: number | string | null;
  rating_4_count: number | string | null;
  rating_5_count: number | string | null;
  review_count: number | string | null;
  verified_count: number | string | null;
};

type PublicReviewRow = {
  author_display_name: string | null;
  author_user_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  id: string;
  rating: number;
  reply_body: string | null;
  reply_created_at: string | null;
  reply_id: string | null;
  salon_id: string;
  title: string | null;
  updated_at: string;
  verification_status: "unverified" | "verified";
  verified_booking_id: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function optionalText(value: string | null | undefined) {
  const text = clean(value);
  return text || null;
}

const HASHTAG_PATTERN = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_][\p{L}\p{N}_-]{1,47})/gu;

function normalizeHashtag(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/-+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function extractHashtags(value: string | null | undefined) {
  const text = value ?? "";
  const tags = new Set<string>();

  for (const match of text.matchAll(HASHTAG_PATTERN)) {
    const tag = normalizeHashtag(match[2] ?? "");

    if (tag.length >= 2) {
      tags.add(tag);
    }

    if (tags.size >= 10) {
      break;
    }
  }

  return [...tags];
}

function deriveSocialTitle(value: string | null | undefined, fallback: string) {
  const firstLine = clean(value).split(/\r?\n/)[0]?.trim() ?? "";

  if (!firstLine) {
    return fallback;
  }

  return firstLine.length > 72 ? `${firstLine.slice(0, 69).trim()}...` : firstLine;
}

function readCount(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function readMoney(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function publicBeautyPostMediaRole(
  value: string | null | undefined,
): "after" | "before" | "image" | null {
  return value === "after" || value === "before" || value === "image"
    ? value
    : null;
}

function publicBeautyVerificationState(
  value: string | null | undefined,
): PublicSalonProfileBeautyPost["verificationState"] {
  if (
    value === "pending" ||
    value === "rejected" ||
    value === "unverified" ||
    value === "verified"
  ) {
    return value;
  }

  return null;
}

function publicBeautyPostType(value: string | null | undefined) {
  return value === "before_after" ? "before_after" : "regular";
}

type SalonProfileAuthorSnapshot = {
  avatarPath: string | null;
  displayName: string;
  staffId: string | null;
};

async function resolveCurrentSalonProfileAuthor(input: {
  context: CurrentBusinessContext;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
}): Promise<SalonProfileAuthorSnapshot> {
  const resolution = await resolveStaffAccountForSalon(input);

  if (resolution.status === "multiple") {
    throw new Error(
      "Multiple active staff profiles are linked to your account for this salon.",
    );
  }

  if (resolution.status === "found") {
    return {
      avatarPath: resolution.staff.public_profile_photo_path,
      displayName: resolution.staff.display_name,
      staffId: resolution.staff.id,
    };
  }

  return {
    avatarPath: null,
    displayName:
      input.context.user?.display_name ??
      input.context.user?.email ??
      input.context.currentSalon?.name ??
      "Salon team",
    staffId: null,
  };
}

async function attachHashtagsToPost(input: {
  hashtags: string[];
  accountId: string;
  postId: string;
  postType: "look" | "update";
  salonId: string;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
}) {
  if (input.hashtags.length === 0) {
    return;
  }

  const tagRows = input.hashtags.map((tag) => ({ tag }));
  const { data: tags, error: tagError } = await input.supabase
    .from("salon_profile_hashtags")
    .upsert(tagRows, { onConflict: "tag" })
    .select("id, tag")
    .returns<Array<{ id: string; tag: string }>>();

  if (tagError) {
    throw new Error(tagError.message);
  }

  const tagIds = new Map((tags ?? []).map((tag) => [tag.tag, tag.id]));
  const relationRows = input.hashtags
    .map((slug) => tagIds.get(slug))
    .filter((tagId): tagId is string => Boolean(tagId))
    .map((tagId) =>
      input.postType === "look"
        ? {
            hashtag_id: tagId,
            look_id: input.postId,
            salon_id: input.salonId,
          }
        : {
            hashtag_id: tagId,
            salon_id: input.salonId,
            update_id: input.postId,
          },
    );

  if (relationRows.length === 0) {
    return;
  }

  const table =
    input.postType === "look"
      ? "salon_profile_look_hashtags"
      : "salon_profile_update_hashtags";
  const { error } = await input.supabase.from(table).upsert(relationRows);

  if (error) {
    throw new Error(error.message);
  }
}

async function saveContentBookingConfig(input: {
  additionalServiceIds?: string[];
  bookingCtaEnabled?: boolean;
  bookingNote?: string | null;
  contentId: string;
  creditedStaffId?: string | null;
  primaryServiceId?: string | null;
  sourceType: "salon_profile_look" | "salon_profile_update";
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
}) {
  const shouldSave =
    input.bookingCtaEnabled !== undefined ||
    Boolean(input.primaryServiceId) ||
    Boolean(input.creditedStaffId) ||
    Boolean(input.bookingNote) ||
    (input.additionalServiceIds?.length ?? 0) > 0;

  if (!shouldSave) {
    return;
  }

  const { error } = await input.supabase.rpc(
    "save_salon_profile_content_booking_config",
    {
      p_additional_service_ids: input.additionalServiceIds ?? [],
      p_booking_cta_enabled: input.bookingCtaEnabled ?? true,
      p_booking_note: input.bookingNote ?? null,
      p_content_id: input.contentId,
      p_credited_staff_id: input.creditedStaffId ?? null,
      p_primary_service_id: input.primaryServiceId ?? null,
      p_source_type: input.sourceType,
    },
  );

  if (error) {
    throw new Error(error.message);
  }
}

export function getSalonProfileMediaUrl(path: string | null | undefined) {
  const cleanedPath = normalizeSalonProfileMediaPath(path);

  if (!cleanedPath) {
    return null;
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  return supabase.storage
    .from(SALON_PROFILE_MEDIA_BUCKET)
    .getPublicUrl(cleanedPath).data.publicUrl;
}

function getPublicBeautyMediaUrl(path: string | null | undefined) {
  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  return getBeautyMediaPublicUrl({
    path,
    supabaseUrl: config.supabaseUrl,
  });
}

function requireCurrentAccountAndSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context) && !isSalonStaffContext(context)) {
    throw new Error("Open Salon Profile from a salon workspace.");
  }

  if (!context.currentAccount) {
    throw new Error("Choose a salon workspace before managing the salon profile.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    Account: context.currentAccount,
    salon: context.currentSalon,
  };
}

async function resolveStaffContentPostingProfile(input: {
  context: CurrentBusinessContext;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
}) {
  if (!isSalonStaffContext(input.context)) {
    return null;
  }

  const resolution = await resolveStaffAccountForSalon(input);

  if (resolution.status === "multiple") {
    throw new Error(
      "Multiple active staff profiles are linked to your account for this salon.",
    );
  }

  if (resolution.status !== "found") {
    return null;
  }

  const canManageContent = await hasPermission(
    SALON_PROFILE_PERMISSIONS.contentManage,
    input.context,
  );

  return canManageContent || resolution.staff.salon_profile_content_posting_enabled
    ? resolution.staff
    : null;
}

export async function canCreateSalonProfileContent(
  context: CurrentBusinessContext,
) {
  if (await hasPermission(SALON_PROFILE_PERMISSIONS.contentManage, context)) {
    return true;
  }

  if (!isSalonStaffContext(context)) {
    return false;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return false;
  }

  return Boolean(
    await resolveStaffContentPostingProfile({
      context,
      supabase,
    }),
  );
}

async function requireSalonProfileContentCreatePermission(input: {
  context: CurrentBusinessContext;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
}) {
  if (isSalonStaffContext(input.context)) {
    const staff = await resolveStaffContentPostingProfile(input);

    if (!staff) {
      throw new Error("You do not have permission to post to this Salon Profile.");
    }

    return staff;
  }

  if (await hasPermission(SALON_PROFILE_PERMISSIONS.contentManage, input.context)) {
    return null;
  }
  throw new Error("You do not have permission to post to this Salon Profile.");
}

function fallbackSetting(context: CurrentBusinessContext): SalonProfileSetting {
  const { salon } = requireCurrentAccountAndSalon(context);
  const now = new Date().toISOString();

  return {
    address_line1: salon.address_line1,
    address_line2: salon.address_line2,
    allow_staff_applications: false,
    business_description: null,
    business_name: salon.name,
    city: salon.city,
    country: salon.country,
    created_at: now,
    email: null,
    id: "",
    phone: salon.phone,
    postal_code: salon.postal_code,
    public_discovery_enabled: false,
    public_discovery_published_at: null,
    public_profile_cover_path: null,
    public_profile_logo_path: null,
    public_profile_story: null,
    public_profile_tagline: null,
    salon_id: salon.id,
    state: salon.state,
    updated_at: now,
    website: null,
  };
}

function settingWithSalonName(
  setting: SalonProfileSetting,
  context: CurrentBusinessContext,
) {
  const salonName = context.currentSalon?.name?.trim();

  if (!salonName || setting.business_name === salonName) {
    return setting;
  }

  return {
    ...setting,
    business_name: salonName,
  };
}

function mapLookRelations(
  looks: SalonProfileLook[],
  services: Service[],
  staff: Staff[],
) {
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const staffById = new Map(staff.map((member) => [member.id, member]));

  return looks.map((look) => ({
    ...look,
    recommended_staff: look.recommended_staff_id
      ? {
          display_name:
            staffById.get(look.recommended_staff_id)?.display_name ??
            "Recommended artist",
          id: look.recommended_staff_id,
        }
      : null,
    service: look.service_id
      ? {
          id: look.service_id,
          name: serviceById.get(look.service_id)?.name ?? "Related service",
        }
      : null,
  }));
}

function mapUpdateRelations(
  updates: SalonProfileUpdate[],
  services: Service[],
  staff: Staff[],
) {
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const staffById = new Map(staff.map((member) => [member.id, member]));

  return updates.map((update) => ({
    ...update,
    service: update.service_id
      ? {
          id: update.service_id,
          name: serviceById.get(update.service_id)?.name ?? "Related service",
        }
      : null,
    staff: update.staff_id
      ? {
          display_name:
            staffById.get(update.staff_id)?.display_name ?? "Salon artist",
          id: update.staff_id,
        }
      : null,
  }));
}

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function getLocationLabel(setting: SalonProfileSetting) {
  return [
    setting.address_line1,
    setting.city,
    setting.state,
    setting.postal_code,
  ].filter(hasText);
}

export function getSalonProfileReadiness(input: {
  looks: SalonProfileLook[];
  services: Service[];
  setting: SalonProfileSetting;
  staff: Staff[];
}): SalonProfileReadiness {
  const publishedLookCount = input.looks.filter(
    (look) => look.status === "published",
  ).length;
  const activeServiceCount = input.services.filter(
    (service) => service.is_active,
  ).length;
  const activeStaffCount = input.staff.filter((member) => member.is_active).length;
  const requiredItems = [
    {
      complete: hasText(input.setting.business_name),
      id: "business-name",
      label: "Public business name",
      required: true,
    },
    {
      complete: hasText(input.setting.public_profile_tagline),
      id: "tagline",
      label: "Tagline",
      required: false,
    },
    {
      complete: hasText(input.setting.public_profile_logo_path),
      id: "logo",
      label: "Logo",
      required: true,
    },
    {
      complete: hasText(input.setting.public_profile_cover_path),
      id: "cover",
      label: "Cover image",
      required: true,
    },
    {
      complete: getLocationLabel(input.setting).length >= 4 && hasText(input.setting.phone),
      id: "location-contact",
      label: "Valid location and contact",
      required: true,
    },
    {
      complete: activeServiceCount > 0,
      id: "active-service",
      label: "At least one active service",
      required: true,
    },
    {
      complete: publishedLookCount > 0,
      id: "published-look",
      label: "At least one published look",
      required: true,
    },
  ];
  const optionalItems = [
    {
      complete: hasText(input.setting.public_profile_story),
      id: "story",
      label: "Salon story",
      required: false,
    },
    {
      complete: hasText(input.setting.website),
      id: "website",
      label: "Website",
      required: false,
    },
    {
      complete: publishedLookCount >= 3,
      id: "three-looks",
      label: "Three or more published looks",
      required: false,
    },
    {
      complete: activeStaffCount > 0,
      id: "team",
      label: "Active team members",
      required: false,
    },
  ];
  const items = [...requiredItems, ...optionalItems];
  const completedCount = items.filter((item) => item.complete).length;
  const missingRequiredItems = requiredItems
    .filter((item) => !item.complete)
    .map((item) => item.label);
  const canPublish = missingRequiredItems.length === 0;
  const isPublished = input.setting.public_discovery_enabled && canPublish;

  return {
    canPublish,
    completionPercent: Math.round((completedCount / items.length) * 100),
    isExploreEligible: isPublished,
    items,
    missingRequiredItems,
    status: isPublished
      ? "published"
      : canPublish
        ? "ready"
        : hasText(input.setting.business_name)
          ? "draft"
          : "incomplete",
  };
}

async function getExistingSalonProfileSetting(context: CurrentBusinessContext) {
  const { salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("salon_settings")
    .select(SALON_PROFILE_SETTING_SELECT)
    .eq("salon_id", salon.id)
    .maybeSingle<SalonProfileSetting>();

  if (error) {
    const serializedError = serializeSupabaseError(error);

    console.error(
      "Supabase load salon profile setting failed",
      JSON.stringify(serializedError, null, 2),
    );
    throw new Error(
      `Supabase load salon profile setting failed (${serializedError.code ?? "unknown"}): ${
        serializedError.message ?? "Unknown error"
      }`,
    );
  }

  return data ?? null;
}

async function getOrCreateSalonProfileSetting(context: CurrentBusinessContext) {
  const existing = await getExistingSalonProfileSetting(context);

  if (existing) {
    return existing;
  }

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("salon_settings")
    .insert({
      address_line1: salon.address_line1,
      address_line2: salon.address_line2,
      allow_staff_applications: false,
      business_name: salon.name,
      city: salon.city,
      country: salon.country,
      phone: salon.phone,
      postal_code: salon.postal_code,
      public_discovery_enabled: false,
      salon_id: salon.id,
      state: salon.state,
    })
    .select(SALON_PROFILE_SETTING_SELECT)
    .single<SalonProfileSetting>();

  if (error) {
    console.error("Supabase create salon profile setting failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      accountId: Account.id,
      salonId: salon.id,
    });
    throw new Error(error.message);
  }

  return data;
}

export function getSalonProfileHref(salonId: string) {
  return `/explore/salons/${encodeURIComponent(salonId)}`;
}

export function isValidSalonProfileId(value: string) {
  return UUID_PATTERN.test(value);
}

export async function getCurrentSalonProfileManageData(
  context?: CurrentBusinessContext,
): Promise<ProfileManageData> {
  const resolvedContext = context ?? (await getCurrentBusinessContext());
  const canViewProfile =
    isSalonStaffContext(resolvedContext) ||
    (await hasPermission(SALON_PROFILE_PERMISSIONS.view, resolvedContext));
  const canManageIdentity = await hasPermission(
    SALON_PROFILE_PERMISSIONS.manage,
    resolvedContext,
  );
  const canManageContent = await hasPermission(
    SALON_PROFILE_PERMISSIONS.contentManage,
    resolvedContext,
  );
  const canCreateContent =
    canManageContent || (await canCreateSalonProfileContent(resolvedContext));

  if (!canViewProfile) {
    const setting = fallbackSetting(resolvedContext);

    return {
      canCreateContent,
      canManageContent,
      canManageIdentity,
      canViewProfile,
      context: resolvedContext,
      looks: [],
      readiness: getSalonProfileReadiness({
        looks: [],
        services: [],
        setting,
        staff: [],
      }),
      services: [],
      setting,
      staff: [],
      updates: [],
    };
  }

  const { Account, salon } = requireCurrentAccountAndSalon(resolvedContext);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const [
    setting,
    servicesResult,
    staffResult,
    looksResult,
    updatesResult,
  ] = await Promise.all([
    getExistingSalonProfileSetting(resolvedContext),
    supabase
      .from("services")
      .select(SERVICE_SELECT)
      .eq("salon_id", salon.id)
      .order("name", { ascending: true })
      .returns<Service[]>(),
    loadSalonProfileStaff(supabase, salon.id),
    supabase
      .from("salon_profile_looks")
      .select(SALON_PROFILE_LOOK_SELECT)
      .eq("salon_id", salon.id)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .returns<SalonProfileLook[]>(),
    supabase
      .from("salon_profile_updates")
      .select(SALON_PROFILE_UPDATE_SELECT)
      .eq("salon_id", salon.id)
      .order("created_at", { ascending: false })
      .returns<SalonProfileUpdate[]>(),
  ]);

  for (const result of [servicesResult, staffResult, looksResult, updatesResult]) {
    if (result.error) {
      console.error("Supabase load salon profile manage data failed", {
        code: result.error.code,
        message: result.error.message,
        details: result.error.details,
        hint: result.error.hint,
        accountId: Account.id,
        salonId: salon.id,
      });
      throw new Error(result.error.message);
    }
  }

  const services = servicesResult.data ?? [];
  const staff = staffResult.data ?? [];
  const settingOrFallback = settingWithSalonName(
    setting ?? fallbackSetting(resolvedContext),
    resolvedContext,
  );
  const looks = mapLookRelations(looksResult.data ?? [], services, staff);
  const updates = mapUpdateRelations(updatesResult.data ?? [], services, staff);

  return {
    canCreateContent,
    canManageContent,
    canManageIdentity,
    canViewProfile,
    context: resolvedContext,
    looks,
    readiness: getSalonProfileReadiness({
      looks,
      services,
      setting: settingOrFallback,
      staff,
    }),
    services,
    setting: settingOrFallback,
    staff,
    updates,
  };
}

async function getPublicProfileClient() {
  return (await createAuthenticatedSupabaseServerClient()) ?? createSupabaseServerClient();
}

function mapPublicProfile(row: PublicProfileRow): PublicSalonProfile {
  return {
    activeServiceCount: readCount(row.active_service_count),
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    country: row.country,
    coverImageUrl: getSalonProfileMediaUrl(row.cover_path),
    description: row.description,
    email: row.email,
    followerCount: readCount(row.follower_count),
    isFollowing: row.is_following ?? false,
    logoImageUrl: getSalonProfileMediaUrl(row.logo_path),
    name: row.salon_name,
    accountId: row.account_id ?? "",
    phone: row.phone,
    postalCode: row.postal_code,
    publishedAt: row.public_discovery_published_at,
    salonId: row.salon_id,
    serviceCategories: toStringArray(row.service_categories),
    serviceNames: toStringArray(row.service_names),
    state: row.state,
    story: row.story,
    tagline: row.tagline,
    website: row.website,
  };
}

function mapPublicService(row: PublicServiceRow): PublicSalonProfileService {
  return {
    basePrice: readMoney(row.base_price) ?? 0,
    category: row.category,
    description: row.description,
    durationMinutes: row.duration_minutes,
    id: row.id,
    name: row.name,
  };
}

function mapPublicStaff(row: PublicStaffRow): PublicSalonProfileStaff {
  return {
    avatarUrl: getSalonProfileMediaUrl(row.avatar_path),
    bio: row.bio,
    displayName: row.display_name,
    id: row.id,
    jobTitle: row.job_title,
    onlineBookingEnabled: row.online_booking_enabled === true,
    portfolioCount: readCount(row.portfolio_count),
    specialties: toStringArray(row.specialties),
  };
}

function mapPublicLook(row: PublicLookRow): PublicSalonProfileLook {
  return {
    authorAvatarUrl: getSalonProfileMediaUrl(row.author_avatar_path),
    authorDisplayName: row.author_display_name ?? "Salon team",
    authorStaffId: row.author_staff_id,
    badge: row.badge,
    bookingNote: row.booking_note,
    caption: row.caption ?? row.emotional_description,
    commentCount: readCount(row.comment_count),
    durationMinutes: row.duration_minutes,
    emotionalDescription: row.emotional_description,
    id: row.id,
    imageUrl: getSalonProfileMediaUrl(row.media_path),
    isPinned: row.is_pinned ?? false,
    isSaved: row.is_saved ?? false,
    mood: row.mood,
    palette: toStringArray(row.palette),
    publishedAt: row.published_at,
    recommendedStaffId: row.recommended_staff_id,
    recommendedStaffName: row.recommended_staff_name,
    saveCount: readCount(row.save_count),
    serviceId: row.service_id,
    serviceName: row.service_name,
    startingPrice: readMoney(row.starting_price),
    hashtags: toStringArray(row.hashtags),
    title: row.title,
    whyLoveIt: row.why_love_it,
  };
}

function mapPublicUpdate(row: PublicUpdateRow): PublicSalonProfileUpdate {
  return {
    authorAvatarUrl: getSalonProfileMediaUrl(row.author_avatar_path),
    authorDisplayName: row.author_display_name ?? "Salon team",
    authorStaffId: row.author_staff_id,
    caption: row.caption ?? row.summary,
    commentCount: readCount(row.comment_count),
    ctaLabel: row.cta_label,
    endsAt: row.ends_at,
    id: row.id,
    imageUrl: getSalonProfileMediaUrl(row.media_path),
    publishedAt: row.published_at,
    serviceId: row.service_id,
    serviceName: row.service_name,
    staffId: row.staff_id,
    staffName: row.staff_name,
    hashtags: toStringArray(row.hashtags),
    startsAt: row.starts_at,
    summary: row.summary,
    title: row.title,
    type: row.update_type,
  };
}

function mapPublicBeautyPostMedia(
  row: PublicBeautyPostMediaRow,
): PublicSalonProfileBeautyPostMedia | null {
  const id = optionalText(row.id);
  const role = publicBeautyPostMediaRole(row.role);

  if (!id || !role) {
    return null;
  }

  return {
    displayOrder: readCount(row.displayOrder),
    height: readCount(row.height) || null,
    id,
    role,
    url: getPublicBeautyMediaUrl(optionalText(row.objectPath)),
    width: readCount(row.width) || null,
  };
}

function mapPublicBeautyPost(
  row: PublicBeautyPostRow,
  salon: {
    id: string;
    name: string;
  },
): PublicSalonProfileBeautyPost {
  const mediaRows = Array.isArray(row.media)
    ? (row.media as PublicBeautyPostMediaRow[])
    : [];
  const verificationState = publicBeautyVerificationState(row.verification_state);
  const booking = beautyPostBookingPresentation({
    bookedCount: 0,
    bookingEnabled: row.booking_enabled === true,
    labelStyle: "short",
    postId: row.post_id,
    salonId: salon.id,
    salonName: salon.name,
    source: "public_profile",
    verificationState,
  });

  return {
    approvedAt: row.approved_at,
    authorAvatarUrl: row.author_avatar_url,
    authorDisplayName: row.author_display_name ?? "Reylumi customer",
    caption: row.caption,
    id: row.post_id,
    media: mediaRows
      .map(mapPublicBeautyPostMedia)
      .filter((item): item is PublicSalonProfileBeautyPostMedia => Boolean(item)),
    booking: booking.eligible ? booking : null,
    postHref: `/explore/beauty/${encodeURIComponent(
      row.profile_id,
    )}/posts/${encodeURIComponent(row.post_id)}`,
    postType: publicBeautyPostType(row.post_type),
    profileId: row.profile_id,
    publishedAt: row.created_at,
    staffId: row.staff_id,
    staffName: row.staff_name,
    verificationState,
  };
}

function mapPublicComment(row: PublicCommentRow): PublicSalonProfileComment {
  return {
    authorDisplayName: row.author_display_name ?? "Reylumi customer",
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    isSalonReply: row.is_salon_reply ?? false,
    lookId: row.look_id,
    parentCommentId: row.parent_comment_id,
    salonId: row.salon_id,
    updatedAt: row.updated_at,
    updateId: row.update_id,
  };
}

function mapReviewSummary(
  row: PublicReviewSummaryRow | null | undefined,
): PublicSalonProfileReviewSummary {
  return {
    averageRating: readMoney(row?.average_rating),
    ratingCounts: {
      1: readCount(row?.rating_1_count),
      2: readCount(row?.rating_2_count),
      3: readCount(row?.rating_3_count),
      4: readCount(row?.rating_4_count),
      5: readCount(row?.rating_5_count),
    },
    reviewCount: readCount(row?.review_count),
    verifiedCount: readCount(row?.verified_count),
  };
}

function mapPublicReview(row: PublicReviewRow): PublicSalonProfileReview {
  return {
    authorDisplayName: row.author_display_name ?? "Reylumi customer",
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    id: row.id,
    rating: row.rating,
    replyBody: row.reply_body,
    replyCreatedAt: row.reply_created_at,
    replyId: row.reply_id,
    salonId: row.salon_id,
    title: row.title,
    updatedAt: row.updated_at,
    verificationStatus: row.verification_status,
    verifiedBookingId: row.verified_booking_id,
  };
}

export function buildSalonProfileFeed(input: {
  looks: PublicSalonProfileLook[];
  profileName: string;
  salonId: string;
  updates: PublicSalonProfileUpdate[];
}): ProfileFeedItem[] {
  const lookItems: ProfileFeedItem[] = input.looks.map((look) => ({
    authorAvatarUrl: look.authorAvatarUrl,
    authorName: look.authorDisplayName || input.profileName,
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
    salonId: input.salonId,
    saveCount: look.saveCount,
    serviceId: look.serviceId,
    serviceName: look.serviceName,
    startingPrice: look.startingPrice,
    hashtags: look.hashtags,
    title: look.title,
  }));
  const updateItems: ProfileFeedItem[] = input.updates.map((update) => ({
    authorAvatarUrl: update.authorAvatarUrl,
    authorName: update.authorDisplayName || input.profileName,
    authorStaffId: update.authorStaffId,
    bookingLookId: null,
    caption: update.caption ?? update.summary,
    commentCount: update.commentCount,
    contentType: "update",
    id: update.id,
    imageUrl: update.imageUrl,
    isPinned: false,
    publishedAt: update.publishedAt,
    salonId: input.salonId,
    serviceId: update.serviceId,
    serviceName: update.serviceName,
    staffId: update.staffId,
    staffName: update.staffName,
    hashtags: update.hashtags,
    startsAt: update.startsAt,
    title: update.title,
    updateType: update.type,
  }));

  return [...lookItems, ...updateItems].sort((left, right) => {
    if (left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1;
    }

    return (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "");
  });
}

export async function getPublicSalonProfileData(
  salonId: string,
): Promise<PublicSalonProfileData | null> {
  if (!isValidSalonProfileId(salonId)) {
    return null;
  }

  const supabase = await getPublicProfileClient();

  if (!supabase) {
    return null;
  }

  const rpc = supabase.rpc.bind(supabase) as unknown as RpcRunner;
  const [
    profileResult,
    servicesResult,
    staffResult,
    looksResult,
    updatesResult,
    beautyPostsResult,
    commentsResult,
    reviewSummaryResult,
    reviewsResult,
  ] = await Promise.all([
    rpc("get_public_salon_profile", { target_salon_id: salonId }),
    rpc("get_public_salon_profile_services", { target_salon_id: salonId }),
    rpc("get_public_salon_profile_staff", { target_salon_id: salonId }),
    rpc("get_public_salon_profile_looks", { target_salon_id: salonId }),
    rpc("get_public_salon_profile_updates", { target_salon_id: salonId }),
    rpc("get_public_salon_profile_beauty_posts", {
      p_limit: 6,
      target_salon_id: salonId,
    }),
    rpc("get_public_salon_profile_comments", { target_salon_id: salonId }),
    rpc("get_public_salon_profile_review_summary", { target_salon_id: salonId }),
    rpc("get_public_salon_profile_reviews", { target_salon_id: salonId }),
  ]);

  for (const result of [
    profileResult,
    servicesResult,
    staffResult,
    looksResult,
    updatesResult,
    beautyPostsResult,
    commentsResult,
    reviewSummaryResult,
    reviewsResult,
  ]) {
    if (result.error) {
      console.error("Supabase load public salon profile failed", {
        code: result.error.code,
        details: result.error.details,
        hint: result.error.hint,
        message: result.error.message,
        salonId,
      });
      return null;
    }
  }

  const profileRows = Array.isArray(profileResult.data)
    ? (profileResult.data as PublicProfileRow[])
    : [];
  const profile = profileRows[0];

  if (!profile) {
    return null;
  }

  const serviceRows = Array.isArray(servicesResult.data)
    ? (servicesResult.data as PublicServiceRow[])
    : [];
  const staffRows = Array.isArray(staffResult.data)
    ? (staffResult.data as PublicStaffRow[])
    : [];
  const lookRows = Array.isArray(looksResult.data)
    ? (looksResult.data as PublicLookRow[])
    : [];
  const updateRows = Array.isArray(updatesResult.data)
    ? (updatesResult.data as PublicUpdateRow[])
    : [];
  const beautyPostRows = Array.isArray(beautyPostsResult.data)
    ? (beautyPostsResult.data as PublicBeautyPostRow[])
    : [];
  const commentRows = Array.isArray(commentsResult.data)
    ? (commentsResult.data as PublicCommentRow[])
    : [];
  const reviewSummaryRows = Array.isArray(reviewSummaryResult.data)
    ? (reviewSummaryResult.data as PublicReviewSummaryRow[])
    : [];
  const reviewRows = Array.isArray(reviewsResult.data)
    ? (reviewsResult.data as PublicReviewRow[])
    : [];
  const mappedProfile = mapPublicProfile(profile);
  const looks = lookRows.map(mapPublicLook);
  const updates = updateRows.map(mapPublicUpdate);
  const beautyPosts = beautyPostRows.map((row) =>
    mapPublicBeautyPost(row, {
      id: mappedProfile.salonId,
      name: mappedProfile.name,
    }),
  );
  const beautyBookingCounts = await loadBeautyPostVerifiedBookingCounts({
    postIds: beautyPosts
      .map((post) => (post.booking?.eligible ? post.id : null))
      .filter((postId): postId is string => Boolean(postId)),
    rpc,
  });

  return {
    beautyPosts: beautyPosts.map((post) =>
      post.booking
        ? {
            ...post,
            booking: {
              ...post.booking,
              bookedCount: beautyBookingCounts.get(post.id) ?? 0,
            },
          }
        : post,
    ),
    comments: commentRows.map(mapPublicComment),
    feed: buildSalonProfileFeed({
      looks,
      profileName: mappedProfile.name,
      salonId: mappedProfile.salonId,
      updates,
    }),
    looks,
    profile: mappedProfile,
    reviewSummary: mapReviewSummary(reviewSummaryRows[0] ?? null),
    reviews: reviewRows.map(mapPublicReview),
    services: serviceRows.map(mapPublicService),
    staff: staffRows.map(mapPublicStaff),
    updates,
  };
}

function getStorageParent(path: string) {
  const parts = path.split("/");
  const name = parts.pop() ?? "";

  return {
    folder: parts.join("/"),
    name,
  };
}

type StorageObjectMetadata = {
  metadata?: {
    mimetype?: string;
    size?: number;
  };
};

async function markSalonProfileMediaAssetActive(input: {
  context: CurrentBusinessContext;
  path: string;
  processedBytes?: number | null;
  mimeType?: string | null;
}) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("salon_profile_media_assets")
    .update({
      mime_type: input.mimeType ?? null,
      processed_bytes: input.processedBytes ?? null,
      status: "active",
    })
    .eq("bucket", SALON_PROFILE_MEDIA_BUCKET)
    .eq("object_path", input.path);

  if (error) {
    console.warn("Supabase activate salon profile media asset failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      path: input.path,
      salonId: input.context.currentSalon?.id,
    });
  }
}

async function attachSalonProfileMediaAsset(input: {
  context: CurrentBusinessContext;
  entityId: string;
  entityType: "look" | "salon_setting" | "staff" | "update";
  path: string | null | undefined;
}) {
  const normalizedPath = normalizeSalonProfileMediaPath(input.path);

  if (!normalizedPath) {
    return;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("salon_profile_media_assets")
    .update({
      attached_at: new Date().toISOString(),
      attached_entity_id: input.entityId,
      attached_entity_type: input.entityType,
      orphaned_at: null,
      status: "active",
    })
    .eq("bucket", SALON_PROFILE_MEDIA_BUCKET)
    .eq("object_path", normalizedPath);

  if (error) {
    console.warn("Supabase attach salon profile media asset failed", {
      code: error.code,
      details: error.details,
      entityId: input.entityId,
      entityType: input.entityType,
      hint: error.hint,
      message: error.message,
      path: normalizedPath,
      salonId: input.context.currentSalon?.id,
    });
  }
}

async function assertTrustedSalonProfileMediaPath(input: {
  context: CurrentBusinessContext;
  allowedKinds: SalonProfileMediaKind[];
  path: string | null;
}) {
  const normalizedPath = normalizeSalonProfileMediaPath(input.path);

  if (!normalizedPath) {
    return null;
  }

  const { salon } = requireCurrentAccountAndSalon(input.context);
  const parsedPath = parseSalonProfileMediaPath(normalizedPath);

  if (
    !parsedPath ||
    parsedPath.kind === "legacy" ||
    !isSalonProfileMediaPathForSalon({
      allowedKinds: input.allowedKinds,
      path: normalizedPath,
      salonId: salon.id,
    })
  ) {
    throw new Error("Uploaded image does not belong to the current salon.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { folder, name } = getStorageParent(normalizedPath);
  const { data, error } = await supabase.storage
    .from(SALON_PROFILE_MEDIA_BUCKET)
    .list(folder, { limit: 10, search: name });

  if (error) {
    throw new Error(error.message);
  }

  const object = data?.find((storageObject) => storageObject.name === name);

  if (!object) {
    throw new Error("Uploaded image was not found in Storage.");
  }

  const metadata = (object as StorageObjectMetadata).metadata;
  const mimeType = metadata?.mimetype ?? null;
  const processedBytes = metadata?.size ?? null;

  if (mimeType && !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new Error("Uploaded image type is not allowed.");
  }

  await markSalonProfileMediaAssetActive({
    context: input.context,
    mimeType,
    path: normalizedPath,
    processedBytes,
  });

  return normalizedPath;
}

async function removeTrustedSalonProfileMediaPath(input: {
  allowLegacy?: boolean;
  context: CurrentBusinessContext;
  path: string | null | undefined;
}) {
  const normalizedPath = normalizeSalonProfileMediaPath(input.path);

  if (!normalizedPath) {
    return;
  }

  const { salon } = requireCurrentAccountAndSalon(input.context);
  const parsedPath = parseSalonProfileMediaPath(normalizedPath);

  if (!parsedPath || parsedPath.salonId !== salon.id) {
    return;
  }

  if (parsedPath.kind === "legacy" && !input.allowLegacy) {
    return;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { error } = await supabase
    .from("salon_profile_media_assets")
    .update({
      attached_entity_id: null,
      attached_entity_type: null,
      orphaned_at: new Date().toISOString(),
      status: "orphaned",
    })
    .eq("bucket", SALON_PROFILE_MEDIA_BUCKET)
    .eq("object_path", normalizedPath);

  if (error) {
    console.warn("Supabase orphan salon profile media failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      path: normalizedPath,
      salonId: salon.id,
    });
  }
}

export async function updateCurrentSalonProfileIdentity(input: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  businessName: string;
  city?: string | null;
  coverImagePath: string | null;
  country?: string | null;
  description: string | null;
  email: string | null;
  logoImagePath: string | null;
  phone: string | null;
  postalCode?: string | null;
  removeCoverImage?: boolean;
  removeLogoImage?: boolean;
  state?: string | null;
  story: string | null;
  tagline: string | null;
  website: string | null;
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to update salon profile.");
  }

  await requirePermission(SALON_PROFILE_PERMISSIONS.manage, context);

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const setting = await getOrCreateSalonProfileSetting(context);
  const [logoPath, coverPath] = await Promise.all([
    assertTrustedSalonProfileMediaPath({
      allowedKinds: ["logo"],
      context,
      path: input.logoImagePath,
    }),
    assertTrustedSalonProfileMediaPath({
      allowedKinds: ["cover"],
      context,
      path: input.coverImagePath,
    }),
  ]);
  const businessName = clean(salon.name) || clean(input.businessName);

  if (!businessName) {
    throw new Error("Salon name is required.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { error } = await supabase
    .from("salon_settings")
    .update({
      address_line1: optionalText(input.addressLine1) ?? setting.address_line1,
      address_line2:
        input.addressLine2 === undefined
          ? setting.address_line2
          : optionalText(input.addressLine2),
      business_description: optionalText(input.description),
      business_name: businessName,
      city: optionalText(input.city) ?? setting.city,
      country: optionalText(input.country) ?? setting.country,
      email: optionalText(input.email),
      phone: optionalText(input.phone),
      postal_code: optionalText(input.postalCode) ?? setting.postal_code,
      public_profile_cover_path: input.removeCoverImage
        ? null
        : (coverPath ?? setting.public_profile_cover_path),
      public_profile_logo_path: input.removeLogoImage
        ? null
        : (logoPath ?? setting.public_profile_logo_path),
      public_profile_story: optionalText(input.story),
      public_profile_tagline: optionalText(input.tagline),
      state: optionalText(input.state) ?? setting.state,
      website: optionalText(input.website),
    })
    .eq("salon_id", salon.id);

  if (error) {
    console.error("Supabase update salon profile identity failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      accountId: Account.id,
      userId: context.user.id,
    });
    await Promise.all([
      removeTrustedSalonProfileMediaPath({ context, path: logoPath }),
      removeTrustedSalonProfileMediaPath({ context, path: coverPath }),
    ]);
    throw new Error(error.message);
  }

  await syncCurrentSalonMapLocationAddressState({
    context,
    setting: {
      ...setting,
      address_line1: optionalText(input.addressLine1) ?? setting.address_line1,
      address_line2:
        input.addressLine2 === undefined
          ? setting.address_line2
          : optionalText(input.addressLine2),
      business_description: optionalText(input.description),
      business_name: businessName,
      city: optionalText(input.city) ?? setting.city,
      country: optionalText(input.country) ?? setting.country,
      email: optionalText(input.email),
      phone: optionalText(input.phone),
      postal_code: optionalText(input.postalCode) ?? setting.postal_code,
      state: optionalText(input.state) ?? setting.state,
      website: optionalText(input.website),
    },
  });

  await Promise.all([
    logoPath
      ? attachSalonProfileMediaAsset({
          context,
          entityId: setting.id,
          entityType: "salon_setting",
          path: logoPath,
        })
      : Promise.resolve(),
    coverPath
      ? attachSalonProfileMediaAsset({
          context,
          entityId: setting.id,
          entityType: "salon_setting",
          path: coverPath,
        })
      : Promise.resolve(),
    logoPath || input.removeLogoImage
      ? removeTrustedSalonProfileMediaPath({
          allowLegacy: true,
          context,
          path: setting.public_profile_logo_path,
        })
      : Promise.resolve(),
    coverPath || input.removeCoverImage
      ? removeTrustedSalonProfileMediaPath({
          allowLegacy: true,
          context,
          path: setting.public_profile_cover_path,
        })
      : Promise.resolve(),
  ]);
}

export async function updateCurrentSalonProfileIdentityMedia(input: {
  kind: "cover" | "logo";
  path: string | null;
  remove?: boolean;
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to update salon profile media.");
  }

  await requirePermission(SALON_PROFILE_PERMISSIONS.manage, context);

  const { salon } = requireCurrentAccountAndSalon(context);
  const setting = await getOrCreateSalonProfileSetting(context);
  const mediaPath = await assertTrustedSalonProfileMediaPath({
    allowedKinds: [input.kind],
    context,
    path: input.path,
  });
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const column =
    input.kind === "logo"
      ? "public_profile_logo_path"
      : "public_profile_cover_path";
  const existingPath =
    input.kind === "logo"
      ? setting.public_profile_logo_path
      : setting.public_profile_cover_path;
  const { error } = await supabase
    .from("salon_settings")
    .update({
      [column]: input.remove ? null : (mediaPath ?? existingPath),
    })
    .eq("salon_id", salon.id);

  if (error) {
    await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
    throw new Error(error.message);
  }

  if (mediaPath || input.remove) {
    await Promise.all([
      mediaPath
        ? attachSalonProfileMediaAsset({
            context,
            entityId: setting.id,
            entityType: "salon_setting",
            path: mediaPath,
          })
        : Promise.resolve(),
      removeTrustedSalonProfileMediaPath({
        allowLegacy: true,
        context,
        path: existingPath,
      }),
    ]);
  }
}

export async function deleteCurrentSalonProfileMedia(path: string) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to manage salon profile media.");
  }

  const canManageIdentity = await hasPermission(
    SALON_PROFILE_PERMISSIONS.manage,
    context,
  );
  const canManageContent = await hasPermission(
    SALON_PROFILE_PERMISSIONS.contentManage,
    context,
  );

  if (!canManageIdentity && !canManageContent) {
    throw new Error("Missing permission to delete salon profile media.");
  }

  await removeTrustedSalonProfileMediaPath({ context, path });
}

export async function setCurrentSalonProfilePublication(enabled: boolean) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to publish salon profile.");
  }

  await requirePermission(SALON_PROFILE_PERMISSIONS.manage, context);

  const { salon } = requireCurrentAccountAndSalon(context);
  const data = await getCurrentSalonProfileManageData(context);

  if (enabled && !data.readiness.canPublish) {
    throw new Error(
      `Complete required items before publishing: ${data.readiness.missingRequiredItems.join(", ")}.`,
    );
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { error } = await supabase
    .from("salon_settings")
    .update({ public_discovery_enabled: enabled })
    .eq("salon_id", salon.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createCurrentSalonProfileLook(input: {
  additionalServiceIds?: string[];
  badge: string | null;
  bookingCtaEnabled?: boolean;
  bookingNote: string | null;
  caption?: string | null;
  durationMinutes: number | null;
  emotionalDescription: string | null;
  imagePath: string | null;
  isPinned: boolean;
  mood: string | null;
  palette: string[];
  publishNow: boolean;
  recommendedStaffId: string | null;
  serviceId: string | null;
  startingPrice: number | null;
  title: string;
  whyLoveIt: string | null;
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to create looks.");
  }

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const postingStaff = await requireSalonProfileContentCreatePermission({
    context,
    supabase,
  });
  const caption = optionalText(input.caption);
  const title =
    clean(input.title) ||
    deriveSocialTitle(caption ?? input.emotionalDescription, "New salon look");

  if (!title) {
    throw new Error("Look name is required.");
  }

  if (input.durationMinutes !== null && input.durationMinutes <= 0) {
    throw new Error("Duration must be greater than 0.");
  }

  if (input.startingPrice !== null && input.startingPrice < 0) {
    throw new Error("Starting price cannot be negative.");
  }

  const mediaPath = await assertTrustedSalonProfileMediaPath({
    allowedKinds: ["look"],
    context,
    path: input.imagePath,
  });

  if (!mediaPath) {
    throw new Error("Look image is required.");
  }

  const author = postingStaff
    ? {
        avatarPath: postingStaff.public_profile_photo_path,
        displayName: postingStaff.display_name,
        staffId: postingStaff.id,
      }
    : await resolveCurrentSalonProfileAuthor({ context, supabase });
  const recommendedStaffId = isSalonStaffContext(context)
    ? author.staffId
    : input.recommendedStaffId ?? author.staffId;
  let serviceDefaults: Pick<Service, "base_price" | "duration_minutes" | "id"> | null =
    null;

  if (input.serviceId) {
    const { data: service, error: serviceError } = await supabase
      .from("services")
      .select("id, base_price, duration_minutes")
      .eq("id", input.serviceId)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .maybeSingle<Pick<Service, "base_price" | "duration_minutes" | "id">>();

    if (serviceError || !service) {
      await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
      throw new Error("Choose an active service from the current salon.");
    }

    serviceDefaults = service;
  }

  if (recommendedStaffId) {
    const { data: staffMember, error: staffError } = await supabase
      .from("staff")
      .select("id")
      .eq("id", recommendedStaffId)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .maybeSingle<{ id: string }>();

    if (staffError || !staffMember) {
      await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
      throw new Error("Choose an active artist from the current salon.");
    }
  }

  if (input.isPinned) {
    await supabase
      .from("salon_profile_looks")
      .update({ is_pinned: false })
      .eq("salon_id", salon.id);
  }

  const { data, error } = await supabase
    .from("salon_profile_looks")
    .insert({
      author_avatar_path: author.avatarPath,
      author_display_name: author.displayName,
      author_staff_id: author.staffId,
      author_user_id: context.user.id,
      badge: optionalText(input.badge),
      booking_note: optionalText(input.bookingNote),
      caption,
      created_by_user_id: context.user.id,
      duration_minutes:
        input.durationMinutes ?? serviceDefaults?.duration_minutes ?? null,
      emotional_description: optionalText(input.emotionalDescription),
      is_pinned: input.isPinned,
      media_path: mediaPath,
      mood: optionalText(input.mood),
      palette: input.palette,
      published_at: input.publishNow ? new Date().toISOString() : null,
      recommended_staff_id: recommendedStaffId,
      salon_id: salon.id,
      service_id: input.serviceId,
      starting_price: input.startingPrice ?? serviceDefaults?.base_price ?? null,
      status: input.publishNow ? "published" : "draft",
      title,
      why_love_it: optionalText(input.whyLoveIt),
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    console.error("Supabase create salon profile look failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      accountId: Account.id,
      userId: context.user.id,
    });
    await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
    throw new Error(error.message);
  }

  try {
    await Promise.all([
      attachSalonProfileMediaAsset({
        context,
        entityId: data.id,
        entityType: "look",
        path: mediaPath,
      }),
      attachHashtagsToPost({
        hashtags: extractHashtags(caption),
        accountId: Account.id,
        postId: data.id,
        postType: "look",
        salonId: salon.id,
        supabase,
      }),
    ]);
    await saveContentBookingConfig({
      additionalServiceIds: input.additionalServiceIds,
      bookingCtaEnabled: input.bookingCtaEnabled,
      bookingNote: input.bookingNote,
      contentId: data.id,
      creditedStaffId: recommendedStaffId,
      primaryServiceId: input.serviceId,
      sourceType: "salon_profile_look",
      supabase,
    });
  } catch (postError) {
    await supabase
      .from("salon_profile_looks")
      .delete()
      .eq("id", data.id)
      .eq("salon_id", salon.id);
    await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
    throw postError;
  }

  return data.id;
}

export async function createCurrentSalonProfileUpdate(input: {
  additionalServiceIds?: string[];
  bookingCtaEnabled?: boolean;
  caption?: string | null;
  ctaLabel: string | null;
  imagePath?: string | null;
  publishNow: boolean;
  serviceId: string | null;
  staffId: string | null;
  startsAt: string | null;
  summary: string | null;
  title: string;
  type: SalonProfileUpdateType;
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to create salon updates.");
  }

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const postingStaff = await requireSalonProfileContentCreatePermission({
    context,
    supabase,
  });
  const caption = optionalText(input.caption);
  let title =
    clean(input.title) ||
    deriveSocialTitle(caption ?? input.summary, "Salon update");
  let summary = optionalText(input.summary);
  let ctaLabel = optionalText(input.ctaLabel);
  const mediaPath = await assertTrustedSalonProfileMediaPath({
    allowedKinds: ["update"],
    context,
    path: input.imagePath ?? null,
  });

  const author = postingStaff
    ? {
        avatarPath: postingStaff.public_profile_photo_path,
        displayName: postingStaff.display_name,
        staffId: postingStaff.id,
      }
    : await resolveCurrentSalonProfileAuthor({ context, supabase });
  const selectedStaffId = isSalonStaffContext(context)
    ? author.staffId
    : input.staffId ?? author.staffId;
  let service: Pick<Service, "id" | "name"> | null = null;
  let staffMember: Pick<Staff, "display_name" | "id"> | null = null;

  if (input.serviceId) {
    const { data, error } = await supabase
      .from("services")
      .select("id, name")
      .eq("id", input.serviceId)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .maybeSingle<Pick<Service, "id" | "name">>();

    if (error || !data) {
      await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
      throw new Error("Choose an active service from the current salon.");
    }

    service = data;
  }

  if (selectedStaffId) {
    const { data, error } = await supabase
      .from("staff")
      .select("id, display_name")
      .eq("id", selectedStaffId)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .maybeSingle<Pick<Staff, "display_name" | "id">>();

    if (error || !data) {
      await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
      throw new Error("Choose an active artist from the current salon.");
    }

    staffMember = data;
  }

  if (input.type === "last_minute_opening") {
    if (!input.startsAt) {
      await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
      throw new Error("Opening time is required.");
    }

    const startsAt = new Date(input.startsAt);

    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
      throw new Error("Opening time must be in the future.");
    }

    if (!service || !staffMember) {
      await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
      throw new Error("Last-minute openings require an active service and artist.");
    }

    const { data: duplicate, error: duplicateError } = await supabase
      .from("salon_profile_updates")
      .select("id")
      .eq("salon_id", salon.id)
      .eq("update_type", "last_minute_opening")
      .eq("staff_id", staffMember.id)
      .eq("starts_at", input.startsAt)
      .neq("status", "archived")
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (duplicateError) {
      await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
      throw new Error(duplicateError.message);
    }

    if (duplicate) {
      await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
      throw new Error("This artist already has an opening at that time.");
    }

    const timeLabel = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(startsAt);
    const today = new Date();
    const dayLabel =
      startsAt.toDateString() === today.toDateString()
        ? "Today"
        : new Intl.DateTimeFormat("en-US", {
            month: "short",
            day: "numeric",
          }).format(startsAt);

    title = `${timeLabel} with ${staffMember.display_name}`;
    summary = `${service.name} - ${dayLabel}`;
    ctaLabel = "Claim this time";
  }

  if (!title) {
    await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
    throw new Error("Update title is required.");
  }

  const { data, error } = await supabase
    .from("salon_profile_updates")
    .insert({
      author_avatar_path: author.avatarPath,
      author_display_name: author.displayName,
      author_staff_id: author.staffId,
      author_user_id: context.user.id,
      caption,
      created_by_user_id: context.user.id,
      cta_label: ctaLabel,
      media_path: mediaPath,
      salon_id: salon.id,
      service_id: input.serviceId,
      staff_id: selectedStaffId,
      starts_at: input.startsAt,
      status: input.publishNow ? "published" : "draft",
      summary,
      title,
      update_type: input.type,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    console.error("Supabase create salon profile update failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: salon.id,
      accountId: Account.id,
      userId: context.user.id,
    });
    await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
    throw new Error(error.message);
  }

  try {
    await Promise.all([
      attachSalonProfileMediaAsset({
        context,
        entityId: data.id,
        entityType: "update",
        path: mediaPath,
      }),
      attachHashtagsToPost({
        hashtags: extractHashtags(caption),
        accountId: Account.id,
        postId: data.id,
        postType: "update",
        salonId: salon.id,
        supabase,
      }),
    ]);
    await saveContentBookingConfig({
      additionalServiceIds: input.additionalServiceIds,
      bookingCtaEnabled: input.bookingCtaEnabled,
      bookingNote: null,
      contentId: data.id,
      creditedStaffId: selectedStaffId,
      primaryServiceId: input.serviceId,
      sourceType: "salon_profile_update",
      supabase,
    });
  } catch (postError) {
    await supabase
      .from("salon_profile_updates")
      .delete()
      .eq("id", data.id)
      .eq("salon_id", salon.id);
    await removeTrustedSalonProfileMediaPath({ context, path: mediaPath });
    throw postError;
  }

  return data.id;
}

export async function setCurrentSalonProfileLookStatus(input: {
  isPinned?: boolean;
  lookId: string;
  status?: SalonProfileLookStatus;
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to manage looks.");
  }

  await requirePermission(SALON_PROFILE_PERMISSIONS.contentManage, context);

  const { salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  if (input.isPinned) {
    const { error: clearError } = await supabase
      .from("salon_profile_looks")
      .update({ is_pinned: false })
      .eq("salon_id", salon.id);

    if (clearError) {
      throw new Error(clearError.message);
    }
  }

  const patch: Record<string, unknown> = {};

  if (input.status) {
    patch.status = input.status;
    patch.published_at =
      input.status === "published" ? new Date().toISOString() : null;
  }

  if (typeof input.isPinned === "boolean") {
    patch.is_pinned = input.isPinned;
  }

  if (Object.keys(patch).length === 0) {
    return;
  }

  const { error } = await supabase
    .from("salon_profile_looks")
    .update(patch)
    .eq("id", input.lookId)
    .eq("salon_id", salon.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteCurrentSalonProfileLook(lookId: string) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to delete looks.");
  }

  await requirePermission(SALON_PROFILE_PERMISSIONS.contentManage, context);

  const { salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: look, error: loadError } = await supabase
    .from("salon_profile_looks")
    .select("media_path")
    .eq("id", lookId)
    .eq("salon_id", salon.id)
    .maybeSingle<{ media_path: string | null }>();

  if (loadError) {
    throw new Error(loadError.message);
  }

  const { error } = await supabase
    .from("salon_profile_looks")
    .delete()
    .eq("id", lookId)
    .eq("salon_id", salon.id);

  if (error) {
    throw new Error(error.message);
  }

  await removeTrustedSalonProfileMediaPath({
    allowLegacy: true,
    context,
    path: look?.media_path,
  });
}

export async function createCurrentSalonProfileSocialPost(input: {
  additionalServiceIds?: string[];
  bookingCtaEnabled?: boolean;
  caption: string | null;
  contentType?: "auto" | "look" | "opening" | "update";
  durationMinutes?: number | null;
  imagePath: string | null;
  mood?: string | null;
  serviceId?: string | null;
  staffId?: string | null;
  startsAt?: string | null;
  startingPrice?: number | null;
  title?: string | null;
}) {
  const caption = optionalText(input.caption);
  const hasImage = Boolean(optionalText(input.imagePath));
  const contentType =
    input.contentType && input.contentType !== "auto"
      ? input.contentType
      : hasImage
        ? "look"
        : "update";

  if (!caption && !hasImage && contentType !== "opening") {
    throw new Error("Write a caption or choose an image before posting.");
  }

  if (contentType === "look") {
    await createCurrentSalonProfileLook({
      badge: null,
      bookingCtaEnabled: input.bookingCtaEnabled,
      bookingNote: null,
      caption,
      additionalServiceIds: input.additionalServiceIds,
      durationMinutes: input.durationMinutes ?? null,
      emotionalDescription: caption,
      imagePath: input.imagePath,
      isPinned: false,
      mood: input.mood ?? null,
      palette: [],
      publishNow: true,
      recommendedStaffId: input.staffId ?? null,
      serviceId: input.serviceId ?? null,
      startingPrice: input.startingPrice ?? null,
      title: input.title ?? "",
      whyLoveIt: null,
    });
    return;
  }

  await createCurrentSalonProfileUpdate({
    additionalServiceIds: input.additionalServiceIds,
    bookingCtaEnabled: input.bookingCtaEnabled,
    caption,
    ctaLabel: contentType === "opening" ? "Claim this time" : null,
    imagePath: input.imagePath,
    publishNow: true,
    serviceId: input.serviceId ?? null,
    staffId: input.staffId ?? null,
    startsAt: input.startsAt ?? null,
    summary: caption,
    title: input.title ?? "",
    type: contentType === "opening" ? "last_minute_opening" : "announcement",
  });
}

export async function createPublicSalonProfileComment(input: {
  asSalonReply?: boolean;
  body: string;
  lookId?: string | null;
  parentCommentId?: string | null;
  salonId: string;
  updateId?: string | null;
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("Sign in to comment.");
  }

  const body = clean(input.body);

  if (!body) {
    throw new Error("Write a comment before posting.");
  }

  if (body.length > 1000) {
    throw new Error("Keep comments under 1000 characters.");
  }

  const lookId = optionalText(input.lookId);
  const updateId = optionalText(input.updateId);

  if (Number(Boolean(lookId)) + Number(Boolean(updateId)) !== 1) {
    throw new Error("Choose one profile post to comment on.");
  }

  const publicData = await getPublicSalonProfileData(input.salonId);

  if (!publicData) {
    throw new Error("That salon profile is not available.");
  }

  const targetExists = lookId
    ? publicData.looks.some((look) => look.id === lookId)
    : publicData.updates.some((update) => update.id === updateId);

  if (!targetExists) {
    throw new Error("That post is not available for public comments.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { error } = await supabase.from("salon_profile_comments").insert({
    author_user_id: context.user.id,
    body,
    is_salon_reply: input.asSalonReply === true,
    look_id: lookId,
    parent_comment_id: optionalText(input.parentCommentId),
    salon_id: publicData.profile.salonId,
    status: "visible",
    update_id: updateId,
  });

  if (error) {
    console.error("Supabase create salon profile comment failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: publicData.profile.salonId,
      userId: context.user.id,
    });
    throw new Error(
      input.asSalonReply
        ? "You do not have permission to reply as this salon."
        : error.message,
    );
  }
}

export async function setPublicSalonProfileCommentStatus(input: {
  commentId: string;
  status: "deleted" | "hidden" | "visible";
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("Sign in to update comments.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { error } = await supabase
    .from("salon_profile_comments")
    .update({ status: input.status })
    .eq("id", input.commentId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createPublicSalonProfileReview(input: {
  body: string;
  rating: number;
  salonId: string;
  title?: string | null;
  verifiedBookingId?: string | null;
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("Sign in to write a review.");
  }

  const publicData = await getPublicSalonProfileData(input.salonId);

  if (!publicData) {
    throw new Error("That salon profile is not available for reviews.");
  }

  const rating = Math.round(input.rating);
  const body = clean(input.body);

  if (rating < 1 || rating > 5) {
    throw new Error("Choose a rating from 1 to 5.");
  }

  if (!body) {
    throw new Error("Write your review before posting.");
  }

  if (body.length > 2000) {
    throw new Error("Keep reviews under 2000 characters.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { error } = await supabase.from("salon_profile_reviews").insert({
    author_user_id: context.user.id,
    body,
    moderation_status: "visible",
    rating,
    salon_id: publicData.profile.salonId,
    title: optionalText(input.title),
    verified_booking_id: optionalText(input.verifiedBookingId),
  });

  if (error) {
    console.error("Supabase create salon profile review failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: publicData.profile.salonId,
      userId: context.user.id,
    });

    if (error.message.includes("duplicate")) {
      throw new Error("You already have a visible review for this salon.");
    }

    throw new Error(error.message);
  }
}

export async function createPublicSalonProfileReviewReply(input: {
  body: string;
  reviewId: string;
  salonId: string;
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("Sign in to reply to reviews.");
  }

  await requirePermission(SALON_PROFILE_PERMISSIONS.contentManage, context);

  const publicData = await getPublicSalonProfileData(input.salonId);

  if (!publicData) {
    throw new Error("That salon profile is not available.");
  }

  if (!publicData.reviews.some((review) => review.id === input.reviewId)) {
    throw new Error("That review is not available.");
  }

  const body = clean(input.body);

  if (!body) {
    throw new Error("Write a reply before posting.");
  }

  if (body.length > 1000) {
    throw new Error("Keep replies under 1000 characters.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { error } = await supabase.from("salon_profile_review_replies").insert({
    author_user_id: context.user.id,
    body,
    moderation_status: "visible",
    review_id: input.reviewId,
    salon_id: publicData.profile.salonId,
  });

  if (error) {
    console.error("Supabase create salon profile review reply failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      reviewId: input.reviewId,
      salonId: publicData.profile.salonId,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }
}

export async function createPublicSalonProfileBookingRequest(input: {
  lookId?: string | null;
  note?: string | null;
  requestedStartAt?: string | null;
  salonId: string;
  serviceId?: string | null;
  staffId?: string | null;
}) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("Sign in to request an appointment.");
  }

  const publicData = await getPublicSalonProfileData(input.salonId);

  if (!publicData) {
    throw new Error("That salon profile is not available for booking requests.");
  }

  const lookId = optionalText(input.lookId);
  const serviceId = optionalText(input.serviceId);
  const staffId = optionalText(input.staffId);
  const requestedStartAt = optionalText(input.requestedStartAt);

  if (lookId && !publicData.looks.some((look) => look.id === lookId)) {
    throw new Error("Choose a published look from this salon.");
  }

  if (serviceId && !publicData.services.some((service) => service.id === serviceId)) {
    throw new Error("Choose an active service from this salon.");
  }

  if (staffId && !publicData.staff.some((member) => member.id === staffId)) {
    throw new Error("Choose an active artist from this salon.");
  }

  if (requestedStartAt) {
    const parsed = new Date(requestedStartAt);

    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw new Error("Choose a future appointment time.");
    }
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("salon_profile_booking_requests")
    .insert({
      customer_user_id: context.user.id,
      look_id: lookId,
      private_note: optionalText(input.note),
      requested_start_at: requestedStartAt,
      salon_id: publicData.profile.salonId,
      service_id: serviceId,
      staff_id: staffId,
      status: "requested",
    })
    .select(
      "id, salon_id, look_id, service_id, staff_id, requested_start_at, private_note, status, created_at",
    )
    .single<{
      created_at: string;
      id: string;
      look_id: string | null;
      private_note: string | null;
      requested_start_at: string | null;
      salon_id: string;
      service_id: string | null;
      staff_id: string | null;
      status: "approved" | "cancelled" | "declined" | "requested";
    }>();

  if (error) {
    console.error("Supabase create salon booking request failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      salonId: publicData.profile.salonId,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  return {
    createdAt: data.created_at,
    id: data.id,
    lookId: data.look_id,
    privateNote: data.private_note,
    requestedStartAt: data.requested_start_at,
    salonId: data.salon_id,
    serviceId: data.service_id,
    staffId: data.staff_id,
    status: data.status,
  };
}

export async function togglePublicSalonLookSave(lookId: string) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("Sign in to save looks.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: existing, error: loadError } = await supabase
    .from("salon_profile_look_saves")
    .select("id")
    .eq("look_id", lookId)
    .eq("user_id", context.user.id)
    .maybeSingle<{ id: string }>();

  if (loadError) {
    throw new Error(loadError.message);
  }

  if (existing) {
    const { error } = await supabase
      .from("salon_profile_look_saves")
      .delete()
      .eq("id", existing.id)
      .eq("user_id", context.user.id);

    if (error) {
      throw new Error(error.message);
    }

    return false;
  }

  const { error } = await supabase.from("salon_profile_look_saves").insert({
    look_id: lookId,
    user_id: context.user.id,
  });

  if (error) {
    throw new Error(error.message);
  }

  return true;
}

export async function togglePublicSalonFollow(salonId: string) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("Sign in to follow salons.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data: existing, error: loadError } = await supabase
    .from("salon_profile_follows")
    .select("id")
    .eq("salon_id", salonId)
    .eq("user_id", context.user.id)
    .maybeSingle<{ id: string }>();

  if (loadError) {
    throw new Error(loadError.message);
  }

  if (existing) {
    const { error } = await supabase
      .from("salon_profile_follows")
      .delete()
      .eq("id", existing.id)
      .eq("user_id", context.user.id);

    if (error) {
      throw new Error(error.message);
    }

    return false;
  }

  const { error } = await supabase.from("salon_profile_follows").insert({
    salon_id: salonId,
    user_id: context.user.id,
  });

  if (error) {
    throw new Error(error.message);
  }

  return true;
}
