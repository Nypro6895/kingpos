/** Keep transport tabs distinct: they choose preload and entitlement reads.
 * Presentation-only filters do not create additional server reads. */
export function payrollReadArgs(path: string): Record<string, string> {
  const query = new URL(path, "https://reylumi.com").searchParams;
  const args: Record<string, string> = {};
  for (const key of ["end", "month", "payPeriodStart", "preset", "segment", "start"]) {
    const value = query.get(key);
    if (value !== null) args[key] = value;
  }
  const tab = query.get("tab");
  args.tab = tab && ["staff", "shop", "gifts", "rewards", "discounts", "settings", "tools", "download", "tax", "analytics", "overview", "differences", "record"].includes(tab) ? tab : "shop";
  return args;
}
