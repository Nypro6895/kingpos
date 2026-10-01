import "server-only";

import {
  getCurrentBusinessContext,
  SELECTED_WORKSPACE_COOKIE,
} from "@/lib/current-context";

/** Resolve an explicitly selected workspace without changing browser cookies. */
export async function getMyPlaceWorkspaceContext(workspaceId: string) {
  const context = await getCurrentBusinessContext({
    cookieStore: {
      get: (name: string) =>
        name === SELECTED_WORKSPACE_COOKIE
          ? { name, value: workspaceId }
          : undefined,
    },
  });
  if (!context.user || context.currentWorkspace?.id !== workspaceId) {
    throw new Error("You no longer have access to this workspace.");
  }
  return context;
}
