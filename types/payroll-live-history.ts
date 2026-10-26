export type PayrollLiveChange = {
  id: string; salon_id: string; staff_id: string | null; source_table: string; source_id: string;
  period_start: string; period_end: string; before_values: Record<string, unknown>;
  after_values: Record<string, unknown>; actor_id: string | null; created_at: string;
};
