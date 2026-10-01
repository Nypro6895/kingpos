export const ACCOUNT_STATUSES = [
  "active",
  "inactive",
  "suspended",
  "archived",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export type Account = {
  id: string;
  name: string;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
};

export const ACCOUNT_MEMBERSHIP_STATUSES = [
  "invited",
  "active",
  "inactive",
  "removed",
] as const;

export type AccountMembershipStatus =
  (typeof ACCOUNT_MEMBERSHIP_STATUSES)[number];

export type AccountMembership = {
  id: string;
  account_id: string;
  role_id: string | null;
  user_id: string;
  status: AccountMembershipStatus;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
};
