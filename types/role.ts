export const SYSTEM_ROLE_CODES = [
  "OWNER",
  "MANAGER",
  "FRONT_DESK",
  "TECHNICIAN",
  "ACCOUNTANT",
  "MARKETING",
] as const;

export type SystemRoleCode = (typeof SYSTEM_ROLE_CODES)[number];

export type Role = {
  id: string;
  organization_id: string;
  name: string;
  code: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type RoleWithMemberCount = Role & {
  member_count: number;
};
