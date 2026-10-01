export type Service = {
  id: string;
  salon_id: string;
  name: string;
  category: string | null;
  base_price: number;
  duration_minutes: number;
  description: string | null;
  is_active: boolean;
  online_booking_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type ServiceAddOnLink = {
  add_on_service_id: string;
  display_order: number;
  id: string;
  is_active: boolean;
  parent_service_id: string;
};

export type ServiceBookingStaff = {
  avatarPath: string | null;
  avatarUrl: string | null;
  bookingReady: boolean;
  displayName: string;
  id: string;
  isActive: boolean;
  onlineBookingEnabled: boolean;
};

export type ServiceBookingReadinessReasonCode =
  | "no_booking_staff"
  | "no_ready_booking_staff"
  | "online_booking_disabled"
  | "service_inactive";

export type ServiceBookingReadiness = {
  bookingStaffCount: number;
  eligibleBookingStaffCount: number;
  needsSetup: boolean;
  ready: boolean;
  reasons: Array<{
    code: ServiceBookingReadinessReasonCode;
    label: string;
  }>;
};

export type ServiceWorkspaceService = Service & {
  addOnServiceIds: string[];
  bookingStaffIds: string[];
  readiness: ServiceBookingReadiness;
};

export type ServicesWorkspaceData = {
  addOnLinks: ServiceAddOnLink[];
  canManage: boolean;
  services: ServiceWorkspaceService[];
  staff: ServiceBookingStaff[];
};

export type ServiceConfigInput = {
  addOnServiceIds: string[];
  basePrice: number;
  bookingStaffIds: string[];
  category: string | null;
  description: string | null;
  durationMinutes: number;
  isActive: boolean;
  name: string;
  onlineBookingEnabled: boolean;
  serviceId?: string | null;
};

export type ServiceConfigFieldErrors = Partial<
  Record<
    | "addOnServiceIds"
    | "basePrice"
    | "bookingStaffIds"
    | "category"
    | "description"
    | "durationMinutes"
    | "name"
    | "onlineBookingEnabled",
    string
  >
>;

export type ServiceConfigValidation = {
  fieldErrors: ServiceConfigFieldErrors;
  valid: boolean;
};

export type SaveServiceConfigsResult =
  | {
      message: string;
      ok: true;
      serviceIds: string[];
    }
  | {
      message: string;
      ok: false;
      serviceErrors?: Record<string, string>;
    };
