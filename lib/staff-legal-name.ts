/** Legal identity comes only from the Staff profile, never its display name. */
export function getStaffLegalName(staff: {
  first_name?: string | null;
  last_name?: string | null;
} | null | undefined): string | null {
  const parts = [staff?.first_name, staff?.last_name]
    .map((part) => part?.trim().replace(/\s+/g, " ") ?? "")
    .filter(Boolean);
  return parts.join(" ") || null;
}

export type StaffLegalIdentity = {
  account_user_id?: string | null;
  user_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};
export type PersonalLegalIdentity = {
  id: string;
  auth_user_id?: string | null;
  first_name: string | null;
  last_name: string | null;
};
export function staffHasPersonalAccount(staff: StaffLegalIdentity) {
  return Boolean(staff.account_user_id || staff.user_id);
}
/** An explicit account link is authoritative; never guess from email or phone. */
export function withStaffPersonalLegalName<T extends StaffLegalIdentity>(staff: T, person: PersonalLegalIdentity | null | undefined): T {
  if (!staffHasPersonalAccount(staff)) return staff;
  const matches = person && (staff.account_user_id
    ? staff.account_user_id === person.id
    : staff.user_id === person.auth_user_id);
  return { ...staff, first_name: matches ? person.first_name : null, last_name: matches ? person.last_name : null };
}
/** Owner edits affect names only for a staff record without a personal account. */
export function staffLegalNameOwnerPatch(staff: StaffLegalIdentity, names: StaffLegalIdentity) {
  return staffHasPersonalAccount(staff) ? {} : {
    first_name: names.first_name?.trim() || null,
    last_name: names.last_name?.trim() || null,
  };
}
