/** Internal server/RPC receipt. Never serialize Storage pointers to a reporter or guest. */
export type RightsImageEvidenceRow = {
  id: string;
  case_id: string;
  stage: "capture" | "remove_origin" | "purge" | "read";
  source_bucket: "beauty-profile-media" | "salon-profile-media";
  source_path: string;
  source_object_id: string;
  source_version: string;
  source_etag: string;
  sha256: string;
  bytes: number;
  mime: "image/webp";
  evidence_bucket: "rights-review-evidence";
  evidence_path: string;
  private_object_id: string | null;
  private_version: string | null;
  private_etag: string | null;
  lease_token: string | null;
  leased_until: string | null;
  /** NULL while open/reopened or explicitly held. Only SQL computes the closed-case deadline. */
  retain_until: string | null;
};

export type RightsImageEvidenceSafety = "unknown" | "ordinary" | "suspected_csam" | "known_csam";

export type RightsImageEvidenceState = {
  id: string;
  caseId: string;
  status: string;
  version: string;
  captured: boolean;
  originRemoved: boolean;
  safetyClassification: RightsImageEvidenceSafety;
  retainUntil: string | null;
  hasLegalHold: boolean;
  legalHoldReviewAt: string | null;
  canRequestRemoval: boolean;
  removalBlockedReason: "permission" | "unavailable" | "policy_or_safety" | "capture_required" | "erasure_owned" | "shared_references" | "already_requested" | null;
};
