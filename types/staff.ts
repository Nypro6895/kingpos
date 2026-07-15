export type Staff = {
  id: string;
  organization_id: string;
  salon_id: string;
  account_user_id: string | null;
  user_id: string | null;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  job_title: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateStaffInput = {
  display_name: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  job_title?: string | null;
  is_active?: boolean;
};
