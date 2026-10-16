import type { ExploreClientProps, ExploreQuickAction } from "@/app/explore/explore-client";
import type { ExploreHomeContent, ExploreUtilityContent } from "@/types/explore";

export type AppLocalExploreCore = ExploreClientProps & { deferred: { extras: boolean; feed: boolean; showcase?: boolean } };
/** Fresh original optional getters only; no caller-supplied or repeated search DTO. */
export type AppLocalExploreExtras = { homeContent: ExploreHomeContent; utilityContent: ExploreUtilityContent; quickActions: ExploreQuickAction[] };
