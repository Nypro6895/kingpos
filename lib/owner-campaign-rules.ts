import { DEFAULT_OWNER_CAMPAIGN_SETTINGS, type OwnerCampaignSettings, type CampaignArea } from "@/types/owner-campaign";

export function normalizeOwnerCampaignSettings(raw: Partial<OwnerCampaignSettings> = {}): OwnerCampaignSettings {
  const defaults = DEFAULT_OWNER_CAMPAIGN_SETTINGS;
  const result = { ...defaults };
  for (const key of ["enabled", "promptsEnabled"] as const) result[key] = typeof raw[key] === "boolean" ? raw[key]! : defaults[key];
  for (const [key, min, max] of [
    ["dailyPriceCents", 100, 100000], ["viewsPerDollar", 1, 10000],
    ["maxDays", 1, 90], ["maxCampaigns", 1, 20], ["promptCooldownHours", 1, 168],
    ["dailyFrequency", 1, 5], ["maxDailyViews", 100, 100000],
    ["maxAdsPerDay", 1, 30], ["exampleLikesPerThousand", 0, 1000],
    ["exampleCommentsPerThousand", 0, 1000], ["exampleBookingsPerThousand", 0, 1000],
    ["welcomeCredits", 0, 100000], ["neighborhoodPricePercent", 10, 1000],
    ["zipcodePricePercent", 10, 1000], ["cityPricePercent", 10, 1000],
    ["statePricePercent", 10, 1000], ["countryPricePercent", 10, 1000],
  ] as const) {
    const value = raw[key];
    result[key] = typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : defaults[key];
  }
  return result;
}
export function campaignQuote(settings: OwnerCampaignSettings, dailyViews: number, days: number, area: CampaignArea = "city") {
  if (!Number.isInteger(days) || days < 1 || days > settings.maxDays) throw new Error(`Choose 1–${settings.maxDays} days.`);
  if (!Number.isInteger(dailyViews) || dailyViews < 100 || dailyViews > settings.maxDailyViews) throw new Error(`Choose 100–${settings.maxDailyViews.toLocaleString()} views per day.`);
  const percent = settings[`${area}PricePercent`];
  const dailyCents = Math.ceil(Math.max(settings.dailyPriceCents, Math.ceil(dailyViews * 100 / settings.viewsPerDollar)) * percent / 100);
  return { dailyCents, totalCents: dailyCents * days };
}
export function validateCampaignLocation(area: CampaignArea, location: string, country: string, state: string, city: string) {
  if (!["city", "neighborhood", "zipcode", "state", "country"].includes(area)) throw new Error("Choose an area.");
  if (!location.trim() || location.trim().length > 120 || !country.trim() || country.trim().length > 80 || state.length > 120 || city.length > 120) throw new Error("Enter the area and country you want to reach.");
  if (["city", "neighborhood", "zipcode"].includes(area) && !state.trim()) throw new Error("Add the state or region so we reach the right place.");
  if (area === "neighborhood" && !city.trim()) throw new Error("Add the city for this neighborhood.");
}
export function money(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100); }
