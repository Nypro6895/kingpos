import "server-only";
import { resolveBusinessCoverImage } from "@/lib/default-nail-images";
import { getPublicBookingReadiness } from "@/lib/public-booking";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { parseSalonProfileMediaPath } from "@/lib/salon-profile-media";
import { getPublicSalonOperatingHours } from "@/lib/salon-operating-status";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Only public profile identity media is eligible for a reward promotion.
 * Customer posts, held content and arbitrary image URLs are never selected.
 */
export async function getRewardPublicSalonContext(db: SupabaseClient, salonId: string) {
  const [profileResult, directoryResult, operatingHours, bookingReady] = await Promise.all([
    db.rpc("get_public_salon_profile", { target_salon_id: salonId }),
    db.rpc("get_public_salon_directory_listing", { target_salon_id: salonId }),
    getPublicSalonOperatingHours(salonId).catch(() => null),
    getPublicBookingReadiness(salonId).catch(() => false),
  ]);
  if (profileResult.error) throw new Error("Public salon context could not be loaded.");
  const profile = Array.isArray(profileResult.data) ? profileResult.data[0] : null;
  if (!profile || profile.salon_id !== salonId) return null;
  const serviceCategories = Array.isArray(profile.service_categories)
    ? profile.service_categories.filter((value: unknown): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const coverPath = typeof profile.cover_path === "string" ? profile.cover_path : null;
  const parsedCover = parseSalonProfileMediaPath(coverPath);
  const salonCover = parsedCover?.salonId === salonId && parsedCover.kind === "cover"
    ? getSalonProfileMediaUrl(coverPath) : null;
  const coverImageUrl = salonCover ?? resolveBusinessCoverImage({
    id: salonId,
    name: typeof profile.salon_name === "string" ? profile.salon_name : undefined,
    categories: serviceCategories,
  });
  const listing = Array.isArray(directoryResult.data) ? directoryResult.data[0] : null;
  return {
    canBook: !directoryResult.error && listing?.claim_state !== "unclaimed"
      && Boolean(operatingHours) && operatingHours?.status.kind !== "permanently_closed" && bookingReady,
    coverImageUrl,
    coverImageSource: salonCover ? "salon" as const : coverImageUrl ? "illustration" as const : null,
    serviceCategories,
  };
}
