export type MarketRegistryManifest = {
  manifestSchemaVersion: 1;
  appVersion: string;
  displayName: string;
  description: string;
  requestedCapabilities: [];
};

export type MarketRegistryDecision = "metadata_approved" | "rejected";
export type MarketRegistrySubmission = {
  id: string;
  app_id: string;
  draft_version: number;
  manifest: MarketRegistryManifest;
  manifest_hash: string;
  status: "submitted" | "metadata_approved" | "rejected" | "withdrawn";
  submitted_at: string;
  withdrawn_at?: string | null;
  review: {
    decision: MarketRegistryDecision;
    reason: string;
    reviewed_at: string;
  } | null;
};

export type MarketRegistryApp = {
  id: string;
  registry_key: string;
  draft_manifest: MarketRegistryManifest;
  draft_version: number;
  submissions: MarketRegistrySubmission[];
};
export type MarketRegistryWorkspace = {
  publisher: { id: string; name: string };
  apps: MarketRegistryApp[];
};
export type MarketRegistryReviewItem = MarketRegistrySubmission & {
  app_registry_key: string;
  publisher_name: string;
  previous_manifest: MarketRegistryManifest | null;
};
export type MarketRegistryQueue = { submissions: MarketRegistryReviewItem[] };
export type MarketRegistryLoad<T> =
  | { status: "ready"; data: T }
  | { status: "disabled" | "unauthorized" | "unavailable"; message: string };
export type MarketRegistryActionResult = { ok: boolean; message: string };
