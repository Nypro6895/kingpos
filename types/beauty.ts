import type { BeautyPostMediaRole } from "@/lib/beauty-media";

export type BeautyProfileVisibility = "public" | "self";
export type BeautyPostType = "before_after" | "regular";
export type BeautyVerificationState =
  | "pending"
  | "rejected"
  | "unverified"
  | "verified";
export type BeautyVerificationMethod =
  | "booking_checkin"
  | "completed_booking"
  | "none"
  | "pos_ticket";
export type BeautySalonPublicationStatus =
  | "approved"
  | "declined"
  | "pending";

export type BeautyTimelineCursor = {
  createdAt: string;
  postId: string;
};

export type BeautyProfileSummary = {
  avatarUrl: string | null;
  bio: string | null;
  coverImageUrl: string | null;
  coverMediaPath: string | null;
  createdAt: string;
  displayName: string;
  id: string;
  initials: string;
  isSelf: boolean;
  visibility: BeautyProfileVisibility;
};

export type BeautyPostMedia = {
  displayOrder: number;
  height: number | null;
  id: string;
  mimeType: string | null;
  objectPath: string;
  role: BeautyPostMediaRole;
  url: string | null;
  width: number | null;
};

export type BeautyPostAttribution = {
  salonId: string;
  salonName: string;
  source: string;
  staffId: string | null;
  staffName: string | null;
};

export type BeautyPostVerification = {
  method: BeautyVerificationMethod;
  state: BeautyVerificationState;
  verifiedAt: string | null;
};

export type BeautyPostReward = {
  createdAt: string;
  creditAmount: number | null;
  pointsAmount: number;
  rewardType: string;
  status: string;
};

export type BeautyPostSalonPublication = {
  id: string;
  requestedAt: string;
  respondedAt: string | null;
  status: BeautySalonPublicationStatus;
};

export type BeautyPostBookingAction = {
  href: string;
  salonId: string;
  salonName: string;
  verifiedBookingCount: number;
};

export type BeautyTimelinePost = {
  attribution: BeautyPostAttribution | null;
  author: {
    avatarUrl: string | null;
    displayName: string;
    profileId: string;
  };
  bookingAction: BeautyPostBookingAction | null;
  caption: string | null;
  commentCount: number;
  createdAt: string;
  editedAt: string | null;
  id: string;
  media: BeautyPostMedia[];
  profileId: string;
  reward: BeautyPostReward | null;
  salonPublication: BeautyPostSalonPublication | null;
  type: BeautyPostType;
  updatedAt: string;
  verification: BeautyPostVerification | null;
  visibility: BeautyProfileVisibility;
};

export type BeautyTimelinePage = {
  error: string | null;
  hasMore: boolean;
  items: BeautyTimelinePost[];
  nextCursor: BeautyTimelineCursor | null;
};

export type BeautyRecentVisitCandidate = {
  occurredAt: string;
  salonId: string;
  salonName: string;
  source: "booking" | "check_in" | "receipt";
  staffId: string | null;
  staffName: string | null;
  visitKey: string;
};

export type BeautyAttributionStaff = {
  staffId: string;
  staffName: string;
};

export type BeautyAttributionSalon = {
  city: string | null;
  salonId: string;
  salonName: string;
  staff: BeautyAttributionStaff[];
  state: string | null;
};

export type BeautyPostMediaInput = {
  bytes?: number | null;
  height?: number | null;
  mimeType?: string | null;
  objectPath: string;
  role: BeautyPostMediaRole;
  width?: number | null;
};

export type BeautyPostCreateInput = {
  attributionSource?: "customer_claimed" | "recent_visit_suggestion";
  caption?: string | null;
  media: BeautyPostMediaInput[];
  postType: BeautyPostType;
  salonId?: string | null;
  staffId?: string | null;
};
