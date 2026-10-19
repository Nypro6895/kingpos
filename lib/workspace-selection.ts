import "server-only";
import {
  getWorkspaceLandingHref,
  isWorkspaceDestinationAllowed,
  setNormalizedWorkspaceContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { revalidatePath } from "next/cache";

type WorkspaceSelectionResult =
  | { ok: true; destination: URL }
  | { ok: false; status: 400 | 401 | 403 | 503; error: string };

/** Both transports use a fresh prewrite context, never a cached display lease. */
export async function selectWorkspaceContext(
  context: CurrentBusinessContext,
  requestUrl: URL,
): Promise<WorkspaceSelectionResult> {
  if (!context.user) return { ok: false, status: 401, error: "Please sign in again." };
  const workspaceId = requestUrl.searchParams.get("workspace_id")?.trim() ?? "";
  if (!workspaceId) return { ok: false, status: 400, error: "Choose a workspace before opening it." };
  const workspace = context.workspaceOptions.find(option => option.id === workspaceId);
  if (!workspace) return { ok: false, status: 403, error: "You no longer have access to that workspace." };
  const requestedDestination = requestUrl.searchParams.get("destination")?.trim() || getWorkspaceLandingHref(workspace);
  const unavailable = { ok: false, status: 403, error: "That shortcut is no longer available for this workspace." } as const;
  if (!requestedDestination.startsWith("/") || requestedDestination.startsWith("//")) return unavailable;
  const destination = new URL(requestedDestination, requestUrl.origin);
  if (destination.origin !== requestUrl.origin) return unavailable;
  const destinationAllowed = isWorkspaceDestinationAllowed(workspace, `${destination.pathname}${destination.search}`)
    || isWorkspaceDestinationAllowed(workspace, destination.pathname);
  if (!destinationAllowed) return unavailable;
  try {
    await setNormalizedWorkspaceContext(workspace);
  } catch (error) {
    // A cookie writer can fail after a partial commit. Do not claim a selected
    // workspace or replay the write; the caller must resolve the actual state.
    return { ok: false, status: 503, error: error instanceof Error ? error.message : "Workspace context could not be updated." };
  }
  revalidatePath("/", "layout");
  return { ok: true, destination };
}
