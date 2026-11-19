export type ExactTextModerationKind = "comment" | "review" | "experience" | "review_reply" | "experience_reply";
export type ExactTextModerationDecision = {
  id: string;
  action: "hide" | "restore";
  reason: string;
  actorName: string | null;
  createdAt: string;
  revision: number;
};
export type ExactTextModerationState = {
  status: "available" | "unavailable";
  kind: ExactTextModerationKind | null;
  contentId: string | null;
  parentId: string | null;
  salonId: string | null;
  body: string | null;
  evidenceVersion: string | null;
  revision: number;
  moderationStatus: "visible" | "hidden" | "unavailable";
  canHide: boolean;
  canRestore: boolean;
  blockedReason: string | null;
  /** false only for a transport/schema fallback; a verified unavailable result must not reuse an older quote. */
  availabilityVerified?: boolean;
  heldByThisCase?: boolean;
  otherHoldCount?: number;
  history: ExactTextModerationDecision[];
};
export type ExactTextVisibilityInput = {
  reportId: string;
  requestId: string;
  expectedVersion: string;
  action: "hide" | "restore";
  reason: string;
};
export type ExactTextVisibilityResult =
  | { ok: true; state: ExactTextModerationState }
  | { ok: false; code: "stale" | "unavailable" | "permission" | "conflict" | "unknown"; message: string; state?: ExactTextModerationState };
