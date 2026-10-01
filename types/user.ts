export const KING_USER_STATUSES = [
  "active",
  "inactive",
  "pending_deletion",
  "suspended",
  "deleted",
] as const;

export type KingUserStatus = (typeof KING_USER_STATUSES)[number];

export type KingUser = {
  id: string;
  auth_user_id: string | null;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  status: KingUserStatus;
  language: string;
  timezone: string;
  deletion_requested_at?: string | null;
  deletion_scheduled_for?: string | null;
  deleted_at?: string | null;
  anonymized_at?: string | null;
  deletion_finalization_started_at?: string | null;
  deletion_finalized_at?: string | null;
  deletion_finalization_attempts?: number | null;
  deletion_finalization_failed_at?: string | null;
  deletion_finalization_error?: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};
