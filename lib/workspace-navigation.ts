/** Open the checked workspace handoff as a document navigation. Changing the
 * workspace through a Server Action can re-render the old page with new cookies
 * before client navigation, racing the experience scope's identity checks. */
export function navigateToWorkspace(workspaceId: string, destinationHref?: string) {
  const params = new URLSearchParams({ workspace_id: workspaceId });

  if (destinationHref) params.set("destination", destinationHref);

  window.location.assign(`/workspace/open?${params}`);
}
