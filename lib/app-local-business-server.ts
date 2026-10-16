import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getRequestBusinessContext } from "./request-business-context";
import { getCreateSalonAccount, isOwnerMembership, isSalonManageContext, type CurrentBusinessContext } from "./current-context";
import { getExperienceContext } from "./experience-context";
import { requireSalonManagePageContext, requireSalonWorkspacePageContext } from "./route-context-guards";
import { hasPermission } from "./permissions";
import { getCurrentSalonSetting, getCurrentSalonDiscoveryReadiness } from "./salon-settings";
import { getSalonLifecycle, getSalonClosureReview } from "./salon-lifecycle";
import { getCurrentSalonOperatingHoursSettings, getCurrentSalonOperatingStatus } from "./salon-operating-status";
import { getCurrentSalonMapLocationState } from "./location/salon-map-location";
import { getCurrentSalonStaffDirectory } from "./staff";
import { getSalonOwnerRoster } from "./owner-transfer";
import { getCurrentSalonPosSettings } from "./pos-settings";
import { getCurrentSalonPortablePosAccessState } from "./pos-portable-access";
import { getWindowsPosRelease } from "./windows-pos-release";
import { createAuthenticatedSupabaseServerClient } from "./supabase/server";
import { buildSalonProfileFeed, getCurrentSalonProfileManageData, getPublicSalonProfileData, getSalonProfileHref, getSalonProfileMediaUrl } from "./salon-profile";
import { defaultSalonOperatingStatus } from "./salon-operating-status-core";
import { isPublicSalonProfileTeamEligible } from "./salon-profile-team";
import { loadSalonPostAttribution } from "./salon-post-attribution";
import { POS_TICKET_PERMISSIONS } from "./pos-tickets";
import { runReadWithDeadline } from "./bounded-get";
import { APP_LOCAL_BUSINESS_READS, APP_LOCAL_POS_SETTINGS_SNAPSHOT_KEYS, type AppLocalSalonsData, type AppLocalSalonProfileData, type AppLocalSalonSettingsData, type AppLocalPosSettingsData } from "./app-local-business-metadata";
import type { PublicSalonProfileData, PublicSalonProfileLook, PublicSalonProfileUpdate, SalonProfileViewerCapabilities, SalonProfileLook, SalonProfileSetting, SalonProfileUpdate } from "@/types/salon-profile";
import type { Service } from "@/types/service";
import type { StaffPresentation } from "./staff-profile";
import type { Staff } from "@/types/staff";
import type { AppLocalRead } from "./app-local-host";

