export type LumiTrustLevel =
  | "empty"
  | "level_1"
  | "level_2"
  | "level_3"
  | "full";

/** Scoring knobs live here; evidence windows live in lumi_trust_evidence_policy(). */
export const LUMI_TRUST_RULES = {
  version: "lumi-trust-v2",
  feedbackWeight: 0.6,
  returnWeight: 0.4,
  wilsonZ: 1.645,
  returnBenchmark: 0.5,
  fullWeightSample: 20,
  silverScore: 0.55,
  goldScore: 0.75,
  diamondScore: 0.88,
  bothSamples: { silver: 5, gold: 20, diamond: 40 },
  singleSamples: { silver: 10, gold: 30 },
  negativeFeedback: { minimum: 5, goodRate: 0.72 },
  mixedFeedback: { minimum: 10, goodRate: 0.82 },
  diamondFeedbackFloor: 0.85,
} as const;

export type LumiTrustCanonicalEvidence = {
  ruleVersion: string;
  asOf: string;
  feedbackDays: number;
  returnDays: number;
  cohortDays: number;
  verifiedVisitCount: number;
  uniqueVisitorCount: number;
  feedbackCustomerCount: number;
  goodFeedbackCount: number;
  issueFeedbackCount: number;
  eligibleReturnCustomerCount: number;
  returningCustomerCount: number;
};

export type ReylumiTrustSignals = {
  trustEvidence?: LumiTrustCanonicalEvidence | null;
  averageRating: number | null;
  noIssueRate: number | null;
  sharedExperienceCount: number;
  uniqueCustomerCount: number;
  verifiedVisitCount: number;
};

export type ReylumiTrustSignalInput = {
  trustEvidence?: LumiTrustCanonicalEvidence | null;
  averageRating: number | null;
  experienceCount?: number | null;
  noIssueRate?: number | null;
  reputationNoIssueRate?: number | null;
  sharedExperienceCount?: number | null;
  uniqueCustomerCount?: number | null;
  verifiedVisitCount?: number | null;
};

export type ReylumiTrustMarkKind = LumiTrustLevel;

export type ReylumiTrustMark = {
  ariaLabel: string;
  detail: string;
  kind: ReylumiTrustMarkKind;
  label: string;
};

export type ReylumiTrustFactKind =
  | "customers"
  | "experience"
  | "issue_rate"
  | "rating"
  | "verified_visit"
  | "returning";

export type ReylumiTrustFact = {
  ariaLabel: string;
  kind: ReylumiTrustFactKind;
  label: string;
};

export type LumiTrustEvidenceKind =
  | "activity"
  | "confidence"
  | "recognition"
  | "reputation"
  | "verification"
  | "returning";

export type LumiTrustEvidenceRow = {
  ariaLabel: string;
  detail: string;
  kind: LumiTrustEvidenceKind;
  label: string;
  value: string | null;
};

export type LumiTrustEvidence = Partial<
  Record<LumiTrustEvidenceKind, LumiTrustEvidenceRow>
>;

export type ReylumiTrustSummary = {
  qualityScore: number | null;
  evidence: LumiTrustEvidence;
  evidenceRows: LumiTrustEvidenceRow[];
  facts: ReylumiTrustFact[];
  hasSufficientEvidence: boolean;
  label: string;
  level: LumiTrustLevel;
  mark: ReylumiTrustMark;
  primaryLine: string;
  secondaryLine: string | null;
};

export type ReylumiTrustContext = {
  isNew?: boolean;
  verifiedVisitState?: boolean;
};

export type ReylumiExploreSearchOrder =
  | "bookable"
  | "closest"
  | "relevance"
  | "trusted";

type TrustSortableSalon = ReylumiTrustSignalInput & {
  activeServiceCount: number;
  bookingEnabled: boolean;
  nextAvailabilityLabel: string | null;
  relevanceScore: number;
};

type TrustResolution = {
  qualityScore: number | null;
  confidenceScore: number;
  evidenceRows: LumiTrustEvidenceRow[];
  hasCanonicalEvidence: boolean;
  level: LumiTrustLevel;
  score: number;
};

