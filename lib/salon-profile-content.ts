// Platform reference posts must never become owner-authored content after claim.
export function visibleSalonPosts<T extends { id: string }>(posts: T[], listing?: { claimState: string; referencePostId: string | null } | null): T[] {
  return listing?.claimState === "claimed" && listing.referencePostId
    ? posts.filter(post => post.id !== listing.referencePostId)
    : posts;
}

export function salonAboutParagraphs(profile: { description?: string | null; story?: string | null }): string[] {
  return [...new Set([profile.description?.trim(), profile.story?.trim()].filter((text): text is string => Boolean(text)))];
}

export function claimedSalonContent<T extends { name: string; city: string | null; description: string | null; story: string | null }>(profile: T, listing: { claimState: string; categories: string[] } | null, referenceCaption?: string | null): T {
  if (listing?.claimState !== "claimed") return profile;
  const importedDescription = `${profile.name} · ${listing.categories.join(", ")} in ${profile.city}, Wisconsin. Public listing created by Reylumi; not yet claimed by the business owner.`;
  return { ...profile, description: profile.description === importedDescription ? null : profile.description, story: referenceCaption && profile.story === referenceCaption ? null : profile.story };
}
