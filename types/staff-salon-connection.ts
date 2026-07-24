export const STAFF_SALON_CONNECTION_DIRECTIONS = [
  "salon_invite",
  "staff_application",
] as const;

export type StaffSalonConnectionDirection =
  (typeof STAFF_SALON_CONNECTION_DIRECTIONS)[number];

export const STAFF_SALON_CONNECTION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "revoked",
  "expired",
] as const;

export type StaffSalonConnectionStatus =
  (typeof STAFF_SALON_CONNECTION_STATUSES)[number];

export type StaffSalonConnectionRequest = {
  accepted_at: string | null;
  account_user_id: string | null;
  cancelled_at: string | null;
  created_at: string;
  declined_at: string | null;
  direction: StaffSalonConnectionDirection;
  expires_at: string | null;
  id: string;
  initiated_by_user_id: string;
  message: string | null;
  requested_job_title: string | null;
  reviewed_by_user_id: string | null;
  revoked_at: string | null;
  salon_id: string;
  staff_id: string | null;
  status: StaffSalonConnectionStatus;
  target_email_normalized: string | null;
  target_phone_e164: string | null;
  updated_at: string;
};

export type StaffAccountExactMatchType = "email" | "phone" | "email_phone";

export type StaffAccountExactSearchResult =
  | {
      status: "not_found";
    }
  | {
      status: "ambiguous";
    }
  | {
      account: {
        avatar_url: string | null;
        display_name: string | null;
        id: string;
        masked_email: string | null;
        masked_phone: string | null;
      };
      match_type: StaffAccountExactMatchType;
      status: "found";
    };

export type CreateSalonStaffInviteBaseInput = {
  email?: string | null;
  first_name?: string | null;
  is_active?: boolean;
  job_title?: string | null;
  last_name?: string | null;
  phone?: string | null;
};

export type CreateSalonStaffInviteExistingAccountInput =
  CreateSalonStaffInviteBaseInput & {
    account_user_id: string;
    display_name?: string | null;
    mode: "existing_account";
    staff_id?: string | null;
  };

export type CreateSalonStaffInviteNewAccountInput =
  CreateSalonStaffInviteBaseInput & {
    display_name: string;
    mode: "new_account";
  };

export type CreateSalonStaffInviteInput =
  | CreateSalonStaffInviteExistingAccountInput
  | CreateSalonStaffInviteNewAccountInput;

export type CreateSalonStaffInviteResult = {
  invite_token: string;
  request: StaffSalonConnectionRequest;
};

export type StaffConnectionInviteTokenDetails = {
  expires_at: string | null;
  is_expired: boolean;
  request_id: string;
  salon: {
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    country: string | null;
    id: string;
    name: string;
    postal_code: string | null;
    state: string | null;
    status: "active" | "inactive";
  };
  staff: {
    display_name: string;
    id: string;
    is_active: boolean;
    job_title: string | null;
  };
  status: StaffSalonConnectionStatus | "invalid";
  target: {
    has_account_target: boolean;
    masked_email: string | null;
    masked_phone: string | null;
  };
};

export type StaffConnectionRpcResult = {
  request_id: string;
  salon_id?: string;
  staff_id?: string | null;
  status: StaffSalonConnectionStatus;
};

export type PublicStaffApplicationSalon = {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
  salon_id: string;
  salon_name: string;
  state: string | null;
};

export type StaffConnectionRequestAccountSummary = {
  avatar_url: string | null;
  display_name: string | null;
  id: string;
  masked_email: string | null;
  masked_phone: string | null;
  status: string | null;
};

export type StaffConnectionRequestStaffSummary = {
  account_user_id: string | null;
  display_name: string;
  email: string | null;
  id: string;
  is_active: boolean;
  job_title: string | null;
  phone: string | null;
};

export type SalonStaffConnectionRequestWithDetails =
  StaffSalonConnectionRequest & {
    account: StaffConnectionRequestAccountSummary | null;
    staff: StaffConnectionRequestStaffSummary | null;
  };

export type StaffConnectionDashboardRequest = {
  accepted_at: string | null;
  address_line1: string | null;
  address_line2: string | null;
  cancelled_at: string | null;
  city: string | null;
  country: string | null;
  created_at: string;
  declined_at: string | null;
  direction: StaffSalonConnectionDirection;
  expires_at: string | null;
  id: string;
  message: string | null;
  postal_code: string | null;
  requested_job_title: string | null;
  revoked_at: string | null;
  salon_id: string;
  salon_name: string;
  staff_display_name: string | null;
  staff_id: string | null;
  staff_job_title: string | null;
  state: string | null;
  status: StaffSalonConnectionStatus;
  target_masked_email: string | null;
  target_masked_phone: string | null;
  updated_at: string;
};

export type SubmitStaffSalonApplicationInput = {
  message?: string | null;
  requested_job_title?: string | null;
  salon_id: string;
};

export type ReviewStaffSalonApplicationInput =
  | {
      decision: "declined";
      request_id: string;
    }
  | {
      decision: "accepted";
      display_name?: string | null;
      email?: string | null;
      job_title?: string | null;
      phone?: string | null;
      request_id: string;
      staff_id?: string | null;
    };