const TRUST_LEVEL_WEIGHT: Record<LumiTrustLevel, number> = {
  empty: 0,
  level_1: 1,
  level_2: 2,
  level_3: 3,
  full: 4,
};

export function compactReylumiCount(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1000 ? 1 : 0,
    notation: value >= 1000 ? "compact" : "standard",
  }).format(value);
}

export function formatReylumiRating(value: number) {
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function reylumiExperienceCountLabel(count: number) {
  return `${compactReylumiCount(count)} Experience${count === 1 ? "" : "s"}`;
}

export function reylumiVerifiedVisitCountLabel(count: number) {
  return `${compactReylumiCount(count)} Verified Visit${count === 1 ? "" : "s"}`;
}

export function normalizeReylumiTrustSignals(
  input: ReylumiTrustSignalInput,
): ReylumiTrustSignals {
  return {
    trustEvidence: input.trustEvidence,
    averageRating: validRating(input.averageRating),
    noIssueRate: validRatio(input.noIssueRate ?? input.reputationNoIssueRate),
    sharedExperienceCount: normalizeCount(
      input.sharedExperienceCount ?? input.experienceCount,
    ),
    uniqueCustomerCount: normalizeCount(input.uniqueCustomerCount),
    verifiedVisitCount: normalizeCount(input.verifiedVisitCount),
  };
}

export function buildReylumiTrustFacts(
  input: ReylumiTrustSignalInput,
): ReylumiTrustFact[] {
  const signals = normalizeReylumiTrustSignals(input);
  const facts: ReylumiTrustFact[] = [];

  const e = canonicalEvidence(signals);
  const visits = e?.verifiedVisitCount ?? signals.verifiedVisitCount;
  if (visits > 0) facts.push({ kind: "verified_visit", label: reylumiVerifiedVisitCountLabel(visits), ariaLabel: reylumiVerifiedVisitCountLabel(visits) });
  if (e && e.feedbackCustomerCount > 0) {
    const label = `${e.feedbackCustomerCount} customer feedback · ${e.goodFeedbackCount} good · ${e.issueFeedbackCount} issues`;
    facts.push({ kind: "experience", label, ariaLabel: label });
  }
  if (e && e.eligibleReturnCustomerCount > 0) {
    const label = `${Math.round(e.returningCustomerCount / e.eligibleReturnCustomerCount * 100)}% returned within ${e.returnDays} days`;
    facts.push({ kind: "returning", label, ariaLabel: `${label}, based on ${e.eligibleReturnCustomerCount} eligible customers` });
  }

  return facts;
}

export function buildReylumiTrustSummary(
  input: ReylumiTrustSignalInput,
  context: ReylumiTrustContext = {},
): ReylumiTrustSummary {
  const signals = normalizeReylumiTrustSignals(input);
  const facts = buildReylumiTrustFacts(signals);
  const resolution = resolveLumiTrust(signals, context);
  const mark = input.trustEvidence === null
    ? { ...reylumiTrustMark(resolution.level), label: "Trust temporarily unavailable", detail: "Current LUMI Trust evidence could not be loaded. Missing data is not a negative result." }
    : reylumiTrustMark(resolution.level);
  const evidence = Object.fromEntries(
    resolution.evidenceRows.map((row) => [row.kind, row]),
  ) as LumiTrustEvidence;

  return {
    qualityScore: resolution.qualityScore,
    evidence,
    evidenceRows: resolution.evidenceRows,
    facts,
    hasSufficientEvidence: resolution.hasCanonicalEvidence,
    label: mark.label,
    level: resolution.level,
    mark,
    primaryLine: mark.label,
    secondaryLine: mark.detail,
  };
}

export function reylumiTrustScore(input: ReylumiTrustSignalInput) {
  const signals = normalizeReylumiTrustSignals(input);
  return resolveLumiTrust(signals).score;
}

export function compareReylumiTrustedSalons<T extends TrustSortableSalon>(
  left: T,
  right: T,
) {
  const trustDelta = reylumiTrustScore(right) - reylumiTrustScore(left);

  if (trustDelta !== 0) {
    return trustDelta;
  }

  return right.relevanceScore - left.relevanceScore;
}

export function compareReylumiTopRatedSalons<T extends TrustSortableSalon>(
  left: T,
  right: T,
) {
  const rightSignals = normalizeReylumiTrustSignals(right);
  const leftSignals = normalizeReylumiTrustSignals(left);
  const rightConfidence = Math.min(1, rightSignals.verifiedVisitCount / 80);
  const leftConfidence = Math.min(1, leftSignals.verifiedVisitCount / 80);
  const ratingDelta =
    (rightSignals.averageRating ?? -1) * (0.72 + rightConfidence * 0.28) -
    (leftSignals.averageRating ?? -1) * (0.72 + leftConfidence * 0.28);

  if (ratingDelta !== 0) {
    return ratingDelta;
  }

  const visitDelta =
    rightSignals.verifiedVisitCount - leftSignals.verifiedVisitCount;

  if (visitDelta !== 0) {
    return visitDelta;
  }

  const experienceDelta =
    rightSignals.sharedExperienceCount - leftSignals.sharedExperienceCount;

  if (experienceDelta !== 0) {
    return experienceDelta;
  }

  return right.activeServiceCount - left.activeServiceCount;
}

export function orderReylumiExploreResults<T extends TrustSortableSalon>(
  results: T[],
  mode: ReylumiExploreSearchOrder,
) {
  if (mode === "relevance") {
    return results;
  }

  return [...results].sort((left, right) => {
    if (mode === "trusted") {
      return compareReylumiTrustedSalons(left, right);
    }

    if (mode === "bookable") {
      const bookingDelta =
        Number(right.bookingEnabled) - Number(left.bookingEnabled);

      if (bookingDelta !== 0) {
        return bookingDelta;
      }

      const availabilityDelta =
        Number(Boolean(right.nextAvailabilityLabel)) -
        Number(Boolean(left.nextAvailabilityLabel));

      if (availabilityDelta !== 0) {
        return availabilityDelta;
      }
    }

    if (mode === "closest") {
      const leftDistance =
        "distanceMiles" in left && typeof left.distanceMiles === "number"
          ? left.distanceMiles
          : Number.POSITIVE_INFINITY;
      const rightDistance =
        "distanceMiles" in right && typeof right.distanceMiles === "number"
          ? right.distanceMiles
          : Number.POSITIVE_INFINITY;
      const distanceDelta = leftDistance - rightDistance;

      if (distanceDelta !== 0) {
        return distanceDelta;
      }
    }

    return right.relevanceScore - left.relevanceScore;
  });
}

function canonicalEvidence(signals: ReylumiTrustSignals) {
  const e = signals.trustEvidence;
  if (!e || e.ruleVersion !== LUMI_TRUST_RULES.version) return null;
  const counts = [e.verifiedVisitCount, e.uniqueVisitorCount, e.feedbackCustomerCount,
    e.goodFeedbackCount, e.issueFeedbackCount, e.eligibleReturnCustomerCount, e.returningCustomerCount];
  if (counts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    e.feedbackCustomerCount !== e.goodFeedbackCount + e.issueFeedbackCount ||
    e.feedbackCustomerCount > e.uniqueVisitorCount || e.uniqueVisitorCount > e.verifiedVisitCount ||
    e.returningCustomerCount > e.eligibleReturnCustomerCount ||
    e.eligibleReturnCustomerCount > e.verifiedVisitCount ||
    e.returnDays <= 0 || e.feedbackDays <= 0 || e.cohortDays <= 0) return null;
  return e;
}

/** One-sided 95% lower bound, used only on independent eligible customers. */
export function lumiTrustWilsonLower(successes: number, sample: number): number | null {
  if (!Number.isFinite(successes) || !Number.isFinite(sample) || sample <= 0 || successes < 0 || successes > sample) return null;
  const z = LUMI_TRUST_RULES.wilsonZ;
  const p = successes / sample;
  return clampScore((p + z * z / (2 * sample) - z * Math.sqrt(p * (1 - p) / sample + z * z / (4 * sample * sample))) / (1 + z * z / sample));
}

function resolveLumiTrust(signals: ReylumiTrustSignals, context: ReylumiTrustContext = {}): TrustResolution {
  const e = canonicalEvidence(signals);
  const hasCanonicalEvidence = signals.trustEvidence === null ? false :
    (e?.verifiedVisitCount ?? signals.verifiedVisitCount) > 0 ||
    (!e && (signals.sharedExperienceCount > 0 || signals.uniqueCustomerCount > 0 || context.verifiedVisitState === true));
  const feedback = e ? lumiTrustWilsonLower(e.goodFeedbackCount, e.feedbackCustomerCount) : null;
  const returning = e ? lumiTrustWilsonLower(e.returningCustomerCount, e.eligibleReturnCustomerCount) : null;
  const returnQuality = returning === null ? null : clampScore(returning / LUMI_TRUST_RULES.returnBenchmark);
  // Tiny newly available samples should not suddenly dominate a mature source.
  const feedbackWeight = feedback === null || !e ? 0 : LUMI_TRUST_RULES.feedbackWeight *
    clampScore(e.feedbackCustomerCount / LUMI_TRUST_RULES.fullWeightSample);
  const returnWeight = returnQuality === null || !e ? 0 : LUMI_TRUST_RULES.returnWeight *
    clampScore(e.eligibleReturnCustomerCount / LUMI_TRUST_RULES.fullWeightSample);
  const availableWeight = feedbackWeight + returnWeight;
  // Missing evidence is unknown, not a zero-quality vote or an invented positive vote.
  const qualityScore = availableWeight === 0 ? null :
    ((feedback ?? 0) * feedbackWeight + (returnQuality ?? 0) * returnWeight) / availableWeight;
  let level: LumiTrustLevel = hasCanonicalEvidence ? "level_1" : "empty";
  let confidenceScore = 0;
  if (e && qualityScore !== null && hasCanonicalEvidence) {
    const both = feedback !== null && returning !== null;
    const sample = both ? Math.min(e.feedbackCustomerCount, e.eligibleReturnCustomerCount) :
      feedback !== null ? e.feedbackCustomerCount : e.eligibleReturnCustomerCount;
    const strongestSample = Math.max(e.feedbackCustomerCount, e.eligibleReturnCustomerCount);
    confidenceScore = clampScore(strongestSample / LUMI_TRUST_RULES.bothSamples.diamond);
    const enoughSilver = (both && sample >= LUMI_TRUST_RULES.bothSamples.silver) ||
      strongestSample >= LUMI_TRUST_RULES.singleSamples.silver;
    const enoughGold = (both && sample >= LUMI_TRUST_RULES.bothSamples.gold) ||
      strongestSample >= LUMI_TRUST_RULES.singleSamples.gold;
    if (qualityScore >= LUMI_TRUST_RULES.silverScore && enoughSilver) level = "level_2";
    if (qualityScore >= LUMI_TRUST_RULES.goldScore && enoughGold) level = "level_3";
    if (both && qualityScore >= LUMI_TRUST_RULES.diamondScore &&
      sample >= LUMI_TRUST_RULES.bothSamples.diamond &&
      feedback! >= LUMI_TRUST_RULES.diamondFeedbackFloor) level = "full";
    const goodRate = e.feedbackCustomerCount > 0 ? e.goodFeedbackCount / e.feedbackCustomerCount : null;
    if (goodRate !== null && e.feedbackCustomerCount >= LUMI_TRUST_RULES.negativeFeedback.minimum &&
      goodRate < LUMI_TRUST_RULES.negativeFeedback.goodRate) level = "level_1";
    else if (goodRate !== null && e.feedbackCustomerCount >= LUMI_TRUST_RULES.mixedFeedback.minimum &&
      goodRate < LUMI_TRUST_RULES.mixedFeedback.goodRate && TRUST_LEVEL_WEIGHT[level] > 2) level = "level_2";
  }
  const evidenceRows: LumiTrustEvidenceRow[] = [];
  if (e) {
    evidenceRows.push({ kind: "verification", label: "Verified Visits", value: compactReylumiCount(e.verifiedVisitCount),
      ariaLabel: reylumiVerifiedVisitCountLabel(e.verifiedVisitCount),
      detail: "Recorded completed service visits linked to customer accounts; one visit per customer per salon day. This does not prove payment independently." });
    if (e.feedbackCustomerCount > 0) evidenceRows.push({ kind: "reputation", label: "Customer feedback",
      value: `${e.goodFeedbackCount} good · ${e.issueFeedbackCount} issues`,
      ariaLabel: `${e.feedbackCustomerCount} independent customer feedback`,
      detail: `Latest eligible feedback from ${e.feedbackCustomerCount} customers in ${e.feedbackDays} days. Unanswered visits are not positive feedback. Resolved issues remain issues.` });
    if (e.eligibleReturnCustomerCount > 0) evidenceRows.push({ kind: "returning", label: "Returning customers",
      value: `${Math.round(e.returningCustomerCount / e.eligibleReturnCustomerCount * 100)}% within ${e.returnDays} days`,
      ariaLabel: `${e.returningCustomerCount} of ${e.eligibleReturnCustomerCount} eligible customers returned`,
      detail: `${e.returningCustomerCount} of ${e.eligibleReturnCustomerCount} customers with a complete ${e.returnDays}-day observation. Returning does not erase negative feedback.` });
    else evidenceRows.push({ kind: "returning", label: "Returning customers", value: "Building evidence",
      ariaLabel: "Not enough return observation yet", detail: `Only customers with a full ${e.returnDays} days of observation enter the return rate.` });
    evidenceRows.push({ kind: "confidence", label: "Evidence confidence", value: confidenceLabel(confidenceScore),
      ariaLabel: confidenceLabel(confidenceScore), detail: "Confidence depends on independent customer samples, not total ticket volume. Diamond requires both feedback and return evidence." });
  } else if (hasCanonicalEvidence) {
    evidenceRows.push({ kind: "confidence", label: "Evidence confidence", value: "Building evidence",
      ariaLabel: "Quality and return evidence unavailable", detail: "Historical counts alone cannot establish Silver, Gold or Diamond. Current customer evidence is needed." });
  }
  // Sorting follows the resolved tier first. Large lifetime volume is not a quality bonus.
  const score = level === "empty" ? 0 : (TRUST_LEVEL_WEIGHT[level] + (qualityScore ?? 0) * 0.9) / 5;
  return { confidenceScore, qualityScore, evidenceRows, hasCanonicalEvidence, level, score };
}

function reylumiTrustMark(level: LumiTrustLevel): ReylumiTrustMark {
  const label = lumiTrustLevelLabel(level);
  const detail = lumiTrustLevelDetail(level);

  return {
    ariaLabel: `LUMI Trust: ${label}`,
    detail,
    kind: level,
    label,
  };
}

function lumiTrustLevelLabel(level: LumiTrustLevel) {
  switch (level) {
    case "full":
      return "Diamond";
    case "level_3":
      return "Gold";
    case "level_2":
      return "Silver";
    case "level_1":
      return "Common";
    case "empty":
      return "Building LUMI Trust";
  }
}

function lumiTrustLevelDetail(level: LumiTrustLevel) {
  switch (level) {
    case "full":
      return "ReyLUMI has broad, high-confidence trust evidence for this salon.";
    case "level_3":
      return "ReyLUMI has strong trust evidence for this salon.";
    case "level_2":
      return "ReyLUMI has developing trust evidence for this salon.";
    case "level_1":
      return "ReyLUMI has early trust evidence for this salon.";
    case "empty":
      return "ReyLUMI does not have enough evidence yet to show a stronger trust signal.";
  }
}

function confidenceLabel(value: number) {
  if (value <= 0) return "Building evidence";
  if (value >= 0.72) {
    return "High confidence";
  }

  if (value >= 0.38) {
    return "Moderate confidence";
  }

  return "Early confidence";
}

function clampScore(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function validRating(value: number | null | undefined) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 5
    ? value
    : null;
}

function validRatio(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}
