import { resolveBusinessCoverImage } from "@/lib/default-nail-images";
import { NAIL_SUGGESTION_CATALOG_VERSION, selectNailLookForSalon } from "@/lib/nail-inspiration";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { isSalonProfileMediaPathForSalon } from "@/lib/salon-profile-media";
import { BEAUTY_MEDIA_BUCKET, BEAUTY_POST_MEDIA_ROLES, getBeautyMediaPublicUrl, isBeautyMediaPathForUser, type BeautyPostMediaRole } from "@/lib/beauty-media";
import type { ExploreSearchFilters, ExploreSearchResult } from "@/types/explore";

export type ExploreSearchMediaRow = {
  salon_id: string;
  salon_name: string;
  service_categories?: string[] | null;
  image_provenance?: string | null;
  selected_media_salon_id?: string | null;
  selected_media_path?: string | null;
  selected_media_bucket?: string | null;
  selected_media_author_user_id?: string | null;
  selected_media_role?: string | null;
  selected_content_key?: string | null;
  selected_content_id?: string | null;
  selected_content_type?: string | null;
  valid_cover_image_path?: string | null;
  valid_cover_salon_id?: string | null;
  media_revision?: string | null;
};

/** Media is hydrated afresh; a frozen rank never freezes an image or claim state. */
export function resolveExploreSearchMedia(row: ExploreSearchMediaRow, query = "", filters: ExploreSearchFilters = {}, options: { supabaseUrl?: string } = {}): Pick<ExploreSearchResult,
  "coverImageUrl" | "imageProvenance" | "imageSourceSalonId" | "selectedContentKey" | "selectedContentId" | "selectedContentType" | "selectedMediaPath" | "selectedMediaBucket" | "mediaRevision"> {
  const ownMedia = row.selected_media_salon_id === row.salon_id && row.selected_media_bucket === "salon-profile-media"
    && (row.image_provenance === "salon_post" || row.image_provenance === "salon_cover")
    && isSalonProfileMediaPathForSalon({ path: row.selected_media_path, salonId: row.salon_id,
      allowedKinds: row.image_provenance === "salon_cover" ? ["cover"] : ["look", "update"] });
  const attributedCustomerMedia = row.image_provenance === "customer_post" && row.selected_content_type === "beauty_post"
    && row.selected_media_salon_id === row.salon_id && row.selected_media_bucket === BEAUTY_MEDIA_BUCKET
    && typeof row.selected_media_author_user_id === "string" && BEAUTY_POST_MEDIA_ROLES.includes(row.selected_media_role as BeautyPostMediaRole)
    && isBeautyMediaPathForUser({ path: row.selected_media_path, userId: row.selected_media_author_user_id, role: row.selected_media_role as BeautyPostMediaRole });
  const selected = ownMedia ? getSalonProfileMediaUrl(row.selected_media_path) : attributedCustomerMedia && options.supabaseUrl
    ? getBeautyMediaPublicUrl({ path: row.selected_media_path, bucket: BEAUTY_MEDIA_BUCKET, supabaseUrl: options.supabaseUrl }) : null;
  const cover = row.valid_cover_salon_id === row.salon_id && isSalonProfileMediaPathForSalon({ path: row.valid_cover_image_path, salonId: row.salon_id, allowedKinds: ["cover"] })
    ? getSalonProfileMediaUrl(row.valid_cover_image_path) : null;
  const real = selected || cover;
  const categories = row.service_categories ?? [];
  const nails = /nail|manicure|pedicure|acrylic|shellac|\bgel\b/i.test([...categories, row.salon_name].join(" "));
  const suggested = !real && nails ? selectNailLookForSalon(row.salon_id, query, filters)?.imageUrl : null;
  const imageUrl = real || suggested || resolveBusinessCoverImage({ id: row.salon_id, name: row.salon_name, categories });
  const provenance = selected ? row.image_provenance as "salon_post" | "customer_post" | "salon_cover" : cover ? "salon_cover" : imageUrl ? "suggested" : "none";
  const postSelected = selected && (provenance === "salon_post" || provenance === "customer_post");
  return {
    coverImageUrl: imageUrl,
    imageProvenance: provenance,
    imageSourceSalonId: real ? row.salon_id : null,
    selectedContentKey: postSelected ? row.selected_content_key ?? null : null,
    selectedContentId: postSelected ? row.selected_content_id ?? null : null,
    selectedContentType: postSelected ? row.selected_content_type ?? null : null,
    selectedMediaPath: selected ? row.selected_media_path ?? null : cover ? row.valid_cover_image_path ?? null : null,
    selectedMediaBucket: selected ? row.selected_media_bucket ?? null : cover ? "salon-profile-media" : null,
    mediaRevision: provenance === "suggested" ? `${NAIL_SUGGESTION_CATALOG_VERSION}:${row.media_revision ?? "none"}` : row.media_revision ?? null,
  };
}
