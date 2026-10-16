export type StaffOfflineBinding = {
  version: 1; staffId: string; viewerId: string; salonId: string;
  revision: string; approvedAt: string;
};
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
/** Shape validation is never authority: accept only a freshly validated grant. */
export function isTrustedStaffOfflineBinding(value: unknown, expected: { staffId?: string; viewerId?: string; salonId?: string } = {}): value is StaffOfflineBinding {
  if (!value || typeof value !== "object") return false;
  const item = value as StaffOfflineBinding & { revoked?: boolean };
  return item.version === 1 && item.revoked !== true && uuid(item.staffId) && uuid(item.viewerId) && uuid(item.salonId) && uuid(item.revision)
    && typeof item.approvedAt === "string" && Number.isFinite(Date.parse(item.approvedAt)) && Date.parse(item.approvedAt) <= Date.now() + 60000
    && (!expected.staffId || expected.staffId === item.staffId) && (!expected.viewerId || expected.viewerId === item.viewerId) && (!expected.salonId || expected.salonId === item.salonId);
}
