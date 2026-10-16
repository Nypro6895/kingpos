import type { ComponentProps } from "react";
import type { SalonProfileView } from "@/app/salon-profile/salon-profile-view";
import type { BeautyProfileRoutePage } from "./beauty-relationship";
import type { getPublicExploreBeautyPost } from "./explore-personal";
import type { PostCommentViewer } from "@/types/post-comments";
import type { NailLook } from "./nail-inspiration-catalog";
import type { ExploreSearchResult } from "@/types/explore";
import type { PublicBookingPageData } from "./public-booking";
export type AppLocalPublicData =
  | { view: "salon"; props: ComponentProps<typeof SalonProfileView> }
  | { view: "beauty"; page: BeautyProfileRoutePage }
  | { view: "beauty-post"; item: NonNullable<Awaited<ReturnType<typeof getPublicExploreBeautyPost>>>; commentViewer: PostCommentViewer; profileId: string; postId: string }
  | { view: "inspiration"; look: NailLook; salon?: ExploreSearchResult; location: string }
  | { view: "booking"; data: PublicBookingPageData }
  | { view: "online"; href: string; reason: "payment" | "own-salon" };
