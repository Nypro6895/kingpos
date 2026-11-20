import "server-only";
import { loadSalonPostAttribution } from "@/lib/salon-post-attribution";
import { buildSalonProfileFeed, getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { isPublicSalonProfileTeamEligible } from "@/lib/salon-profile-team";
import type { PublicSalonProfileData, PublicSalonProfileLook, PublicSalonProfileUpdate, SalonProfileLook, SalonProfileSetting, SalonProfileUpdate } from "@/types/salon-profile";
import type { Service } from "@/types/service";
import type { StaffPresentation } from "@/lib/staff-profile";
import type { Staff } from "@/types/staff";
export function buildPreviewData(input: {
  contentPage?: PublicSalonProfileData["contentPage"];
  attribution?: Awaited<ReturnType<typeof loadSalonPostAttribution>>;
  accountId: string;
  looks: SalonProfileLook[];
  operatingStatus: PublicSalonProfileData["profile"]["operatingStatus"];
  services: Service[];
  setting: SalonProfileSetting;
  staff: Staff[];
  staffPresentations?: Map<string, StaffPresentation>;
  updates: SalonProfileUpdate[];
}): PublicSalonProfileData {
  const activeServices = input.services.filter((service) => service.is_active);
  const activeStaff = input.staff.filter((member) => member.is_active);
  const publicTeamStaff = activeStaff.filter((member) =>
    isPublicSalonProfileTeamEligible({
      isActive: member.is_active,
      onlineBookingEnabled: member.online_booking_enabled,
      salonProfileContentPostingEnabled:
        member.salon_profile_content_posting_enabled,
    }),
  );
  const serviceById = new Map(activeServices.map((service) => [service.id, service]));
  const staffById = new Map(activeStaff.map((member) => [member.id, member]));
  const staffPresentations = input.staffPresentations ?? new Map();
  const publishedLooks: PublicSalonProfileLook[] = input.looks
    .filter((look) => look.status === "published")
    .map((look) => {
      const service = look.service_id ? serviceById.get(look.service_id) : null;
      const recommendedStaff = look.recommended_staff_id
        ? staffById.get(look.recommended_staff_id)
        : null;

      return {
        authorAvatarUrl:
          getSalonProfileMediaUrl(look.author_avatar_path) ??
          staffPresentations.get(look.author_staff_id ?? "")?.avatarUrl ??
          (recommendedStaff
            ? staffPresentations.get(recommendedStaff.id)?.avatarUrl
            : null) ??
          getSalonProfileMediaUrl(recommendedStaff?.public_profile_photo_path),
        authorDisplayName:
          look.author_display_name ??
          staffPresentations.get(look.author_staff_id ?? "")?.displayName ??
          staffById.get(look.author_staff_id ?? "")?.display_name ??
          input.setting.business_name,
        authorRole: input.attribution?.get(look.id)?.role ?? "salon",
        authorStaffId: look.author_staff_id,
        badge: look.badge,
        bookingNote: look.booking_note,
        caption: look.caption ?? look.emotional_description,
        commentCount: 0,
        durationMinutes: look.duration_minutes,
        emotionalDescription: look.emotional_description,
        id: look.id,
        imageUrl: getSalonProfileMediaUrl(look.media_path),
        isPinned: look.is_pinned,
        isSaved: false,
        mood: look.mood,
        palette: look.palette,
        publishedAt: look.published_at,
        recommendedStaffId: recommendedStaff?.id ?? null,
        recommendedStaffName: recommendedStaff
          ? staffPresentations.get(recommendedStaff.id)?.displayName ??
            recommendedStaff.display_name
          : null,
        saveCount: 0,
        serviceId: service?.id ?? null,
        serviceName: service?.name ?? null,
        startingPrice: look.starting_price,
        hashtags: [],
        title: look.title,
        whyLoveIt: look.why_love_it,
      };
    });
  const publishedUpdates: PublicSalonProfileUpdate[] = input.updates
    .filter((update) => update.status === "published")
    .slice(0, 24)
    .map((update) => {
      const service = update.service_id ? serviceById.get(update.service_id) : null;
      const member = update.staff_id ? staffById.get(update.staff_id) : null;

      return {
        authorAvatarUrl:
          getSalonProfileMediaUrl(update.author_avatar_path) ??
          staffPresentations.get(update.author_staff_id ?? "")?.avatarUrl ??
          getSalonProfileMediaUrl(
            staffById.get(update.author_staff_id ?? "")?.public_profile_photo_path,
          ),
        authorDisplayName:
          update.author_display_name ??
          staffPresentations.get(update.author_staff_id ?? "")?.displayName ??
          staffById.get(update.author_staff_id ?? "")?.display_name ??
          input.setting.business_name,
        authorRole: input.attribution?.get(update.id)?.role ?? "salon",
        authorStaffId: update.author_staff_id,
        ctaLabel: update.cta_label,
        caption: update.caption ?? update.summary,
        commentCount: 0,
        endsAt: update.ends_at,
        id: update.id,
        imageUrl: getSalonProfileMediaUrl(update.media_path),
        publishedAt: update.published_at,
        serviceId: service?.id ?? null,
        serviceName: service?.name ?? null,
        staffId: member?.id ?? null,
        staffName: member
          ? staffPresentations.get(member.id)?.displayName ?? member.display_name
          : null,
        hashtags: [],
        startsAt: update.starts_at,
        summary: update.summary,
        title: update.title,
        type: update.update_type,
      };
    });

  const profile = {
    activeServiceCount: activeServices.length,
    addressLine1: input.setting.address_line1,
    addressLine2: input.setting.address_line2,
    city: input.setting.city,
    country: input.setting.country,
    coverImageUrl: getSalonProfileMediaUrl(
      input.setting.public_profile_cover_path,
    ),
    description: input.setting.business_description,
    email: input.setting.email,
    followerCount: 0,
    isFollowing: false,
    logoImageUrl: getSalonProfileMediaUrl(input.setting.public_profile_logo_path),
    name: input.setting.business_name,
    operatingStatus: input.operatingStatus,
    accountId: input.accountId,
    phone: input.setting.phone,
    postalCode: input.setting.postal_code,
    publishedAt: input.setting.public_discovery_published_at,
    salonId: input.setting.salon_id,
    serviceCategories: Array.from(
      new Set(
        activeServices
          .map((service) => service.category)
          .filter((category): category is string => Boolean(category)),
      ),
    ),
    serviceNames: activeServices.map((service) => service.name),
    state: input.setting.state,
    story: input.setting.public_profile_story,
    tagline: input.setting.public_profile_tagline,
    website: input.setting.website,
  };
  const services = activeServices.map((service) => ({
    basePrice: service.base_price,
    category: service.category,
    description: service.description,
    durationMinutes: service.duration_minutes,
    id: service.id,
    name: service.name,
  }));
  const staff = publicTeamStaff.map((member) => ({
    avatarUrl:
      staffPresentations.get(member.id)?.avatarUrl ??
      getSalonProfileMediaUrl(member.public_profile_photo_path),
    bio: member.public_bio,
    displayName:
      staffPresentations.get(member.id)?.displayName ?? member.display_name,
    id: member.id,
    jobTitle: member.job_title,
    onlineBookingEnabled: member.online_booking_enabled,
    portfolioCount: publishedLooks.filter(
      (look) => look.authorStaffId === member.id,
    ).length,
    specialties: member.specialties,
  }));

  return {
    contentPage: input.contentPage,
    beautyPosts: [],
    comments: [],
    feed: buildSalonProfileFeed({
      looks: publishedLooks,
      profileName: profile.name,
      salonId: profile.salonId,
      updates: publishedUpdates,
    }),
    experiences: [],
    looks: publishedLooks,
    profile,
    reputationSummary: {
      averageRating: null,
      experienceCount: 0,
      issueCount: 0,
      legacyReviewCount: 0,
      noIssueCount: 0,
      noIssueRate: null,
      ratingCounts: {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      },
      uniqueCustomerCount: 0,
      verifiedVisitCount: 0,
    },
    reviewSummary: {
      averageRating: null,
      ratingCounts: {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
      },
      reviewCount: 0,
      verifiedCount: 0,
    },
    reviews: [],
    services,
    staff,
    updates: publishedUpdates,
  };
}

