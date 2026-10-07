type WorkingRule = {
  staff_id: string | null; rule_type: string; is_active: boolean; day_of_week: number;
  starts_at_local: string; ends_at_local: string;
  effective_start_date: string | null; effective_end_date: string | null;
};

/** A manually chosen date always wins. Missing salon hours keep today's schedule. */
export function defaultStaffScheduleDate(today: string, localMinutes: number, rules: WorkingRule[]) {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const closes = rules.filter(rule => rule.staff_id === null && rule.is_active && rule.rule_type === "working" && rule.day_of_week === weekday && (!rule.effective_start_date || rule.effective_start_date <= today) && (!rule.effective_end_date || rule.effective_end_date >= today)).map(rule => {
    const start = minutes(rule.starts_at_local);
    const end = minutes(rule.ends_at_local);
    return end <= start ? end + 1440 : end;
  });
  if (!closes.length || localMinutes < Math.max(...closes)) return today;
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