export class AppLocalBusinessReadError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function check(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError"); }
function response(name: string, scope: string, data: unknown, etag?: string): AppLocalRead {
  // The form UUID remains one idempotency key per mounted draft; it is not a data revision.
  const stable = name === "customer.salons" ? { ...(data as AppLocalSalonsData), createRequestKey: undefined } : data;
  const revision = '"' + createHash("sha256").update(JSON.stringify({ schemaVersion: 1, scope, name, data: stable })).digest("hex") + '"';
  return { schemaVersion: 1, status: etag === revision ? 304 : 200, scope, etag: revision, updatedAt: Date.now(), ...(etag === revision ? {} : { data }) };
}

export async function readAppLocalBusinessResource(name: string, args: Record<string, unknown> = {}, options: { scope: string; etag?: string; signal?: AbortSignal }): Promise<AppLocalRead | null> {
  if (!Object.hasOwn(APP_LOCAL_BUSINESS_READS, name)) return null;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) throw new AppLocalBusinessReadError(400, "Unsupported page filter.");
  check(options.signal);
  const root = await runReadWithDeadline(getRequestBusinessContext(), 12000);
  if (!root.user) throw new AppLocalBusinessReadError(401, "Sign in required.");
  let context = root;
  if (name !== "customer.salons") {
    if (!root.currentSalon || !root.currentAccount) throw new AppLocalBusinessReadError(403, "Choose a salon first.");
    if (name !== "owner.salon-profile" && !isSalonManageContext(root)) throw new AppLocalBusinessReadError(403, "Open your salon management workspace.");
    context = await runReadWithDeadline(name === "owner.salon-profile" ? requireSalonWorkspacePageContext("/salon-profile") : requireSalonManagePageContext(name === "owner.pos-settings" ? "/pos/settings" : "/salon-settings"), 12000);
  }
  if (!options.scope || getExperienceContext(context).scope !== options.scope || context.user?.id !== root.user.id) throw new AppLocalBusinessReadError(409, "Your salon changed. Open this page again.");
  check(options.signal);
  let data: unknown;
  if (name === "customer.salons") {
    data = { salons: [...context.availableManageSalons].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      currentSalonId: context.currentBusiness?.id ?? context.currentSalon?.id ?? null, hasCreatePermission: Boolean(getCreateSalonAccount(context)), createRequestKey: randomUUID(), workspaceId: context.currentWorkspace?.id ?? null } satisfies AppLocalSalonsData;
  } else if (name === "owner.salon-profile") {
    data = await runReadWithDeadline(loadManagedSalonProfile(context), 20000);
  } else if (name === "owner.salon-settings") {
    if (!await hasPermission("salon_settings.view", context)) throw new AppLocalBusinessReadError(403, "You do not have permission to view salon settings.");
    const [{ setting }, canManageSettings, canViewStaff, lifecycle, operatingSettings] = await runReadWithDeadline(Promise.all([
      getCurrentSalonSetting(context), hasPermission("salon_settings.manage", context), hasPermission("staff.view", context), getSalonLifecycle(context.currentSalon!.id), getCurrentSalonOperatingHoursSettings(context),
    ]), 15000);
    if (!setting || !lifecycle) throw new AppLocalBusinessReadError(503, "Salon settings could not be loaded.");
    const isOwner = isOwnerMembership(context.currentMembership);
    const canManageOwnership = canManageSettings && (isOwner || context.permissionCodes.includes("account.manage"));
    const canManageLifecycle = canManageOwnership && lifecycle.lifecycleStatus !== "permanently_closed";
    const [discoveryReadiness, mapLocation, staffDirectory, ownerRoster, closureReview] = await runReadWithDeadline(Promise.all([
      getCurrentSalonDiscoveryReadiness(setting, context), getCurrentSalonMapLocationState({ context, setting }),
      canViewStaff ? getCurrentSalonStaffDirectory(context) : Promise.resolve({ staff: [] }),
      isOwner ? getSalonOwnerRoster(context.currentSalon!.id) : Promise.resolve(null),
      canManageLifecycle ? getSalonClosureReview({ context, salonId: context.currentSalon!.id }) : Promise.resolve(null),
    ]), 15000);
    data = { setting, lifecycle, operatingSettings, discoveryReadiness, mapLocation, staffDirectory, ownerRoster, closureReview, canManageSettings, canViewStaff, canManageOwnership, canManageLifecycle, isOwner,
      salonId: context.currentSalon!.id, workspaceLabel: context.currentWorkspace?.label ?? "Current salon" } satisfies AppLocalSalonSettingsData;
  } else if (name === "owner.pos-settings") {
    if (!await hasPermission(POS_TICKET_PERMISSIONS.manage, context)) throw new AppLocalBusinessReadError(403, "You do not have permission to manage POS settings.");
    const [portableAccessState, settings, desktopRelease, client] = await runReadWithDeadline(Promise.all([
      getCurrentSalonPortablePosAccessState(context), getCurrentSalonPosSettings(context), getWindowsPosRelease(), createAuthenticatedSupabaseServerClient(),
    ]), 15000);
    if (!client) throw new AppLocalBusinessReadError(401, "Please sign in again.");
    const raw = await runReadWithDeadline(Promise.resolve(client.from("pos_settings").select(APP_LOCAL_POS_SETTINGS_SNAPSHOT_KEYS.join(",")).eq("salon_id", context.currentSalon!.id).maybeSingle()), 12000);
    if (raw.error) throw new AppLocalBusinessReadError(503, "POS settings could not be loaded.");
    const row = raw.data as Record<string, unknown> | null;
    const snapshot = Object.fromEntries(APP_LOCAL_POS_SETTINGS_SNAPSHOT_KEYS.filter(key => row && Object.hasOwn(row, key)).map(key => [key, row![key]]));
    data = { portableAccessState, settings, desktopRelease, snapshot, canManageSettings: true } satisfies AppLocalPosSettingsData;
  }
  check(options.signal);
  return response(name, options.scope, data, options.etag);
}

