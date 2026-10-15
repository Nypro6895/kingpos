import type { PostCommentTarget } from "./post-comments";

export type CampaignArea = "city" | "neighborhood" | "zipcode" | "state" | "country";
export type OwnerCampaignSettings = {
  enabled: boolean;
  promptsEnabled: boolean;
  dailyPriceCents: number;
  viewsPerDollar: number;
  maxDays: number;
  maxCampaigns: number;
  promptCooldownHours: number;
  dailyFrequency: number;
  maxDailyViews: number;
  maxAdsPerDay: number;
  exampleLikesPerThousand: number;
  exampleCommentsPerThousand: number;
  exampleBookingsPerThousand: number;
  welcomeCredits: number;
  neighborhoodPricePercent: number;
  zipcodePricePercent: number;
  cityPricePercent: number;
  statePricePercent: number;
  countryPricePercent: number;
};
export const DEFAULT_OWNER_CAMPAIGN_SETTINGS: OwnerCampaignSettings = {
  enabled: true, promptsEnabled: true, dailyPriceCents: 100,
  viewsPerDollar: 500, maxDays: 30, maxCampaigns: 5,
  promptCooldownHours: 24, dailyFrequency: 2, maxDailyViews: 10000,
  maxAdsPerDay: 6, exampleLikesPerThousand: 69,
  exampleCommentsPerThousand: 10, exampleBookingsPerThousand: 3,
  welcomeCredits: 300, neighborhoodPricePercent: 80, zipcodePricePercent: 80,
  cityPricePercent: 100, statePricePercent: 150, countryPricePercent: 200,
};
export type OwnerCampaign = {
  id: string; salon_id: string; source_type: PostCommentTarget["sourceType"] | "custom";
  source_id: string; title: string; area: CampaignArea; location: string;
  country: string; state: string; city: string; days: number; daily_views: number;
  daily_price_cents: number; total_price_cents: number;
  status: "awaiting_payment" | "pending_review" | "running" | "paused" | "cancelled" | "completed" | "rejected";
  views: number; clicks: number; likes: number; comments: number; bookings: number;
  spent_cents: number; created_at: string; starts_at: string | null; ends_at: string | null;
  reserved_credits?: number; released_credits?: number; keep_running?: boolean;
};
export type CampaignPrompt = { id: string; target: PostCommentTarget };
export type CampaignCreativeTarget = Omit<PostCommentTarget, "sourceType"> & { sourceType: PostCommentTarget["sourceType"] | "custom" };
export type CampaignWallet = { available_credits: number; reserved_credits: number; welcome_credits: number; installed: boolean; auto_topup_enabled: boolean; topup_credits: number; threshold_credits: number; monthly_limit_cents: number; payment_ready: boolean; has_payment_method: boolean };
