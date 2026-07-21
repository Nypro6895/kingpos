"use server";

import {
  canCreateSalonProfileContent,
  createCurrentSalonProfileLook,
  createCurrentSalonProfileSocialPost,
  createCurrentSalonProfileUpdate,
  createPublicSalonProfileBookingRequest,
  createPublicSalonProfileComment,
  createPublicSalonProfileReview,
  createPublicSalonProfileReviewReply,
  deleteCurrentSalonProfileMedia,
  deleteCurrentSalonProfileLook,
  getSalonProfileHref,
  setPublicSalonProfileCommentStatus,
  setCurrentSalonProfilePublication,
  setCurrentSalonProfileLookStatus,
  togglePublicSalonFollow,
  togglePublicSalonLookSave,
  updateCurrentSalonProfileIdentity,
  updateCurrentSalonProfileIdentityMedia,
  SALON_PROFILE_PERMISSIONS,
} from "@/lib/salon-profile";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
  isSalonStaffContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import {
  SALON_PROFILE_MEDIA_BUCKET,
  buildSalonProfileMediaPath,
  type SalonProfileMediaKind,
} from "@/lib/salon-profile-media";
import {
  createAuthenticatedSupabaseServerClient,
  getAccessTokenFromRequest,
  getSupabaseConfig,
} from "@/lib/supabase/server";
import {
  SALON_PROFILE_BADGE_OPTIONS,
  SALON_PROFILE_MOOD_OPTIONS,
  SALON_PROFILE_UPDATE_TYPES,
  type SalonProfileLookStatus,
  type SalonProfileUpdateType,
} from "@/types/salon-profile";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type ToggleResult = {
  error: string | null;
  active: boolean;
};

type MutationResult<T extends object = object> =
  | ({ error: null } & T)
  | { error: string };

type MediaUploadIntent = "content" | "identity";

export type SalonProfileUploadSession = {
  accessToken: string;
  anonKey: string;
  bucket: string;
  path: string;
  salonId: string;
  supabaseUrl: string;
};

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(formData: FormData, key: string) {
  const value = readString(formData, key);
  return value || null;
}

