/** Read refresh hints only. Commands retain their original server authorization. */
export function appLocalCommandAffectsResource(resource: string, source?: string): boolean {
  if (source === "app/pos/owner-check-in-actions.ts") {
    return resource.startsWith("owner.") || resource.startsWith("staff.")
      || ["page.owner-staff", "page.owner-today", "page.owner-payroll", "shell.summary"].includes(resource);
  }
  if (source === "app/explore/social-actions.ts") {
    return resource.startsWith("page.explore") || resource.startsWith("http.explore.")
      || ["customer.favorites", "customer.following", "customer.saved-posts", "page.my-place"].includes(resource);
  }
  // Unknown/older clients keep conservative invalidation; inactive cells are
  // still deferred by the resource layer instead of being eagerly fetched.
  return true;
}
