export const publicGroups = [
  "profile",
  "services",
  "media",
  "content",
] as const;
export type PublicGroup = (typeof publicGroups)[number];
export const publicGroupLabels: Record<PublicGroup, string> = {
  profile: "Salon profile & opening hours",
  services: "Public service menu",
  media: "Selected salon photos",
  content: "FAQ, policies & guides",
};
export const publicScopeLabels: Record<string, string> = {
  "salon:identity:read": "Read this salon's name and ID",
  ...Object.fromEntries(
    publicGroups.map((g) => [
      `salon:${g}:read`,
      `Read published ${publicGroupLabels[g].toLowerCase()}`,
    ]),
  ),
};
export type PublicProfile = {
  displayName: string;
  tagline: string;
  businessPhone: string;
  businessAddress: string;
  website: string;
  timezone: string;
  brandColor: string;
  hours: {
    day: number;
    closed: boolean;
    opens: string | null;
    closes: string | null;
  }[];
};
export type PublicService = {
  id: string;
  name: string;
  category: string;
  description: string;
  priceKind: "fixed" | "from" | "on-request";
  amountCents: number | null;
  currency: string;
  durationMinutes: number | null;
};
export type PublicPhoto = {
  assetId: string;
  label: string;
  caption: string;
  rights: "owner" | "licensed";
  role: "logo" | "gallery";
};
export type PublicEntry = {
  id: string;
  kind: "faq" | "policy" | "guide";
  title: string;
  body: string;
};
export type PublicData = {
  profile: PublicProfile;
  services: { services: PublicService[] };
  media: { images: PublicPhoto[] };
  content: { entries: PublicEntry[] };
};
export type PublicSnapshot = {
  group: PublicGroup;
  revision: number;
  published: boolean;
  publishedRevision?: number;
  hasDraft?: boolean;
  publishedData?: PublicData[PublicGroup] | null;
  draftUpdatedAt?: string | null;
  data: PublicData[PublicGroup] | null;
  updatedAt: string;
};
export type PublicationWorkspace = {
  imageDeliveryReady?: boolean;
  salonId: string;
  groups: PublicSnapshot[];
  assets: { id: string; purpose: string; path?: string; previewUrl?: string }[];
};
export function emptyPublicData(g: PublicGroup): PublicData[PublicGroup] {
  return g === "profile"
    ? {
        displayName: "",
        tagline: "",
        businessPhone: "",
        businessAddress: "",
        website: "",
        timezone: "America/Chicago",
        brandColor: "#145946",
        hours: [],
      }
    : g === "services"
      ? { services: [] }
      : g === "media"
        ? { images: [] }
        : { entries: [] };
}
export function publicGroup(value: string): value is PublicGroup {
  return (publicGroups as readonly string[]).includes(value);
}

export function priceDigits(currency: string) {
  try {
    return (
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}
export function parsePublicPrice(
  text: string,
  currency: string,
): number | null {
  const digits = priceDigits(currency);
  if (
    !new RegExp(
      "^[0-9]{1,8}" + (digits ? "(?:\\.[0-9]{0," + digits + "})?" : "") + "$",
    ).test(text)
  )
    return null;
  const [whole, fraction = ""] = text.split(".");
  const amount =
    Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || 0);
  return Number.isSafeInteger(amount) && amount <= 99999999 ? amount : null;
}
export function publicPriceInput(amount: number | null, currency: string) {
  return amount === null
    ? ""
    : (amount / 10 ** priceDigits(currency)).toFixed(priceDigits(currency));
}
