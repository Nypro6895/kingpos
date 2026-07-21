export type ContentBookingSourceType =
  | "salon_profile_look"
  | "salon_profile_update";

export type ContentBookingContentType = "look" | "update";

export type ContentBookingReadinessState =
  | "quick_ready"
  | "service_ready"
  | "professional_ready"
  | "inspiration_only"
  | "invalid";

export type ContentBookingMappedService = {
  basePrice: number;
  displayOrder: number;
  durationMinutes: number;
  eligible: boolean;
  parentServiceId: string | null;
  role: "additional_service" | "add_on";
  serviceId: string;
  serviceName: string;
};

export type PublicContentBookingOption = {
  addOns: ContentBookingMappedService[];
  additionalServices: ContentBookingMappedService[];
  bookingCtaEnabled: boolean;
  bookingEnabled: boolean;
  bookingHref: string | null;
  bookingNote: string | null;
  caption: string | null;
  contentId: string;
  contentType: ContentBookingContentType;
  creditedStaffId: string | null;
  creditedStaffName: string | null;
  ctaLabel: string;
  imageUrl: string | null;
  mediaPath: string | null;
  organizationId: string;
  primaryServiceBasePrice: number | null;
  primaryServiceDurationMinutes: number | null;
  primaryServiceId: string | null;
  primaryServiceName: string | null;
  readinessMessage: string;
  readinessState: ContentBookingReadinessState;
  salonId: string;
  sourceType: ContentBookingSourceType;
  title: string;
};
