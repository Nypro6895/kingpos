export const AD_REPORT_REASONS = ["scam", "sexual", "violence", "age_inappropriate", "intellectual_property", "other"] as const;
export type AdReportReason = (typeof AD_REPORT_REASONS)[number];
export type AdKind = "owner_campaign" | "platform_campaign";
export type AdReportTarget = {
  kind: AdKind;
  campaignId: string;
  sourceType: "custom" | "beauty_post" | "salon_profile_look" | "salon_profile_update" | "explore_campaign";
  sourceId: string;
  salonId: string | null;
};
export type AdPublicSnapshot = {
  advertiserName: string;
  title: string;
  caption: string;
  mediaBucket: "campaign-creatives" | "beauty-profile-media" | "salon-profile-media" | null;
  mediaPath: string | null;
  destinationPath: string | null;
  selectedAt: string;
};
/** Only this redacted subset may be persisted to a private report/support case. */
export type AdReportSummary = {
  locationSource: "gps" | "manual" | "search" | "none";
  areaLabel: string | null;
  searchKind: "service" | "style" | "name" | null;
  searchCategory: string | null;
  page: string;
  device: "mobile" | "desktop" | null;
  audience: "guest" | "personal" | "staff" | "owner" | null;
  selectionRuleCodes: string[];
  selectedAt: string;
};
export type AdSelectionDetail = { label: string; value: string };
export type AdSelectionDisclosure = {
  kind: AdKind;
  selectionId: string;
  selectedAt: string;
  advertiserName: string;
  primaryReasons: [string, string];
  details: AdSelectionDetail[];
  /** Opaque, purpose-separated actor scope; never an advertising visitor hash. */
  reportScope: string;
  /** Actor-bound encrypted proof: body only, never a URL, visible UI or log. */
  proof: string;
};
export type AdDisclosureProofPayload = {
  version: 1;
  selectionId: string;
  issuedAt: number;
  expiresAt: number;
  target: AdReportTarget;
  snapshot: AdPublicSnapshot;
  summary: AdReportSummary;
  /** Own selection details may contain GPS/query; never persist this to a case. */
  disclosure: {
    advertiserName: string;
    primaryReasons: [string, string];
    details: AdSelectionDetail[];
  };
};
export type AdDisclosureActor = { kind: "user" | "guest"; id: string };
export type AdReportSubmission = {
  requestId: string;
  kind: AdKind;
  proof: string;
  reason: AdReportReason;
  details: string;
};
export type AdReportReceipt = {
  reportId: string;
  reference: string;
  guestThreadId: string | null;
};
export type AdminAdReportEvidence = {
  target: AdReportTarget;
  snapshot: AdPublicSnapshot;
  summary: AdReportSummary;
  reason: AdReportReason;
  details: string;
  reviewHref: "/admin/plugins/campaigns" | "/admin/advertising";
};
export type AdAdmissionTrace = {
  version: 1;
  admittedAt: string;
  limits: {maxTotal:number;maxPopups:number;minPopupGapSeconds:number;sessionMinutes:number};
  session: {viewsBefore:number;reservationsBefore:number;totalBefore:number;sameCampaignViewed:false};
  popup: {applicable:boolean;viewsBefore:number|null;reservationsBefore:number|null;totalBefore:number|null;priorPopupAt:string|null;gapSatisfied:true|null};
  repeat: {rule:"always"|"once"|"daily";checked:boolean;eligible:true;historyScope:"visitor_key_may_be_shared_network";timeZone:"America/Chicago"};
};
