export type SalonPostAuthorRole = "owner" | "staff" | "salon";
export type PostIdentityInput = {
  source: "salon" | "personal";
  salonName?: string | null;
  salonHref?: string | null;
  salonAvatarUrl?: string | null;
  authorName?: string | null;
  authorHref?: string | null;
  authorAvatarUrl?: string | null;
  authorRole?: SalonPostAuthorRole | null;
};
// Publishing destination determines identity. Owner attribution never replaces the salon.
export function resolvePostIdentity(input: PostIdentityInput) {
  const salonPrimary = input.source === "salon";
  const staff = salonPrimary && input.authorRole === "staff" && Boolean(input.authorName?.trim());
  return {
    primaryName: (salonPrimary ? input.salonName : input.authorName)?.trim() || (salonPrimary ? "Salon" : "Reylumi"),
    primaryHref: salonPrimary ? input.salonHref : input.authorHref,
    primaryAvatarUrl: salonPrimary ? input.salonAvatarUrl : input.authorAvatarUrl,
    secondaryName: staff ? input.authorName : !salonPrimary ? input.salonName : null,
    secondaryHref: staff ? input.authorHref : !salonPrimary ? input.salonHref : null,
    secondaryLabel: staff ? "By" : "At",
    salonPrimary,
  };
}
