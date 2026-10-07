import assert from "node:assert/strict";
import test from "node:test";
import { defaultStaffScheduleDate } from "../lib/staff-schedule-date.ts";

const rule = { staff_id: null, rule_type: "working", is_active: true, day_of_week: 4, starts_at_local: "09:00:00", ends_at_local: "19:00:00", effective_start_date: null, effective_end_date: null };
test("salon closing time, not a fixed evening cutoff, selects tomorrow", () => {
  assert.equal(defaultStaffScheduleDate("2026-10-01", 1139, [rule]), "2026-10-01");
  assert.equal(defaultStaffScheduleDate("2026-10-01", 1140, [rule]), "2026-10-02");
});
test("split hours use final close and ignore staff overrides, breaks and expired rules", () => {
  const rules = [rule, {...rule, ends_at_local: "21:00"}, {...rule, staff_id: "staff", ends_at_local: "23:00"}, {...rule, rule_type: "break", ends_at_local: "23:00"}, {...rule, effective_end_date: "2026-09-30", ends_at_local: "23:00"}];
  assert.equal(defaultStaffScheduleDate("2026-10-01", 1200, rules), "2026-10-01");
  assert.equal(defaultStaffScheduleDate("2026-10-01", 1260, rules), "2026-10-02");
});
test("unknown hours and overnight shifts do not jump early", () => {
  assert.equal(defaultStaffScheduleDate("2026-10-01", 1320, []), "2026-10-01");
  assert.equal(defaultStaffScheduleDate("2026-10-01", 1320, [{...rule, starts_at_local: "18:00", ends_at_local: "02:00"}]), "2026-10-01");
});
test("closing at month end rolls into next month", () => {
  assert.equal(defaultStaffScheduleDate("2026-12-31", 1200, [rule]), "2027-01-01");
});
