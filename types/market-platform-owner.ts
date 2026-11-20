import type { Version } from "@/lib/market-platform/server";
export type OwnerVersion = Version & { entitled: boolean; connectionReady: boolean };
export type OwnerInstallation = { id: string; appId: string; versionId: string; state: "active" | "revoked"; scopes: string[]; usable: boolean; connectionReady: boolean };
export type OwnerMarketplace = { observedAt: string; salonId: string; salonName: string; testPaymentsEnabled: boolean; catalog: OwnerVersion[]; installations: OwnerInstallation[] };
export type OwnerMarketState = { status: "disabled" | "select-salon" | "unavailable"; message: string } | { status: "ready"; data: OwnerMarketplace };
