import { getHistoricalUserDisplayName } from "@/lib/deleted-user-display";
// A comment's chosen persona is independent from the post's author role.
export function commentDisplayName(input: { authorName?: string | null; isSalonReply?: boolean; salonName?: string | null }) {
  if (input.isSalonReply) return input.salonName?.trim() || "Salon";
  return getHistoricalUserDisplayName({ context: "review", fallbackName: input.authorName });
}
