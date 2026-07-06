export type Service = {
  id: string;
  organization_id: string;
  salon_id: string;
  name: string;
  category: string | null;
  base_price: number;
  duration_minutes: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateServiceInput = {
  name: string;
  category?: string | null;
  base_price: number;
  duration_minutes: number;
  description?: string | null;
  is_active?: boolean;
};