async function loadManagedSalonProfile(context: CurrentBusinessContext): Promise<AppLocalSalonProfileData> {
  const data = await getCurrentSalonProfileManageData(context);
  if (!data.canViewProfile) throw new AppLocalBusinessReadError(403, "You do not have permission to view Salon Profile.");
  const [operatingStatus, publicData] = await Promise.all([getCurrentSalonOperatingStatus(context).catch(() => defaultSalonOperatingStatus()), getPublicSalonProfileData(data.setting.salon_id)]);
  const attribution = await loadSalonPostAttribution([...data.looks, ...data.updates].map(post => post.id));
  const previewData = buildPreviewData({ attribution, ...data, accountId: data.context.currentAccount?.id ?? data.context.accountId ?? "", operatingStatus });
  const managedSalonName = data.context.currentSalon?.name ?? previewData.profile.name;
  const viewData = publicData ? withManagedPreviewStaff(withManagedSalonName(publicData, managedSalonName), previewData) : previewData;
  const capabilities: SalonProfileViewerCapabilities = {
    canBook: Boolean(publicData) && viewData.profile.operatingStatus.kind !== "permanently_closed", canCreateContent: data.canCreateContent,
    canEditProfile: data.canManageIdentity, canFollow: false, canManageContent: data.canManageContent, canFeatureOwnContent: isOwnerMembership(context.currentMembership),
    canModerateComments: data.canManageContent, canPublish: data.canManageIdentity, canReplyAsSalon: data.canManageContent, canViewDraftContent: data.canManageContent,
    currentUserId: context.user?.id ?? null, isAuthenticated: Boolean(context.user), isOwnSalon: isSalonManageContext(context),
  };
  return { capabilities, data: viewData, manageData: {
    ownedLookIds: data.looks.filter(look => (look.created_by_user_id ?? look.author_user_id) === context.user?.id).map(look => look.id),
    publicHref: publicData ? getSalonProfileHref(data.setting.salon_id) : null, readiness: data.readiness, setting: data.setting,
  } };
}

// The following pure projection functions are the shipped management preview logic.
function buildPreviewData(input: {
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

function withManagedSalonName(
  data: PublicSalonProfileData,
  name: string,
): PublicSalonProfileData {
  if (data.profile.name === name) {
    return data;
  }

  return {
    ...data,
    feed: buildSalonProfileFeed({
      looks: data.looks,
      profileName: name,
      salonId: data.profile.salonId,
      updates: data.updates,
    }),
    profile: {
      ...data.profile,
      name,
    },
  };
}

function withManagedPreviewStaff(
  data: PublicSalonProfileData,
  previewData: PublicSalonProfileData,
): PublicSalonProfileData {
  const publicStaffIds = new Set(data.staff.map((member) => member.id));
  const missingPreviewStaff = previewData.staff.filter(
    (member) => !publicStaffIds.has(member.id),
  );

  if (missingPreviewStaff.length === 0) {
    return data;
  }

  return {
    ...data,
    staff: [...data.staff, ...missingPreviewStaff],
  };
}

