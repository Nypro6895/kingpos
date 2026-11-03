import { rewardInvitation, rewardNailIllustration } from "./reward-invitation";
import type { RewardDiscoverySalon, RewardEarningEligibility } from "./reward-discovery";

/** Prefer a new salon; annotate an existing business post instead of repeating its photo. */
export function rewardFeedCandidates(salons: RewardDiscoverySalon[], adjacentSalonIds: readonly string[] = [], hiddenSalonIds: readonly string[] = []) {
  const adjacent = new Set(adjacentSalonIds), hidden = new Set(hiddenSalonIds), seen = new Set<string>();
  const candidates = salons.filter(salon => {
    if (!salon?.id || hidden.has(salon.id) || seen.has(salon.id)) return false;
    seen.add(salon.id);
    return true;
  });
  return [...candidates.filter(salon => !adjacent.has(salon.id)), ...candidates.filter(salon => adjacent.has(salon.id))];
}

export function rewardFeedInvitation(salon: RewardDiscoverySalon, category = "", eligibility?: RewardEarningEligibility) {
  const invitation = rewardInvitation(salon, "all", eligibility);
  const recurring = salon.spendPoints > 0 && (eligibility?.spend ?? true) || salon.visitPoints > 0 && (eligibility?.visit ?? true);
  return { ...invitation, title: recurring
    ? `Your next ${rewardNailIllustration(salon, category) ? "nail day" : "visit"}. A little more rewarding.`
    : invitation.title };
}
