export const DEFAULT_NAIL_IMAGES = Array.from({ length: 20 }, (_, index) =>
  `/images/nail-defaults/nails-${String(index + 1).padStart(2, "0")}.webp`,
);

type NailCoverInput = { id: string; name?: string; categories?: readonly string[]; coverImageUrl?: string | null };

// A stable pseudo-random choice keeps the salon recognizable across routes.
export function resolveNailCoverImage(input: NailCoverInput): string | null {
  if (input.coverImageUrl?.trim()) return input.coverImageUrl;
  if (!input.id || !/nail|manicure|pedicure|acrylic|shellac|gel\b/i.test([input.name ?? "", ...(input.categories ?? [])].join(" "))) return null;
  let hash = 2166136261;
  for (const char of input.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return DEFAULT_NAIL_IMAGES[hash % DEFAULT_NAIL_IMAGES.length];
}

export function isDefaultNailImage(url: string | null | undefined) {
  return Boolean(url && DEFAULT_NAIL_IMAGES.includes(url));
}

export const DEFAULT_NAIL_IMAGE_CREDIT = "AI illustration";
