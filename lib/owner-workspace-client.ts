type Resource = "staff" | "catalog" | "settings";

/** Never put a response for a different owner/session into a retained desk. */
export async function fetchOwnerWorkspace<T>(scope: string, resource: Resource, ids?: string[]): Promise<T> {
  const query = new URLSearchParams({ resource, ownerScope: scope });
  if (ids?.length) query.set("ids", ids.join(","));
  const response = await fetch("/api/pos/owner/workspace?" + query, {
    credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("The current workspace could not be refreshed.");
  const result = await response.json();
  if (result?.ownerScope !== scope) throw new Error("The workspace response belongs to a different session.");
  return result as T;
}
