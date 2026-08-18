import type { BeautyPostBookingPresentation } from "@/lib/beauty-booking-verification";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";
import type {
  BeautyPostType,
  BeautyVerificationState,
} from "@/types/beauty";

export const SALON_PROFILE_MOOD_OPTIONS = [
  "Soft & clean",
  "Summer bright",
  "Rich & modern",
  "Special moment",
  "Surprise me",
] as const;

export const SALON_PROFILE_BADGE_OPTIONS = [
  "New drop",
  "Fresh this week",
  "Bridal edit",
  "Seasonal",
] as const;

export const SALON_PROFILE_UPDATE_TYPES = [
  "last_minute_opening",
  "fresh_from_studio",
  "announcement",
  "new_artist",
  "seasonal_offer",
] as const;

export type SalonProfileLookStatus = "archived" | "draft" | "published";

export type SalonProfileUpdateType =
  (typeof SALON_PROFILE_UPDATE_TYPES)[number];

export type SalonProfileUpdateStatus = "archived" | "draft" | "published";

export type SalonProfilePublicationStatus =
  | "draft"
  | "incomplete"
  | "published"
  | "ready";

export type SalonProfileReadinessItem = {
  complete: boolean;
  id: string;
  label: string;
  required: boolean;
};

export type SalonProfileReadiness = {
  canPublish: boolean;
  completionPercent: number;
  isExploreEligible: boolean;
  items: SalonProfileReadinessItem[];
  missingRequiredItems: string[];
  status: SalonProfilePublicationStatus;
};

export type SalonProfileSetting = {
  id: string;
  salon_id: string;
  business_name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  business_description: string | null;
  allow_staff_applications: boolean;
  public_discovery_enabled: boolean;
  public_discovery_published_at: string | null;
  public_profile_tagline: string | null;
  public_profile_story: string | null;
  public_profile_logo_path: string | null;
  public_profile_cover_path: string | null;
  created_at: string;
  updated_at: string;
};

export type SalonProfileLook = {
  id: string;
  salon_id: string;
  author_user_id: string | null;
  author_avatar_path: string | null;
  author_display_name: string | null;
  author_staff_id: string | null;
  created_by_user_id: string | null;
  service_id: string | null;
  recommended_staff_id: string | null;
  title: string;
  caption: string | null;
  emotional_description: string | null;
  why_love_it: string | null;
  mood: string | null;
  duration_minutes: number | null;
  starting_price: number | null;
  palette: string[];
  badge: string | null;
  media_path: string | null;
  booking_note: string | null;
  is_pinned: boolean;
  status: SalonProfileLookStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  service?: Pick<Service, "id" | "name"> | null;
  recommended_staff?: Pick<Staff, "display_name" | "id"> | null;
};

export type SalonProfileUpdate = {
  id: string;
  salon_id: string;
  author_user_id: string | null;
  author_avatar_path: string | null;
  author_display_name: string | null;
  author_staff_id: string | null;
  created_by_user_id: string | null;
  service_id: string | null;
  staff_id: string | null;
  update_type: SalonProfileUpdateType;
  title: string;
  caption: string | null;
  summary: string | null;
  media_path: string | null;
  starts_at: string | null;
  ends_at: string | null;
  cta_label: string | null;
  status: SalonProfileUpdateStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  service?: Pick<Service, "id" | "name"> | null;
  staff?: Pick<Staff, "display_name" | "id"> | null;
};

export type PublicSalonProfile = {
  activeServiceCount: number;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  country: string | null;
  coverImageUrl: string | null;
  description: string | null;
  email: string | null;
  followerCount: number;
  isFollowing: boolean;
  logoImageUrl: string | null;
  accountId: string;
  phone: string | null;
  postalCode: string | null;
  publishedAt: string | null;
  salonId: string;
  serviceCategories: string[];
  serviceNames: string[];
  state: string | null;
  story: string | null;
  tagline: string | null;
  website: string | null;
  name: string;
};

export type PublicSalonProfileService = {
  basePrice: number;
  category: string | null;
  description: string | null;
  durationMinutes: number;
  id: string;
  name: string;
};

export type PublicSalonProfileStaff = {
  avatarUrl: string | null;
  bio: string | null;
  displayName: string;
  id: string;
  jobTitle: string | null;
  onlineBookingEnabled: boolean;
  portfolioCount: number;
  specialties: string[];
};

export type PublicSalonProfileLook = {
  authorAvatarUrl: string | null;
  authorDisplayName: string;
  authorStaffId: string | null;
  badge: string | null;
  bookingNote: string | null;
  caption: string | null;
  commentCount: number;
  durationMinutes: number | null;
  emotionalDescription: string | null;
  id: string;
  imageUrl: string | null;
  isPinned: boolean;
  isSaved: boolean;
  mood: string | null;
  palette: string[];
  publishedAt: string | null;
  recommendedStaffId: string | null;
  recommendedStaffName: string | null;
  saveCount: number;
  serviceId: string | null;
  serviceName: string | null;
  startingPrice: number | null;
  hashtags: string[];
  title: string;
  whyLoveIt: string | null;
};

