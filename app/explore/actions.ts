"use server";

import { searchExploreSalons } from "@/lib/explore-search";
import type { ExploreSearchInput } from "@/types/explore";

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
