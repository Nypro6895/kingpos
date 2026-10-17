/** Presentation filters are applied to the loaded payroll snapshot, not read again. */
export function payrollReadArgs(path: string): Record<string, string> {
  const query = new URL(path, "https://reylumi.com").searchParams;
  const args: Record<string, string> = {};
  for (const key of ["end", "month", "payPeriodStart", "preset", "segment", "start"]) {
    const value = query.get(key);
    if (value !== null) args[key] = value;
  }
  const tab = query.get("tab");
  args.tab = tab === "tax" ? "tax" : tab && ["staff", "shop", "settings", "tools", "download"].includes(tab) ? "staff" : "overview";
  return args;
}
