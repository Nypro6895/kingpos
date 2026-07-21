export type Permission = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type RolePermission = {
  id: string;
  role_id: string;
  permission_id: string;
  created_at: string;
};
