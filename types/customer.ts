export const CUSTOMER_STATUSES = ["active", "inactive"] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export type Customer = {
  id: string;
  location_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: CustomerStatus;
  created_at: string;
  updated_at: string;
};

export type CustomerFormState = {
  error?: string;
};
