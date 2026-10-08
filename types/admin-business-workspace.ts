import type { DashboardRecord } from "./admin-dashboard-record";
export type BusinessPerson = {
  id: string;
  name: string;
  contact: string | null;
};
export type BusinessRow = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  phone: string | null;
  account_id: string | null;
  owners: BusinessPerson[];
  creator: BusinessPerson | null;
  ownership: "claimed" | "unclaimed" | "pending";
  verification: string;
  needs_review: boolean;
  missing_contact: boolean;
  overdue: boolean;
  marked: boolean;
  followup_reason: string | null;
  due_at: string | null;
  assignee: string | null;
};
export type BusinessReview = {
  request_id: string;
  location_id: string;
  name: string;
  kind: "claims" | "verification";
  label: string;
  created_at: string;
  assigned_user_id: string | null;
  assignee: string | null;
};
export type BusinessWorkspace = {
  items: BusinessRow[];
  total: number;
  page: number;
  counts: Record<
    "all" | "active" | "new" | "unclaimed" | "review" | "followup",
    number
  >;
  cities: string[];
  reviews: BusinessReview[];
  review_total: number;
  missing_contact_total: number;
  missing_contacts: BusinessRow[];
  followup_due_total: number;
  followups: BusinessRow[];
};
export type BusinessRecord = DashboardRecord & { business: BusinessRow };
