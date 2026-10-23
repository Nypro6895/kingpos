export type SalonReportTarget = { id: string; name: string };

export const SALON_REPORT_REASONS = [
  ["incorrect_information", "Incorrect salon information"],
  ["closed", "Salon is closed or does not exist"],
  ["duplicate", "Duplicate salon profile"],
  ["scam", "Scam, fraud or impersonation"],
  ["inappropriate", "Inappropriate or harmful content"],
  ["other", "Other problem"],
] as const;

export type SalonReportReason = (typeof SALON_REPORT_REASONS)[number][0];