export type PublicSalonProfileUpdate = {
  authorAvatarUrl: string | null;
  authorDisplayName: string;
  authorStaffId: string | null;
  caption: string | null;
  commentCount: number;
  ctaLabel: string | null;
  endsAt: string | null;
  id: string;
  imageUrl: string | null;
  publishedAt: string | null;
  serviceId: string | null;
  serviceName: string | null;
  staffId: string | null;
  staffName: string | null;
  hashtags: string[];
  startsAt: string | null;
  summary: string | null;
  title: string;
  type: SalonProfileUpdateType;
};

export type PublicSalonProfileBeautyPostMedia = {
  displayOrder: number;
  height: number | null;
  id: string;
  role: "after" | "before" | "image";
  url: string | null;
  width: number | null;
};

export type PublicSalonProfileBeautyPost = {
  approvedAt: string | null;
  authorAvatarUrl: string | null;
  authorDisplayName: string;
  booking: BeautyPostBookingPresentation | null;
  caption: string | null;
  id: string;
  media: PublicSalonProfileBeautyPostMedia[];
  postHref: string;
  postType: BeautyPostType;
  profileId: string;
  publishedAt: string;
  staffId: string | null;
  staffName: string | null;
  verificationState: BeautyVerificationState | null;
};

export type PublicSalonProfileComment = {
  authorDisplayName: string;
  authorUserId: string | null;
  body: string;
  createdAt: string;
  id: string;
  isSalonReply: boolean;
  lookId: string | null;
  parentCommentId: string | null;
  salonId: string;
  updatedAt: string;
  updateId: string | null;
};

export type PublicSalonProfileReviewSummary = {
  averageRating: number | null;
  ratingCounts: Record<1 | 2 | 3 | 4 | 5, number>;
  reviewCount: number;
  verifiedCount: number;
};

export type PublicSalonProfileReview = {
  authorDisplayName: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  id: string;
  rating: number;
  replyBody: string | null;
  replyCreatedAt: string | null;
  replyId: string | null;
  salonId: string;
  title: string | null;
  updatedAt: string;
  verificationStatus: "unverified" | "verified";
  verifiedBookingId: string | null;
};

export type ProfileFeedItem =
  | {
      authorName: string;
      authorAvatarUrl: string | null;
      authorStaffId: string | null;
      bookingLookId: string;
      caption: string | null;
      commentCount: number;
      contentType: "look";
      durationMinutes: number | null;
      id: string;
      imageUrl: string | null;
      isPinned: boolean;
      isSaved: boolean;
      mood: string | null;
      publishedAt: string | null;
      recommendedStaffId: string | null;
      recommendedStaffName: string | null;
      salonId: string;
      saveCount: number;
      serviceId: string | null;
      serviceName: string | null;
      startingPrice: number | null;
      hashtags: string[];
      title: string;
    }
  | {
      authorName: string;
      authorAvatarUrl: string | null;
      authorStaffId: string | null;
      bookingLookId: null;
      caption: string | null;
      commentCount: number;
      contentType: "update";
      id: string;
      imageUrl: string | null;
      isPinned: false;
      publishedAt: string | null;
      salonId: string;
      serviceId: string | null;
      serviceName: string | null;
      staffId: string | null;
      staffName: string | null;
      hashtags: string[];
      startsAt: string | null;
      title: string;
      updateType: SalonProfileUpdateType;
    };

export type SalonProfileViewerCapabilities = {
  canBook: boolean;
  canCreateContent: boolean;
  canEditProfile: boolean;
  canFollow: boolean;
  canManageContent: boolean;
  canModerateComments: boolean;
  canPublish: boolean;
  canReplyAsSalon: boolean;
  canViewDraftContent: boolean;
  isAuthenticated: boolean;
  isOwnSalon: boolean;
};

export type PublicSalonProfileBookingRequest = {
  createdAt: string;
  id: string;
  lookId: string | null;
  privateNote: string | null;
  requestedStartAt: string | null;
  salonId: string;
  serviceId: string | null;
  staffId: string | null;
  status: "approved" | "cancelled" | "declined" | "requested";
};

export type PublicSalonProfileData = {
  beautyPosts: PublicSalonProfileBeautyPost[];
  comments: PublicSalonProfileComment[];
  feed: ProfileFeedItem[];
  looks: PublicSalonProfileLook[];
  profile: PublicSalonProfile;
  reviewSummary: PublicSalonProfileReviewSummary;
  reviews: PublicSalonProfileReview[];
  services: PublicSalonProfileService[];
  staff: PublicSalonProfileStaff[];
  updates: PublicSalonProfileUpdate[];
};
