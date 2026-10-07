import "server-only";
import type { LumiTrustCanonicalEvidence } from "@/lib/reylumi-trust";
import { LUMI_TRUST_RULES } from "@/lib/reylumi-trust";

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

/** A failed/version-mismatched RPC remains unknown, never an invented zero rate. */
export async function getLumiTrustEvidenceBySalonId(rpc: Rpc, salonIds: string[]) {
  const ids = [...new Set(salonIds.map((id) => id.trim()).filter(Boolean))];
  const result = new Map<string, LumiTrustCanonicalEvidence>();
  if (ids.length === 0) return result;
  const { data, error } = await rpc("get_public_lumi_trust_signals", { target_salon_ids: ids });
  if (error || !Array.isArray(data)) {
    console.warn("LUMI Trust evidence unavailable");
    return result;
  }
  const fields = {
    feedbackDays: "feedback_days", returnDays: "return_days", cohortDays: "cohort_days",
    verifiedVisitCount: "verified_visit_count", uniqueVisitorCount: "unique_visitor_count",
    feedbackCustomerCount: "feedback_customer_count", goodFeedbackCount: "good_feedback_count",
    issueFeedbackCount: "issue_feedback_count", eligibleReturnCustomerCount: "eligible_return_customer_count",
    returningCustomerCount: "returning_customer_count",
  } as const;
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.rule_version !== LUMI_TRUST_RULES.version || typeof row.salon_id !== "string" ||
      !ids.includes(row.salon_id) || typeof row.as_of !== "string" || !Number.isFinite(Date.parse(row.as_of))) continue;
    const values = Object.fromEntries(Object.entries(fields).map(([key, column]) => [key,
      row[column] === null || row[column] === undefined || row[column] === "" ? NaN : Number(row[column])]));
    if (Object.values(values).some((n) => !Number.isSafeInteger(n) || n < 0)) continue;
    const evidence = { ...values, ruleVersion: row.rule_version, asOf: row.as_of } as LumiTrustCanonicalEvidence;
    if (evidence.feedbackDays <= 0 || evidence.returnDays <= 0 || evidence.cohortDays <= 0 ||
      evidence.goodFeedbackCount + evidence.issueFeedbackCount !== evidence.feedbackCustomerCount ||
      evidence.returningCustomerCount > evidence.eligibleReturnCustomerCount ||
      evidence.eligibleReturnCustomerCount > evidence.verifiedVisitCount ||
      evidence.feedbackCustomerCount > evidence.uniqueVisitorCount || evidence.uniqueVisitorCount > evidence.verifiedVisitCount) continue;
    result.set(row.salon_id, evidence);
  }
  return result;
}
