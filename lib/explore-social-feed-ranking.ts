export type SocialFeedLane = "trending" | "new" | "personal" | "expanded";
export type SocialFeedCandidate = {
  contentKey: string;
  contentId: string;
  sourceType: "salon_profile_look" | "salon_profile_update" | "beauty_post" | "directory";
  salonId: string | null;
  publishedAt: string | null;
  lane: SocialFeedLane;
  scope: "local" | "wider";
  score?: number;
  /** Organic title/caption relevance; distinct from actual engagement score. */
  matchScore?: number;
};
export type SocialFeedPool = {
  asOf: string;
  region: Record<string, unknown>;
  seed: string;
  weights: Record<SocialFeedLane, number>;
  seenKeys: string[];
  lanes: Record<SocialFeedLane, SocialFeedCandidate[]>;
};
const LANES: SocialFeedLane[] = ["trending", "new", "personal", "expanded"];
const DEFAULT_WEIGHTS = { trending: .35, new: .30, personal: .20, expanded: .15 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function variation(value: string) {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619) >>> 0;
  return result;
}

/** Rank only the bounded regional pool. The resulting queue is persisted once. */
export function buildExploreSocialFeedQueue(pool: SocialFeedPool, intent: "discover" | "latest" = "discover", limit = 384, query = "") {
  const seen = new Set(pool.seenKeys);
  const selected: SocialFeedCandidate[] = [];
  const used = new Set<string>();
  const queues = Object.fromEntries(LANES.map(lane => [lane, (pool.lanes[lane] ?? []).filter(candidate =>
    UUID.test(candidate.contentId) && candidate.contentKey === `${candidate.sourceType}:${candidate.contentId}` &&
    (candidate.salonId === null || UUID.test(candidate.salonId)) &&
    (candidate.publishedAt === null || Number.isFinite(Date.parse(candidate.publishedAt))),
  )])) as Record<SocialFeedLane, SocialFeedCandidate[]>;
  queues.expanded.sort((a, b) => {
    const scopeDifference = Number(a.scope === "wider") - Number(b.scope === "wider");
    if (scopeDifference) return scopeDifference;
    if (a.sourceType !== "directory" || b.sourceType !== "directory") return Number(a.sourceType === "directory") - Number(b.sourceType === "directory");
    return variation(pool.seed + a.contentKey) - variation(pool.seed + b.contentKey) || a.contentKey.localeCompare(b.contentKey);
  });
  // Local posts precede wider posts and directory fillers. A second post from
  // the same salon must not lose its place to an unrelated directory listing.
  const priority = (candidate: SocialFeedCandidate) => (candidate.sourceType === "directory" ? 2 : 0) + Number(candidate.scope === "wider");
  queues.new.sort((a, b) => priority(a) - priority(b) || Date.parse(b.publishedAt ?? "1970-01-01") - Date.parse(a.publishedAt ?? "1970-01-01") || a.contentKey.localeCompare(b.contentKey));
  const target = Math.min(384, Math.max(1, Math.floor(limit)));
  let allowSeen = false;
  const counts = { trending: 0, new: 0, personal: 0, expanded: 0 };
  const weights = Object.fromEntries(LANES.map(lane => [lane, typeof pool.weights[lane] === "number" && Number.isFinite(pool.weights[lane]) && pool.weights[lane] >= 0 ? pool.weights[lane] : DEFAULT_WEIGHTS[lane]])) as Record<SocialFeedLane, number>;
  const enabled = LANES.filter(lane => weights[lane] > 0);
  if (query.trim() && intent !== "latest") {
    // Keyword relevance and the selected area take precedence over discovery
    // lane quotas, seen history and salon variety. Never discard matching posts.
    const matches = enabled.flatMap(lane => queues[lane]).sort((a, b) =>
      Number(a.scope === "wider") - Number(b.scope === "wider") ||
      Number(a.sourceType === "directory") - Number(b.sourceType === "directory") ||
      (b.matchScore ?? 0) - (a.matchScore ?? 0) ||
      Number(seen.has(a.contentKey)) - Number(seen.has(b.contentKey)) ||
      Date.parse(b.publishedAt ?? "1970-01-01") - Date.parse(a.publishedAt ?? "1970-01-01") ||
      a.contentKey.localeCompare(b.contentKey));
    return matches.filter(candidate => {
      if (used.has(candidate.contentKey)) return false;
      used.add(candidate.contentKey);
      return true;
    }).slice(0, target);
  }
  // Latest has one fixed total order, with cached timestamps. Re-sorting the
  // same bounded pool for every selected slot made this path CPU expensive.
  const latest = intent === "latest" ? enabled.flatMap(lane => queues[lane].map(candidate => ({ lane, candidate, time: Date.parse(candidate.publishedAt ?? "1970-01-01") }))).sort((a, b) =>
    Number(a.candidate.sourceType === "directory") - Number(b.candidate.sourceType === "directory") ||
    Number(a.candidate.scope === "wider") - Number(b.candidate.scope === "wider") ||
    b.time - a.time || a.candidate.contentKey.localeCompare(b.candidate.contentKey)) : [];
  while (selected.length < target) {
    const previousSalon = selected.at(-1)?.salonId;
    const eligible = (candidate: SocialFeedCandidate) => !used.has(candidate.contentKey) && (allowSeen || !seen.has(candidate.contentKey));
    let chosen: { lane: SocialFeedLane; candidate: SocialFeedCandidate } | undefined;
    if (intent === "latest") {
      const first = latest.find(({ candidate }) => eligible(candidate));
      // Explicit Latest preserves chronology; variety only resolves equal-time
      // ties in the same scope. For You applies variety across the whole pool.
      chosen = first && previousSalon === first.candidate.salonId ? latest.find(choice => eligible(choice.candidate) && choice.time === first.time && choice.candidate.scope === first.candidate.scope && choice.candidate.sourceType === first.candidate.sourceType && choice.candidate.salonId !== previousSalon) ?? first : first;
    } else {
      const available = enabled.flatMap(lane => queues[lane].filter(eligible));
      const bestPriority = Math.min(...available.map(priority));
      const inTier = (candidate: SocialFeedCandidate) => eligible(candidate) && priority(candidate) === bestPriority;
      const newest = selected.length === 0 && bestPriority < 2
        ? available.filter(inTier).sort((a,b) => Date.parse(b.publishedAt ?? "1970-01-01") - Date.parse(a.publishedAt ?? "1970-01-01"))[0] : undefined;
      const choices = enabled.flatMap(lane => {
        const first = queues[lane].find(inTier);
        if (!first) return [];
        const diverse = previousSalon ? queues[lane].find(candidate => inTier(candidate) && candidate.salonId !== previousSalon) : first;
        return [{ lane, candidate: diverse ?? first, diverse: Boolean(diverse) }];
      });
      const diverse = choices.filter(choice => choice.diverse);
      const active = diverse.length ? diverse : choices;
      const total = active.reduce((sum, choice) => sum + weights[choice.lane], 0);
      active.sort((a, b) => ((selected.length + 1) * weights[b.lane] / total - counts[b.lane]) - ((selected.length + 1) * weights[a.lane] / total - counts[a.lane]));
      chosen = newest ? { lane: enabled.find(lane => queues[lane].some(candidate => candidate.contentKey === newest.contentKey))!, candidate: newest } : active[0];
    }
    if (!chosen) {
      if (!allowSeen) { allowSeen = true; continue; }
      break;
    }
    used.add(chosen.candidate.contentKey);
    counts[chosen.lane] += 1;
    selected.push({ ...chosen.candidate, lane: chosen.lane });
  }
  return selected;
}
