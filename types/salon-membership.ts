import type { Role } from "@/types/role";

export const SALON_MEMBERSHIP_STATUSES = [
  "invited",
  "active",
  "inactive",
  "removed",
] as const;

export type SalonMembershipStatus =
  (typeof SALON_MEMBERSHIP_STATUSES)[number];

export type SalonMembership = {
  id: string;
  account_id: string;
  salon_id: string;
  user_id: string;
  role_id: string | null;
  role: Role | null;
  status: SalonMembershipStatus;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
};
