import type { CampaignDay, OwnerCampaign } from "@/types/owner-campaign";

/** Existing campaign counters are cumulative; these are never period forecasts. */
export function campaignLifetimeCosts(c: Pick<OwnerCampaign,"views"|"bookings"|"spent_cents">) {
  return { perView: c.views > 0 ? c.spent_cents / c.views : null,
    perBookedCustomer: c.bookings > 0 ? c.spent_cents / c.bookings : null };
}

/** Chicago reporting day, explicit end-exclusive bins including today's events. */
export function campaignDaySeries(rows: CampaignDay[], days: number, today: string) {
  const end = new Date(`${today}T12:00:00Z`);
  const bins = Math.min(days,7), series: (CampaignDay & { until: string })[] = [];
  for (let i=0;i<bins;i++) {
    const fromDate = new Date(end), untilDate = new Date(end);
    fromDate.setUTCDate(end.getUTCDate()-days+1+Math.floor(i*days/bins));
    untilDate.setUTCDate(end.getUTCDate()-days+1+Math.floor((i+1)*days/bins));
    const day=fromDate.toISOString().slice(0,10), until=untilDate.toISOString().slice(0,10);
    const group=rows.filter(r=>r.day>=day&&r.day<until);
    const sum=(key: keyof Omit<CampaignDay,"day">)=>group.reduce((n,r)=>n+r[key],0);
    series.push({day,until,views:sum("views"),clicks:sum("clicks"),likes:sum("likes"),comments:sum("comments"),bookings:sum("bookings")});
  }
  return series;
}

export function campaignDeliveryExplanation(reason: string) {
  const messages: Record<string,string> = {
    credits_needed:"This ad has not started. Reserve enough credits to continue; a new ad still needs review.",
    in_review:"Credits are reserved. This ad will not be shown until it is approved. Its advertising period starts after approval.",
    rejected:"This ad is not approved. Review the decision below. Unused campaign credits return to your salon balance.",
    cancelled:"This ad has ended. Unused campaign credits return to your salon balance, not automatically to your card.",
    owner_paused:"You paused this ad. It is not being shown. Resume or cancel it from campaign settings.",
    completed:"This run has finished. These are its recorded results; run it again to advertise for another period.",
    platform_disabled:"Advertising is temporarily disabled by the platform. Adding credits will not restart delivery.",
    plugin_disabled:"Campaigns is not active for this salon. Review its installation in Market.",
    source_unavailable:"The promoted content is no longer eligible. Check its publication and review status before resuming.",
    owner_unavailable:"The campaign's owner no longer has the required salon access. Contact support to review this campaign.",
    paused:"This ad is paused. Check its content and settings before resuming.",
    period_ended:"This period has ended and is waiting for settlement or renewal. It is not currently being shown.",
    limit_reached:"This run reached its view or credit limit. Adding credits does not increase this run's limit.",
    scheduled:"This ad is scheduled and has not reached its start time.",
    not_ready:"This ad is not ready for delivery. Refresh its status or contact support.",
    eligible:"This ad can enter delivery selection. Views depend on matching visitors, search relevance and frequency limits; delivery is not guaranteed.",
  };
  return messages[reason] ?? "Delivery status is unavailable. Refresh or contact support.";
}
