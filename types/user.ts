export const KING_USER_STATUSES = [
  "active",
  "inactive",
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
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};
