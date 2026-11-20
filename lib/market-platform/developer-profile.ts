export type PublisherProfile = { email: string; website: string; description: string };

/** Missing or malformed reads must not become an editable blank profile. */
export function readPublisherProfile(value: unknown): PublisherProfile | null | undefined {
  // SQL explicitly returns null when this organization has not saved a profile.
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.email !== "string" || typeof row.website !== "string" || typeof row.description !== "string") return undefined;
  return { email: row.email, website: row.website, description: row.description };
}
