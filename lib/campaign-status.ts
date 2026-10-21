import type { OwnerCampaign } from "@/types/owner-campaign";

type CampaignState = Pick<OwnerCampaign,"status"|"starts_at"|"ends_at"|"owner_paused_at"|"pause_episode_id">;
const labels: Record<OwnerCampaign["status"],string> = {awaiting_payment:"Credits needed",pending_review:"In review",running:"Running",paused:"Paused",cancelled:"Cancelled",completed:"Finished",rejected:"Not approved"};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Presentation only. Schedule/owner intent never changes persisted accounting. */
export function campaignStatus(c: CampaignState, now = Date.now()) {
  const ended = Boolean(c.ends_at && Date.parse(c.ends_at) <= now);
  const ownerPaused = Boolean(c.owner_paused_at) && ["running","paused","completed"].includes(c.status);
  const awaitingReconciliation = ended && !ownerPaused && ["running","paused"].includes(c.status);
  // Only legacy periods already settled before reserve-hold need new funding.
  const resumeNewPeriod = ownerPaused && c.status === "completed";
  let label = labels[c.status];
  if (ownerPaused && resumeNewPeriod) label = awaitingReconciliation ? "Paused · period ended — awaiting reconciliation" : "Paused · period ended";
  else if (ownerPaused) label = "Paused";
  else if (awaitingReconciliation) label = "Period ended — awaiting reconciliation";
  else if (c.status === "running" && c.starts_at && Date.parse(c.starts_at) > now) label = "Scheduled";
  const canResume = ownerPaused
    ? typeof c.pause_episode_id === "string" && uuid.test(c.pause_episode_id)
    : c.status === "paused" && Boolean(c.ends_at && Date.parse(c.ends_at) > now);
  const canPause = c.status === "running" && !ownerPaused && !ended;
  return {label,ended,ownerPaused,awaitingReconciliation,resumeNewPeriod,canResume,canPause};
}

export function campaignIsActive(c: Pick<OwnerCampaign,"status"|"owner_paused_at">) {
  return ["awaiting_payment","pending_review","running","paused"].includes(c.status) || (c.status === "completed" && Boolean(c.owner_paused_at));
}
