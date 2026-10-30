import { DEFAULT_NAIL_IMAGES, isDefaultNailImage, resolveNailCoverImage } from "./default-nail-images";

export const WEBSITE_WELCOME_IMAGE = "/images/profile-defaults/botanical-welcome.webp";

// Presentation fallbacks only. Never persist these as salon uploads or posts.
export function websiteDefaultImage(profile: { salonId: string; name: string; serviceCategories?: string[] }) {
  const image = resolveNailCoverImage({ id: profile.salonId, name: profile.name, categories: profile.serviceCategories });
  // A neutral manicure complements the approved ivory palette. Other business
  // categories retain the category-aware resolver's image when available.
  return image && DEFAULT_NAIL_IMAGES.includes(image) ? DEFAULT_NAIL_IMAGES[0] : image || WEBSITE_WELCOME_IMAGE;
}

export function websiteImageSource(ownImage: string | null | undefined, defaultImage: string, failedImages: readonly string[] = []) {
  if (ownImage?.trim() && !isDefaultNailImage(ownImage) && ownImage !== WEBSITE_WELCOME_IMAGE && !failedImages.includes(ownImage)) {
    return { url: ownImage, illustrative: false };
  }
  const url = [defaultImage, WEBSITE_WELCOME_IMAGE].find(image => !failedImages.includes(image)) ?? null;
  return { url, illustrative: true };
}
