export type SalonSetting = {
  id: string;
  organization_id: string;
  salon_id: string;
  business_name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  business_description: string | null;
  allow_staff_applications: boolean;
  public_discovery_enabled: boolean;
  public_discovery_published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UpdateSalonSettingInput = {
  business_name: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  business_description?: string | null;
  allow_staff_applications?: boolean;
  public_discovery_enabled?: boolean;
};
