export type LumiTrustLevel =
  | "empty"
  | "level_1"
  | "level_2"
  | "level_3"
  | "full";

export type ReylumiTrustSignals = {
  averageRating: number | null;
  noIssueRate: number | null;
  sharedExperienceCount: number;
  uniqueCustomerCount: number;
  verifiedVisitCount: number;
};

export type ReylumiTrustSignalInput = {
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
  | "verified_visit";

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
  | "verification";

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

  if (signals.averageRating !== null && signals.sharedExperienceCount > 0) {
    const rating = formatReylumiRating(signals.averageRating);

    facts.push({
      ariaLabel: `Rated ${rating} out of 5 from ${reylumiExperienceCountLabel(
        signals.sharedExperienceCount,
      )}`,
      kind: "rating",
      label: `\u2605 ${rating}`,
    });
  }

  if (signals.sharedExperienceCount > 0) {
    facts.push({
      ariaLabel: reylumiExperienceCountLabel(signals.sharedExperienceCount),
      kind: "experience",
      label: reylumiExperienceCountLabel(signals.sharedExperienceCount),
    });
  }

  if (signals.verifiedVisitCount > 0) {
    facts.push({
      ariaLabel: reylumiVerifiedVisitCountLabel(signals.verifiedVisitCount),
      kind: "verified_visit",
      label: reylumiVerifiedVisitCountLabel(signals.verifiedVisitCount),
    });
  }

  if (signals.noIssueRate !== null && signals.verifiedVisitCount > 0) {
    facts.push({
      ariaLabel: `${Math.round(signals.noIssueRate * 100)} percent no issue reported`,
      kind: "issue_rate",
      label: `${Math.round(signals.noIssueRate * 100)}% no issue`,
    });
  }

  if (signals.uniqueCustomerCount > 0) {
    facts.push({
      ariaLabel: `${compactReylumiCount(signals.uniqueCustomerCount)} customers`,
      kind: "customers",
      label: `${compactReylumiCount(signals.uniqueCustomerCount)} customers`,
    });
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
  const mark = reylumiTrustMark(resolution.level);
  const evidence = Object.fromEntries(
    resolution.evidenceRows.map((row) => [row.kind, row]),
  ) as LumiTrustEvidence;

  return {
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

function resolveLumiTrust(
  signals: ReylumiTrustSignals,
  context: ReylumiTrustContext = {},
): TrustResolution {
  const contextualVerifiedVisits = context.verifiedVisitState ? 1 : 0;
  const verifiedEvidenceCount =
    signals.verifiedVisitCount + contextualVerifiedVisits;
  const hasReputation =
    signals.averageRating !== null && signals.sharedExperienceCount > 0;
  const hasIssueEvidence =
    signals.noIssueRate !== null && verifiedEvidenceCount > 0;
  const hasCanonicalEvidence =
    verifiedEvidenceCount > 0 ||
    signals.sharedExperienceCount > 0 ||
    signals.uniqueCustomerCount > 0;

  if (!hasCanonicalEvidence) {
    return {
      confidenceScore: 0,
      evidenceRows: [],
      hasCanonicalEvidence: false,
      level: "empty",
      score: 0,
    };
  }

  const verificationScore = normalizedCountScore(verifiedEvidenceCount, 120);
  const experienceScore = normalizedCountScore(signals.sharedExperienceCount, 80);
  const customerScore = normalizedCountScore(signals.uniqueCustomerCount, 60);
  const confidenceScore = clampScore(
    verificationScore * 0.46 + experienceScore * 0.34 + customerScore * 0.2,
  );
  const ratingQuality = hasReputation
    ? clampScore(((signals.averageRating ?? 0) - 1) / 4)
    : null;
  const issueQuality = hasIssueEvidence ? signals.noIssueRate : null;
  const qualitySignals = [ratingQuality, issueQuality].filter(
    (value): value is number => value !== null,
  );
  const qualityScore =
    qualitySignals.length > 0
      ? qualitySignals.reduce((sum, value) => sum + value, 0) /
        qualitySignals.length
      : 0.72;
  const reputationScore = hasReputation
    ? clampScore((ratingQuality ?? 0) * (0.55 + experienceScore * 0.45))
    : hasIssueEvidence
      ? clampScore((issueQuality ?? 0) * verificationScore)
      : 0;
  const activityScore = clampScore(
    verificationScore * 0.56 + experienceScore * 0.26 + customerScore * 0.18,
  );
  const evidenceBreadth = [
    verifiedEvidenceCount > 0,
    hasReputation || hasIssueEvidence,
    signals.sharedExperienceCount >= 6 || signals.uniqueCustomerCount >= 4,
    confidenceScore >= 0.2,
  ].filter(Boolean).length;
  const baseScore = clampScore(
    verificationScore * 0.3 +
      reputationScore * 0.28 +
      activityScore * 0.24 +
      confidenceScore * 0.18,
  );
  const score = clampScore(baseScore * (0.45 + qualityScore * 0.55));
  const negativeReputation =
    (signals.averageRating !== null &&
      signals.sharedExperienceCount >= 3 &&
      signals.averageRating < 3.2) ||
    (signals.noIssueRate !== null &&
      verifiedEvidenceCount >= 5 &&
      signals.noIssueRate < 0.72);
  const mixedReputation =
    (signals.averageRating !== null &&
      signals.sharedExperienceCount >= 6 &&
      signals.averageRating < 3.8) ||
    (signals.noIssueRate !== null &&
      verifiedEvidenceCount >= 10 &&
      signals.noIssueRate < 0.82);
  const observedSample = Math.max(
    verifiedEvidenceCount,
    signals.sharedExperienceCount,
    signals.uniqueCustomerCount,
  );
  let level = capTrustLevel(
    levelFromScore(score),
    maxLevelForEvidence({
      confidenceScore,
      evidenceBreadth,
      hasReputation,
      mixedReputation,
      negativeReputation,
      observedSample,
    }),
  );

  if (level === "empty") {
    level = "level_1";
  }

  const resolvedScore = negativeReputation
    ? Math.min(score, 0.12)
    : Math.min(score, scoreCeilingForLevel(level));

  return {
    confidenceScore,
    evidenceRows: buildLumiTrustEvidenceRows(signals, {
      confidenceScore,
      hasIssueEvidence,
      hasReputation,
      level,
      verifiedEvidenceCount,
      verifiedVisitState: context.verifiedVisitState === true,
    }),
    hasCanonicalEvidence: true,
    level,
    score: resolvedScore,
  };
}

function buildLumiTrustEvidenceRows(
  signals: ReylumiTrustSignals,
  input: {
    confidenceScore: number;
    hasIssueEvidence: boolean;
    hasReputation: boolean;
    level: LumiTrustLevel;
    verifiedEvidenceCount: number;
    verifiedVisitState: boolean;
  },
): LumiTrustEvidenceRow[] {
  const rows: LumiTrustEvidenceRow[] = [];

  if (signals.verifiedVisitCount > 0) {
    rows.push({
      ariaLabel: `${reylumiVerifiedVisitCountLabel(
        signals.verifiedVisitCount,
      )}. Visits confirmed through ReyLUMI activity.`,
      detail: "Visits confirmed through ReyLUMI activity",
      kind: "verification",
      label: "Verified Visits",
      value: compactReylumiCount(signals.verifiedVisitCount),
    });
  } else if (input.verifiedVisitState) {
    rows.push({
      ariaLabel: "This post is tied to a visit confirmed through ReyLUMI activity.",
      detail: "This post is tied to a visit confirmed through ReyLUMI activity",
      kind: "verification",
      label: "Verified Visit",
      value: null,
    });
  }

  if (input.hasReputation && signals.averageRating !== null) {
    const rating = formatReylumiRating(signals.averageRating);

    rows.push({
      ariaLabel: `Customer reputation ${rating} out of 5 from ${reylumiExperienceCountLabel(
        signals.sharedExperienceCount,
      )}.`,
      detail: `${reylumiExperienceCountLabel(
        signals.sharedExperienceCount,
      )} shared by customers`,
      kind: "reputation",
      label: "Customer Reputation",
      value: `\u2605 ${rating}`,
    });
  } else if (input.hasIssueEvidence && signals.noIssueRate !== null) {
    rows.push({
      ariaLabel: `${Math.round(signals.noIssueRate * 100)} percent no issue reported.`,
      detail: "Share of confirmed activity without a reported issue",
      kind: "reputation",
      label: "Customer Reputation",
      value: `${Math.round(signals.noIssueRate * 100)}% no issue`,
    });
  }

  if (
    signals.verifiedVisitCount >= 3 ||
    signals.sharedExperienceCount >= 3 ||
    signals.uniqueCustomerCount >= 3
  ) {
    rows.push({
      ariaLabel: `${activityLabel(input.verifiedEvidenceCount)} based on available ReyLUMI activity.`,
      detail: "Based on available ReyLUMI activity history",
      kind: "activity",
      label: "Activity",
      value: activityLabel(input.verifiedEvidenceCount),
    });
  }

  if (input.confidenceScore >= 0.12) {
    rows.push({
      ariaLabel: `${confidenceLabel(
        input.confidenceScore,
      )} based on the available evidence sample.`,
      detail: "Based on the available evidence sample",
      kind: "confidence",
      label: "Confidence",
      value: confidenceLabel(input.confidenceScore),
    });
  }

  return rows;
}

function maxLevelForEvidence(input: {
  confidenceScore: number;
  evidenceBreadth: number;
  hasReputation: boolean;
  mixedReputation: boolean;
  negativeReputation: boolean;
  observedSample: number;
}): LumiTrustLevel {
  if (input.negativeReputation) {
    return "level_1";
  }

  if (input.observedSample < 3 || input.confidenceScore < 0.08) {
    return "level_1";
  }

  if (input.mixedReputation) {
    return "level_2";
  }

  if (input.observedSample < 10 || input.confidenceScore < 0.22) {
    return "level_2";
  }

  if (
    input.observedSample < 35 ||
    input.confidenceScore < 0.48 ||
    input.evidenceBreadth < 3 ||
    !input.hasReputation
  ) {
    return "level_3";
  }

  return "full";
}

function levelFromScore(score: number): LumiTrustLevel {
  if (score <= 0) {
    return "empty";
  }

  if (score < 0.18) {
    return "level_1";
  }

  if (score < 0.38) {
    return "level_2";
  }

  if (score < 0.66) {
    return "level_3";
  }

  return "full";
}

function scoreCeilingForLevel(level: LumiTrustLevel) {
  switch (level) {
    case "full":
      return 1;
    case "level_3":
      return 0.66;
    case "level_2":
      return 0.38;
    case "level_1":
      return 0.18;
    case "empty":
      return 0;
  }
}

function capTrustLevel(level: LumiTrustLevel, maxLevel: LumiTrustLevel) {
  return TRUST_LEVEL_WEIGHT[level] <= TRUST_LEVEL_WEIGHT[maxLevel]
    ? level
    : maxLevel;
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
      return "High trust confidence";
    case "level_3":
      return "Strong trust evidence";
    case "level_2":
      return "Developing trust evidence";
    case "level_1":
      return "Early trust evidence";
    case "empty":
      return "Building trust";
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

function activityLabel(verifiedEvidenceCount: number) {
  if (verifiedEvidenceCount >= 80) {
    return "Established activity";
  }

  if (verifiedEvidenceCount >= 12) {
    return "Growing activity";
  }

  return "Early activity";
}

function confidenceLabel(value: number) {
  if (value >= 0.72) {
    return "High confidence";
  }

  if (value >= 0.38) {
    return "Moderate confidence";
  }

  return "Early confidence";
}

function normalizedCountScore(value: number, saturationPoint: number) {
  return clampScore(value / saturationPoint);
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
