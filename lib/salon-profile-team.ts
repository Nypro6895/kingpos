export const SALON_PROFILE_TEAM_PREVIEW_LIMIT = 3;

export type SalonProfileTeamMember = {
  displayName: string;
  id: string;
};

export type PublicSalonProfileTeamEligibility = {
  isActive: boolean;
  onlineBookingEnabled: boolean;
  salonProfileContentPostingEnabled: boolean;
};

export function isPublicSalonProfileTeamEligible(
  member: PublicSalonProfileTeamEligibility,
) {
  return (
    member.isActive &&
    (member.onlineBookingEnabled || member.salonProfileContentPostingEnabled)
  );
}

export function getPublicSalonProfileTeamMembers<
  T extends PublicSalonProfileTeamEligibility,
>(members: readonly T[]) {
  return members.filter(isPublicSalonProfileTeamEligible);
}

export function getSalonProfileTeamPreview<T extends SalonProfileTeamMember>(
  members: readonly T[],
  limit = SALON_PROFILE_TEAM_PREVIEW_LIMIT,
) {
  const previewLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.trunc(limit)
      : SALON_PROFILE_TEAM_PREVIEW_LIMIT;
  const previewMembers = members.slice(0, previewLimit);
  const hiddenMembers = members.slice(previewLimit);

  return {
    hasOverflow: hiddenMembers.length > 0,
    hiddenCount: hiddenMembers.length,
    hiddenMembers,
    previewMembers,
    totalCount: members.length,
  };
}

export function formatSalonProfileTeamCount(count: number) {
  return `${count} team member${count === 1 ? "" : "s"}`;
}

export function formatSalonProfileTeamOverflowLabel(
  members: readonly SalonProfileTeamMember[],
) {
  const names = members
    .map((member) => member.displayName.trim())
    .filter(Boolean);

  if (members.length === 0) {
    return "";
  }

  if (names.length === 0) {
    return `${members.length} more team member${members.length === 1 ? "" : "s"}`;
  }

  if (names.length === 1) {
    return members.length === 1
      ? names[0]
      : `${names[0]} +${members.length - 1} more`;
  }

  if (members.length === 2) {
    return `${names[0]}, ${names[1]}`;
  }

  return `${names[0]}, ${names[1]} +${members.length - 2} more`;
}
