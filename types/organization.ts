export const ORGANIZATION_STATUSES = [
  "active",
  "inactive",
  "suspended",
  "archived",
] as const;

export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export type Organization = {
  id: string;
  name: string;
  legal_name: string | null;
  owner_user_id: string;
  status: OrganizationStatus;
  created_at: string;
  updated_at: string;
};
