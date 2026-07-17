export const CUSTOMER_STATUSES = ["active", "inactive"] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export type Customer = {
  id: string;
  location_id: string;
  customer_user_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  staff_notes: string | null;
  internal_notes: string | null;
  source: "account_link" | "import" | "manual" | "owner_booking" | "pos" | "public_booking";
  status: CustomerStatus;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerFormState = {
  error?: string;
};
