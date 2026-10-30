export type PayrollLiveChange = {
  id: string; salon_id: string; staff_id: string | null; source_table: string; source_id: string;
  staff_snapshot?: { id: string; displayName: string | null } | null;
  period_start: string; period_end: string; before_values: Record<string, unknown>;
  after_values: Record<string, unknown>; actor_id: string | null; created_at: string;
  actor_name?: string; note?: string; business_timezone?: string;
  staff_projections?: Array<{staff_id:string;staff_name:string;before_values:Record<string,unknown>;after_values:Record<string,unknown>}>;
};
