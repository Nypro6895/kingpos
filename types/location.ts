export const LOCATION_STATUSES = ["active", "inactive"] as const;

export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export type Location = {
  id: string;
  organization_id: string;
  name: string;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  status: LocationStatus;
  created_at: string;
  updated_at: string;
};
