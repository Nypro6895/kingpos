import type { KingUserStatus } from "@/types/user";

export const DENIED_KING_USER_STATUSES = ["suspended", "deleted"] as const;

export type DeniedKingUserStatus = (typeof DENIED_KING_USER_STATUSES)[number];

export function isDeniedKingUserStatus(
  status: KingUserStatus | string | null | undefined,
): status is DeniedKingUserStatus {
  return status === "suspended" || status === "deleted";
}
