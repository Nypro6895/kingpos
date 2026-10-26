import type { KingUser } from "@/types/user";

export type HistoricalUserDisplayContext =
  | "customer"
  | "generic"
  | "owner"
  | "review"
  | "staff";

export type HistoricalUserDisplayInput = {
  context?: HistoricalUserDisplayContext;
  fallbackName?: string | null;
  user?: Pick<
    KingUser,
    "display_name" | "email" | "first_name" | "last_name" | "status"
  > | null;
};

const DELETED_USER_LABELS: Record<HistoricalUserDisplayContext, string> = {
  customer: "Deleted customer",
  generic: "Deleted user",
  owner: "Former owner",
  review: "Deleted user",
  staff: "Former staff member",
};

export function isDeletedUserLike(
  user:
    | Pick<KingUser, "display_name" | "email" | "status">
    | null
    | undefined,
) {
  return Boolean(user && user.status === "deleted");
}

export function getDeletedUserDisplayLabel(
  context: HistoricalUserDisplayContext = "generic",
) {
  return DELETED_USER_LABELS[context];
}

export function getHistoricalUserDisplayName(
  input: HistoricalUserDisplayInput = {},
) {
  const context = input.context ?? "generic";
  const fallbackName = input.fallbackName?.trim() ?? null;

  if (isDeletedUserLike(input.user)) {
    return getDeletedUserDisplayLabel(context);
  }

  if (fallbackName === "Deleted user" && !input.user) {
    return getDeletedUserDisplayLabel(context);
  }

  const fullName = [input.user?.first_name, input.user?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return (
    (input.user?.display_name?.trim() === "Deleted user" ? null : input.user?.display_name?.trim()) ||
    fullName ||
    (fallbackName === "Deleted user" ? null : fallbackName) ||
    ({ customer: "Reylumi customer", generic: "Reylumi user", owner: "Salon owner", review: "Reylumi customer", staff: "Staff member" } as const)[context]
  );
}
