/** Only these filters change the Staff DTO. The original URL continues to
 * control directory filters, form/drawer state and action notices locally. */
const keys = new Set(["staff", "invite_email", "invite_phone"]);

export function ownerStaffReadArgsFromRecord(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([key]) => keys.has(key)));
}

export function ownerStaffReadArgs(path: string): Record<string, string> {
  return ownerStaffReadArgsFromRecord(Object.fromEntries(new URL(path, "https://reylumi.com").searchParams)) as Record<string, string>;
}
