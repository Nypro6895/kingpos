export const RETENTION_CATEGORIES = [
  "PERSONAL_PROFILE",
  "AUTH_IDENTITY",
  "BUSINESS_OPERATIONAL_HISTORY",
  "PAYROLL",
  "TAX",
  "AUDIT",
  "REVIEWS_CONTENT",
  "CUSTOMER_TRANSACTION_HISTORY",
  "EXPORT_ARCHIVES",
  "RECOVERY_METADATA",
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

export type RetentionTreatment =
  | "delete"
  | "anonymize"
  | "disconnect"
  | "retain"
  | "retain_minimal";

export type RetentionDecision = {
  category: RetentionCategory;
  exportableByOwner: boolean;
  treatment: RetentionTreatment;
  summary: string;
};

export const ACCOUNT_DELETION_RETENTION_POLICY: Record<
  RetentionCategory,
  RetentionDecision
> = {
  PERSONAL_PROFILE: {
    category: "PERSONAL_PROFILE",
    exportableByOwner: true,
    summary:
      "Public and account profile fields are cleared or replaced with a neutral deleted-user label.",
    treatment: "anonymize",
  },
  AUTH_IDENTITY: {
    category: "AUTH_IDENTITY",
    exportableByOwner: false,
    summary:
      "The Supabase auth id is disconnected from the public user row and tombstoned to prevent profile recreation.",
    treatment: "disconnect",
  },
  BUSINESS_OPERATIONAL_HISTORY: {
    category: "BUSINESS_OPERATIONAL_HISTORY",
    exportableByOwner: true,
    summary:
      "Bookings, POS, daily logs, lifecycle events, and operational snapshots remain structurally valid.",
    treatment: "retain",
  },
  PAYROLL: {
    category: "PAYROLL",
    exportableByOwner: true,
    summary:
      "Payroll run and staff earning history is retained for business accounting and compliance review.",
    treatment: "retain",
  },
  TAX: {
    category: "TAX",
    exportableByOwner: true,
    summary:
      "Tax-company snapshots and retained accounting fields are not anonymized by the personal deletion job.",
    treatment: "retain",
  },
  AUDIT: {
    category: "AUDIT",
    exportableByOwner: true,
    summary:
      "Lifecycle and account audit events retain stable internal subject references with minimized personal fields.",
    treatment: "retain_minimal",
  },
  REVIEWS_CONTENT: {
    category: "REVIEWS_CONTENT",
    exportableByOwner: true,
    summary:
      "Reviews and comments remain attached to the retained subject row while profile display falls back to Deleted user.",
    treatment: "retain_minimal",
  },
  CUSTOMER_TRANSACTION_HISTORY: {
    category: "CUSTOMER_TRANSACTION_HISTORY",
    exportableByOwner: true,
    summary:
      "Customer transactions stay with the salon history; personal favorites/follows are removed.",
    treatment: "retain",
  },
  EXPORT_ARCHIVES: {
    category: "EXPORT_ARCHIVES",
    exportableByOwner: true,
    summary:
      "Generated exports are private, requester-scoped, and expire by policy instead of using public permanent URLs.",
    treatment: "retain_minimal",
  },
  RECOVERY_METADATA: {
    category: "RECOVERY_METADATA",
    exportableByOwner: false,
    summary:
      "Only minimal internal ids, timestamps, recovery actor, claimant, and reason metadata are retained.",
    treatment: "retain_minimal",
  },
};

export const ACCOUNT_DELETION_ANONYMIZED_PROFILE = {
  avatar_url: null,
  display_name: "Deleted user",
  email: null,
  first_name: null,
  last_name: null,
  phone: null,
} as const;

export function getRetentionDecision(category: RetentionCategory) {
  return ACCOUNT_DELETION_RETENTION_POLICY[category];
}

export function listAccountDeletionRetentionPolicy() {
  return RETENTION_CATEGORIES.map((category) => getRetentionDecision(category));
}
