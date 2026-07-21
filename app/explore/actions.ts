"use server";

import { getExploreInspirationPage } from "@/lib/explore-inspiration";
import { getExploreNearYouSalons } from "@/lib/explore-home";
import { searchExploreSalons } from "@/lib/explore-search";
import type {
  ExploreInspirationCursor,
  ExploreSearchInput,
} from "@/types/explore";

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
