import type { Organization } from "@/types/organization";
import type { Role } from "@/types/role";
import type { KingUser } from "@/types/user";

export const MEMBERSHIP_STATUSES = [
  "invited",
  "active",
  "inactive",
  "removed",
] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export type OrganizationMembership = {
  id: string;
  organization_id: string;
  user_id: string;
  role_id: string | null;
  role: Role | null;
  legacy_role?: string | null;
  status: MembershipStatus;
  invited_by_user_id: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrganizationMembershipWithOrganization = OrganizationMembership & {
  organization: Organization | null;
};

export type OrganizationMember = OrganizationMembership & {
  user: Pick<KingUser, "id" | "display_name" | "email"> | null;
};
