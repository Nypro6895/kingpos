"use server";

import { toggleAccountBeautyProfileFollow } from "@/lib/account-social";
import { getExploreFeedPage } from "@/lib/explore-feed";
import { getExploreInspirationPage } from "@/lib/explore-inspiration";
import { getExploreNearYouSalons } from "@/lib/explore-home";
import { searchExploreSalons } from "@/lib/explore-search";
import type {
  ExploreFeedCursor,
  ExploreInspirationCursor,
  ExploreSearchInput,
} from "@/types/explore";
import { revalidatePath } from "next/cache";

type ToggleFollowResult = {
  active: boolean;
  error: string | null;
};

export async function searchExploreWithGpsAction(input: ExploreSearchInput) {
  return searchExploreSalons({
    category: input.category,
    latitude: input.latitude,
    location: "",
    longitude: input.longitude,
    page: input.page,
    pageSize: input.pageSize,
    query: input.query,
  });
}

export async function loadExploreNearYouAction(input: ExploreSearchInput) {
  return getExploreNearYouSalons({
    latitude: input.latitude,
    longitude: input.longitude,
  });
}

export async function loadExploreInspirationAction(
  cursor: ExploreInspirationCursor | null,
) {
  return getExploreInspirationPage({ cursor });
}

export async function loadExploreFeedAction(cursor: ExploreFeedCursor | null) {
  return getExploreFeedPage({ cursor });
}

export async function toggleBeautyProfileFollowAction(
  profileId: string,
): Promise<ToggleFollowResult> {
  try {
    const active = await toggleAccountBeautyProfileFollow(profileId);

    revalidatePath(`/explore/beauty/${profileId}`);
    revalidatePath("/more/following");
    revalidatePath("/explore");

    return { active, error: null };
  } catch (error) {
    return {
      active: false,
      error:
        error instanceof Error
          ? error.message
          : "Beauty follow could not be saved.",
    };
  }
}
