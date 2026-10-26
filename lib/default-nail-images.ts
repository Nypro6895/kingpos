export const DEFAULT_NAIL_IMAGES = Array.from({ length: 20 }, (_, index) =>
  `/images/nail-defaults/nails-${String(index + 1).padStart(2, "0")}.webp`,
);

type NailCoverInput = { id: string; name?: string; categories?: readonly string[]; coverImageUrl?: string | null };

export const DEFAULT_BUSINESS_IMAGES = {
  Nails: DEFAULT_NAIL_IMAGES,
  Hair: Array.from({ length: 8 }, (_, index) => `/images/business-defaults/hair-${String(index + 1).padStart(2, "0")}.webp`),
  Massage: Array.from({ length: 8 }, (_, index) => `/images/business-defaults/massage-${String(index + 1).padStart(2, "0")}.webp`),
  Tattoo: Array.from({ length: 8 }, (_, index) => `/images/business-defaults/tattoo-${String(index + 1).padStart(2, "0")}.webp`),
  Lashes: Array.from({ length: 8 }, (_, index) => `/images/business-defaults/lashes-${String(index + 1).padStart(2, "0")}.webp`),
  Spa: ["/images/business-defaults/spa-01.webp", "/images/business-defaults/spa-02.webp"],
  Brows: ["/images/business-defaults/brows-01.webp", "/images/business-defaults/brows-02.webp"],
  Waxing: ["/images/business-defaults/waxing-01.webp", "/images/business-defaults/waxing-02.webp"],
  "Skin Care": ["/images/business-defaults/skincare-01.webp", "/images/business-defaults/skincare-02.webp"],
};
const categoryPatterns = [
  ["Nails", /nail|manicure|pedicure|acrylic|shellac|gel\b/i],
  ["Hair", /hair|barber|balayage|loctician/i],
  ["Massage", /massage|bodywork/i],
  ["Tattoo", /tattoo|tatoo/i],
  ["Lashes", /lash|eyelash/i],
  ["Spa", /^spa$|day spa/i],
  ["Brows", /brow|threading/i],
  ["Waxing", /waxing/i],
  ["Skin Care", /skin care|skincare|esthetic|facial/i],
] as const;
function imageCategory(input: NailCoverInput): keyof typeof DEFAULT_BUSINESS_IMAGES | null {
  for (const category of input.categories ?? []) {
    const found = categoryPatterns.find(([, pattern]) => pattern.test(category));
    if (found) return found[0];
  }
  return categoryPatterns.find(([, pattern]) => pattern.test(input.name ?? ""))?.[0] ?? null;
}

// A stable pseudo-random choice keeps the salon recognizable across routes.
export function resolveBusinessCoverImage(input: NailCoverInput): string | null {
  if (input.coverImageUrl?.trim()) return input.coverImageUrl;
  const category = imageCategory(input);
  if (!input.id || !category) return null;
  let hash = 2166136261;
  for (const char of input.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const images = DEFAULT_BUSINESS_IMAGES[category];
  return images[hash % images.length];
}
// Compatibility with existing cover consumers; all categories use the same policy.
export const resolveNailCoverImage = resolveBusinessCoverImage;

export function isDefaultNailImage(url: string | null | undefined) {
  return Boolean(url && Object.values(DEFAULT_BUSINESS_IMAGES).some(images => images.includes(url)));
}
export const isDefaultBusinessImage = isDefaultNailImage;

export const DEFAULT_NAIL_IMAGE_CREDIT = "lumiAi";
