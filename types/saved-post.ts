export const ACCOUNT_SAVED_POST_SOURCE_TYPES = [
  "beauty_post",
  "salon_profile_look",
  "salon_profile_update",
] as const;

export type AccountSavedPostSourceType =
  (typeof ACCOUNT_SAVED_POST_SOURCE_TYPES)[number];

export type AccountSavedPostFilter = "all" | AccountSavedPostSourceType;

export type AccountSavedPostTarget = {
  salonId?: string | null;
  sourceId: string;
  sourceType: AccountSavedPostSourceType;
};

export type AccountSavedPostStateTarget = AccountSavedPostTarget & {
  saveCount?: number;
  saved?: boolean;
};

export function savedPostKey(target: AccountSavedPostTarget) {
  return `${target.sourceType}:${target.sourceId}`;
}
