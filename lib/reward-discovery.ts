export type RewardDiscoveryKind = "all" | "spend" | "welcome" | "before_after";
export type RewardDiscoveryOffer = { id: string; title: string; points: number; valueCents: number; minimumCents: number; serviceName: string | null };
export type RewardDiscoverySalon = {
  id: string; name: string; city: string | null; state: string | null; distanceMiles: number | null;
  spendCents: number; spendPoints: number; welcomePoints: number; firstBookingPoints: number;
  visitPoints: number; conversionPoints: number; version: number; offers: RewardDiscoveryOffer[];
  canBook?: boolean; coverImageUrl?: string|null; coverImageSource?: "salon"|"illustration"|null; serviceCategories?:string[];
};
export type RewardEarningEligibility = {welcome:boolean;firstBooking:boolean;spend:boolean;visit:boolean;beforeAfter:boolean};
export type RewardPublicProgram = {salon:RewardDiscoverySalon|null;joined:boolean;available:number|null;earningEligibility?:RewardEarningEligibility;authenticated?:boolean};
export type RewardDiscoveryResult = { salons: RewardDiscoverySalon[]; hasMore: boolean; needsArea?: boolean; areaLabel?:string };

/** Reject missing, blank, infinite and half-present GPS; never manufacture 0,0. */
export function rewardDiscoveryPoint(lat: unknown, lon: unknown) {
  const number = (v: unknown) => typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  const latitude = number(lat), longitude = number(lon);
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null;
}
export function rewardDiscoveryKind(value: unknown): RewardDiscoveryKind {
  return value === "spend" || value === "welcome" || value === "before_after" ? value : "all";
}
export function rewardDiscoveryRadius(value: unknown) {
  const n = Number(value);
  return n === 5 || n === 10 || n === 15 ? n : 5;
}
export function rewardEarnLines(salon: Pick<RewardDiscoverySalon, "spendCents" | "spendPoints" | "welcomePoints" | "firstBookingPoints" | "visitPoints" | "conversionPoints">) {
  const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  return [
    salon.spendCents > 0 && salon.spendPoints > 0 ? `${salon.spendPoints} points per complete ${money(salon.spendCents)} of qualifying services on each fully paid receipt; unused remainder does not carry forward` : "",
    salon.welcomePoints > 0 ? `${salon.welcomePoints} welcome points when you first join this salon’s program through a linked visit or eligible referral` : "",
    salon.firstBookingPoints > 0 ? `${salon.firstBookingPoints} points for your first completed, fully paid booking` : "",
    salon.visitPoints > 0 ? `${salon.visitPoints} points per completed, fully paid visit` : "",
    salon.conversionPoints > 0 ? `${salon.conversionPoints} points when another guest books from your Before & After and completes a fully paid visit` : "",
    salon.spendPoints > 0 ? "Spend points exclude tips, tax, discounts and gift-card-funded amounts" : "",
  ].filter(Boolean);
}
export function rewardCardEarning(salon: RewardDiscoverySalon, kind: RewardDiscoveryKind) {
  const lines = rewardEarnLines(salon);
  if (kind === "before_after") return `${salon.conversionPoints} points per completed, paid Before & After referral`;
  if (kind === "welcome") return `${salon.welcomePoints} one-time welcome points on joining`;
  if (salon.spendPoints>0) return `${salon.spendPoints} points per complete ${new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(salon.spendCents/100)} on each paid receipt`;
  return lines[0];
}
export function rewardOfferLabel(offer: Pick<RewardDiscoveryOffer, "points" | "valueCents" | "minimumCents">) {
  const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n/100);
  return `${offer.points} points → ${money(offer.valueCents)} off services${offer.minimumCents>0?` · ${money(offer.minimumCents)} minimum`:""}`;
}
/** Illustrative path using spend points alone; bonuses and pending points are excluded. */
export function rewardSpendExample(program: { spendCents: number; spendPoints: number; offers: { points: number; valueCents: number }[] }) {
  const offer = program.offers.find(o => Number.isInteger(o.points) && o.points > 0 && Number.isInteger(o.valueCents) && o.valueCents > 0);
  if (!offer || !Number.isInteger(program.spendCents) || program.spendCents <= 0 || !Number.isInteger(program.spendPoints) || program.spendPoints <= 0) return null;
  return { qualifyingSpendCents: Math.ceil(offer.points / program.spendPoints) * program.spendCents, valueCents: offer.valueCents, points: offer.points };
}