function readOptionalNumber(formData: FormData, key: string) {
  const value = readString(formData, key);

  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalInteger(formData: FormData, key: string) {
  const value = readOptionalNumber(formData, key);
  return value === null ? null : Math.round(value);
}

function readOptionalDateTime(formData: FormData, key: string) {
  const value = readString(formData, key);

  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readPalette(formData: FormData) {
  return ["palette_1", "palette_2", "palette_3", "palette_4"]
    .map((key) => readString(formData, key))
    .filter((value) => /^#[0-9a-f]{6}$/i.test(value));
}

function readMood(formData: FormData) {
  const mood = readOptionalString(formData, "mood");

  if (!mood || mood === "Surprise me") {
    return null;
  }

  return SALON_PROFILE_MOOD_OPTIONS.includes(
    mood as (typeof SALON_PROFILE_MOOD_OPTIONS)[number],
  )
    ? mood
    : null;
}

function readBadge(formData: FormData) {
  const badge = readOptionalString(formData, "badge");

  if (!badge) {
    return null;
  }

  return SALON_PROFILE_BADGE_OPTIONS.includes(
    badge as (typeof SALON_PROFILE_BADGE_OPTIONS)[number],
  )
    ? badge
    : null;
}

function readUpdateType(formData: FormData): SalonProfileUpdateType {
  const type = readString(formData, "update_type");

  if (
    SALON_PROFILE_UPDATE_TYPES.includes(
      type as (typeof SALON_PROFILE_UPDATE_TYPES)[number],
    )
  ) {
    return type as SalonProfileUpdateType;
  }

  return "announcement";
}

function redirectWithError(message: string): never {
  redirect(`/salon-profile?error=${encodeURIComponent(message)}`);
}

function redirectWithNotice(message: string): never {
  redirect(`/salon-profile?notice=${encodeURIComponent(message)}`);
}

function revalidateSalonProfile(salonId?: string | null) {
  revalidatePath("/salon-profile");
  revalidatePath("/explore");

  if (salonId) {
    revalidatePath(getSalonProfileHref(salonId));
  }
}

export async function getSalonProfileMediaUploadSessionAction(
  intent: MediaUploadIntent,
  kind: Extract<SalonProfileMediaKind, "cover" | "logo" | "look" | "update">,
): Promise<SalonProfileUploadSession> {
  const [context, accessToken] = await Promise.all([
    getCurrentBusinessContext(),
    getAccessTokenFromRequest(),
  ]);
  const config = getSupabaseConfig();

  if (!config || !accessToken || !context.user) {
    throw new Error("Sign in before uploading salon media.");
  }

  const isSalonWorkspace =
    (isSalonManageContext(context) || isSalonStaffContext(context)) &&
    context.currentOrganization &&
    context.currentSalon;
  const organization = context.currentOrganization;
  const salon = context.currentSalon;

  if (!isSalonWorkspace || !organization || !salon) {
    throw new Error("Choose a salon workspace before uploading media.");
  }

  const canUpload =
    intent === "identity"
      ? isSalonManageContext(context) &&
        (await hasPermission(SALON_PROFILE_PERMISSIONS.manage, context))
      : await canCreateSalonProfileContent(context);

  if (!canUpload) {
    throw new Error("You do not have permission to upload this media.");
  }

  if (
    (intent === "identity" && kind !== "cover" && kind !== "logo") ||
    (intent === "content" && kind !== "look" && kind !== "update")
  ) {
    throw new Error("Upload kind does not match this Salon Profile intent.");
  }

  const path = buildSalonProfileMediaPath({
    kind,
    salonId: salon.id,
  });
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { error } = await supabase.from("salon_profile_media_assets").insert({
    bucket: SALON_PROFILE_MEDIA_BUCKET,
    object_path: path,
    organization_id: organization.id,
    purpose: kind,
    salon_id: salon.id,
    status: "pending",
    upload_intent: intent,
    uploaded_by_user_id: context.user.id,
  });

  if (error) {
    console.error("Supabase reserve salon profile media failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: salon.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  return {
    accessToken,
    anonKey: config.supabaseAnonKey,
    bucket: SALON_PROFILE_MEDIA_BUCKET,
    path,
    salonId: salon.id,
    supabaseUrl: config.supabaseUrl,
  };
}

export async function deleteSalonProfileMediaAction(path: string) {
  await deleteCurrentSalonProfileMedia(path);
}

export async function updateSalonProfileIdentityMediaAction(input: {
  kind: "cover" | "logo";
  path: string | null;
  remove?: boolean;
  salonId: string;
}): Promise<MutationResult> {
  try {
    await updateCurrentSalonProfileIdentityMedia(input);
    revalidateSalonProfile(input.salonId);
    return { error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Profile image could not be updated.",
    };
  }
}

export async function updateSalonProfileIdentityAction(formData: FormData) {
  const salonId = readOptionalString(formData, "salon_id");

  try {
    await updateCurrentSalonProfileIdentity({
      addressLine1: readOptionalString(formData, "address_line1"),
      addressLine2: readOptionalString(formData, "address_line2"),
      businessName: readString(formData, "business_name"),
      city: readOptionalString(formData, "city"),
      coverImagePath: readOptionalString(formData, "cover_image_path"),
      country: readOptionalString(formData, "country"),
      description: readOptionalString(formData, "business_description"),
      email: readOptionalString(formData, "email"),
      logoImagePath: readOptionalString(formData, "logo_image_path"),
      phone: readOptionalString(formData, "phone"),
      postalCode: readOptionalString(formData, "postal_code"),
      removeCoverImage: readString(formData, "remove_cover_image") === "true",
      removeLogoImage: readString(formData, "remove_logo_image") === "true",
      state: readOptionalString(formData, "state"),
      story: readOptionalString(formData, "public_profile_story"),
      tagline: readOptionalString(formData, "public_profile_tagline"),
      website: readOptionalString(formData, "website"),
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Salon profile could not be saved.",
    );
  }

  revalidateSalonProfile(salonId);
  redirectWithNotice("Salon profile saved.");
}

export async function createSalonProfileLookAction(formData: FormData) {
  const salonId = readOptionalString(formData, "salon_id");

  try {
    await createCurrentSalonProfileLook({
      badge: readBadge(formData),
      bookingNote: readOptionalString(formData, "booking_note"),
      durationMinutes: readOptionalInteger(formData, "duration_minutes"),
      emotionalDescription: readOptionalString(
        formData,
        "emotional_description",
      ),
      imagePath: readOptionalString(formData, "look_image_path"),
      isPinned: formData.get("is_pinned") === "on",
      mood: readMood(formData),
      palette: readPalette(formData),
      publishNow: formData.get("publish_now") === "on",
      recommendedStaffId: readOptionalString(formData, "recommended_staff_id"),
      serviceId: readOptionalString(formData, "service_id"),
      startingPrice: readOptionalNumber(formData, "starting_price"),
      title: readString(formData, "title"),
      whyLoveIt: readOptionalString(formData, "why_love_it"),
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Look could not be created.",
    );
  }

  revalidateSalonProfile(salonId);
  redirectWithNotice("Look created.");
}

export async function createSalonProfileUpdateAction(formData: FormData) {
  const salonId = readOptionalString(formData, "salon_id");

  try {
    await createCurrentSalonProfileUpdate({
      ctaLabel: readOptionalString(formData, "cta_label"),
      publishNow: formData.get("publish_now") === "on",
      serviceId: readOptionalString(formData, "service_id"),
      staffId: readOptionalString(formData, "staff_id"),
      startsAt: readOptionalDateTime(formData, "starts_at"),
      summary: readOptionalString(formData, "summary"),
      title: readString(formData, "title"),
      type: readUpdateType(formData),
    });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Update could not be created.",
    );
  }

  revalidateSalonProfile(salonId);
  redirectWithNotice("Update created.");
}

export async function createSalonProfileSocialPostAction(input: {
  additionalServiceIds?: string[];
  bookingCtaEnabled?: boolean;
  caption: string | null;
  contentType?: "auto" | "look" | "opening" | "update";
  durationMinutes?: number | null;
  imagePath: string | null;
  mood?: string | null;
  salonId: string;
  serviceId?: string | null;
  staffId?: string | null;
  startsAt?: string | null;
  startingPrice?: number | null;
  title?: string | null;
}): Promise<MutationResult> {
  try {
    await createCurrentSalonProfileSocialPost(input);
    revalidateSalonProfile(input.salonId);
    return { error: null };
  } catch (error) {
    if (input.imagePath) {
      try {
        await deleteCurrentSalonProfileMedia(input.imagePath);
      } catch {
        // Cleanup is best-effort; the server validates ownership again.
      }
    }

    return {
      error:
        error instanceof Error ? error.message : "Post could not be created.",
    };
  }
}

export async function setSalonProfilePublicationAction(formData: FormData) {
  const salonId = readOptionalString(formData, "salon_id");
  const enabled = readString(formData, "public_discovery_enabled") === "true";

  try {
    await setCurrentSalonProfilePublication(enabled);
  } catch (error) {
    redirectWithError(
      error instanceof Error
        ? error.message
        : "Publication setting could not be saved.",
    );
  }

  revalidateSalonProfile(salonId);
  redirectWithNotice(enabled ? "Salon profile published." : "Salon profile unpublished.");
}

export async function setSalonProfileLookStatusAction(formData: FormData) {
  const salonId = readOptionalString(formData, "salon_id");
  const lookId = readString(formData, "look_id");
  const status = readString(formData, "status") as SalonProfileLookStatus;

  if (!lookId) {
    redirectWithError("Look is required.");
  }

  if (!["archived", "draft", "published"].includes(status)) {
    redirectWithError("Choose a valid look status.");
  }

  try {
    await setCurrentSalonProfileLookStatus({ lookId, status });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Look status could not be saved.",
    );
  }

  revalidateSalonProfile(salonId);
  redirectWithNotice("Look status saved.");
}

export async function pinSalonProfileLookAction(formData: FormData) {
  const salonId = readOptionalString(formData, "salon_id");
  const lookId = readString(formData, "look_id");
  const isPinned = formData.get("is_pinned") === "true";

  if (!lookId) {
    redirectWithError("Look is required.");
  }

  try {
    await setCurrentSalonProfileLookStatus({ isPinned, lookId });
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Look pin could not be saved.",
    );
  }

  revalidateSalonProfile(salonId);
  redirectWithNotice(isPinned ? "Look pinned." : "Look unpinned.");
}

export async function deleteSalonProfileLookAction(formData: FormData) {
  const salonId = readOptionalString(formData, "salon_id");
  const lookId = readString(formData, "look_id");

  if (!lookId) {
    redirectWithError("Look is required.");
  }

  try {
    await deleteCurrentSalonProfileLook(lookId);
  } catch (error) {
    redirectWithError(
      error instanceof Error ? error.message : "Look could not be deleted.",
    );
  }

  revalidateSalonProfile(salonId);
  redirectWithNotice("Look deleted.");
}

export async function setSalonProfileLookStatusDirectAction(input: {
  isPinned?: boolean;
  lookId: string;
  salonId: string;
  status?: SalonProfileLookStatus;
}): Promise<MutationResult> {
  try {
    await setCurrentSalonProfileLookStatus(input);
    revalidateSalonProfile(input.salonId);
    return { error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Look status could not be saved.",
    };
  }
}

export async function deleteSalonProfileLookDirectAction(input: {
  lookId: string;
  salonId: string;
}): Promise<MutationResult> {
  try {
    await deleteCurrentSalonProfileLook(input.lookId);
    revalidateSalonProfile(input.salonId);
    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Look could not be deleted.",
    };
  }
}

export async function toggleSalonLookSaveAction(
  lookId: string,
  salonId: string,
): Promise<ToggleResult> {
  try {
    const active = await togglePublicSalonLookSave(lookId);
    revalidateSalonProfile(salonId);
    return { active, error: null };
  } catch (error) {
    return {
      active: false,
      error:
        error instanceof Error ? error.message : "Look could not be saved.",
    };
  }
}

export async function toggleSalonFollowAction(
  salonId: string,
): Promise<ToggleResult> {
  try {
    const active = await togglePublicSalonFollow(salonId);
    revalidateSalonProfile(salonId);
    return { active, error: null };
  } catch (error) {
    return {
      active: false,
      error:
        error instanceof Error ? error.message : "Salon follow could not be saved.",
    };
  }
}

export async function createSalonProfileCommentAction(input: {
  asSalonReply?: boolean;
  body: string;
  lookId?: string | null;
  parentCommentId?: string | null;
  salonId: string;
  updateId?: string | null;
}): Promise<MutationResult> {
  try {
    await createPublicSalonProfileComment(input);
    revalidateSalonProfile(input.salonId);
    return { error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Comment could not be posted.",
    };
  }
}

export async function createSalonProfileReviewAction(input: {
  body: string;
  rating: number;
  salonId: string;
  title?: string | null;
  verifiedBookingId?: string | null;
}): Promise<MutationResult> {
  try {
    await createPublicSalonProfileReview(input);
    revalidateSalonProfile(input.salonId);
    return { error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Review could not be posted.",
    };
  }
}

export async function createSalonProfileReviewReplyAction(input: {
  body: string;
  reviewId: string;
  salonId: string;
}): Promise<MutationResult> {
  try {
    await createPublicSalonProfileReviewReply(input);
    revalidateSalonProfile(input.salonId);
    return { error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Review reply could not be posted.",
    };
  }
}

export async function setSalonProfileCommentStatusAction(input: {
  commentId: string;
  salonId: string;
  status: "deleted" | "hidden" | "visible";
}): Promise<MutationResult> {
  try {
    await setPublicSalonProfileCommentStatus(input);
    revalidateSalonProfile(input.salonId);
    return { error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Comment could not be updated.",
    };
  }
}

export async function createSalonProfileBookingRequestAction(input: {
  lookId?: string | null;
  note?: string | null;
  requestedStartAt?: string | null;
  salonId: string;
  serviceId?: string | null;
  staffId?: string | null;
}): Promise<
  MutationResult<{
    bookingRequestId: string;
  }>
> {
  try {
    const request = await createPublicSalonProfileBookingRequest(input);
    revalidateSalonProfile(input.salonId);
    return { bookingRequestId: request.id, error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Booking request could not be submitted.",
    };
  }
}
