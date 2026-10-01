import "server-only";

import {
  PERSONAL_HOME_PATH,
  resolvePostAuthRoute,
  sanitizeAuthReturnPath,
} from "@/lib/auth-routing";
import {
  SELECTED_WORKSPACE_COOKIE,
  getCurrentBusinessContext,
  type CurrentWorkspaceOption,
} from "@/lib/current-context";
import { cookies } from "next/headers";

export type PostAuthWorkspaceNavigation = {
  redirectTo: string;
  workspace: CurrentWorkspaceOption | null;
};

export async function getPostAuthWorkspaceNavigation(input: {
  accessToken: string;
  requestedPath?: string | null;
}): Promise<PostAuthWorkspaceNavigation> {
  const cookieStore = await cookies();
  const context = await getCurrentBusinessContext({
    accessToken: input.accessToken,
    cookieStore,
  });
  const preferredWorkspaceId =
    cookieStore.get(SELECTED_WORKSPACE_COOKIE)?.value ??
    context.currentWorkspace?.id ??
    null;
  const decision = resolvePostAuthRoute({
    preferredWorkspaceId,
    requestedPath: input.requestedPath,
    workspaces: context.workspaceOptions,
  });
  const workspace =
    context.workspaceOptions.find(
      (option) => option.id === decision.workspaceId,
    ) ??
    context.workspaceOptions.find((option) => option.type === "personal") ??
    null;

  return {
    redirectTo: sanitizeAuthReturnPath(decision.redirectTo, PERSONAL_HOME_PATH),
    workspace,
  };
}

export function fallbackPostAuthWorkspaceNavigation(): PostAuthWorkspaceNavigation {
  return {
    redirectTo: PERSONAL_HOME_PATH,
    workspace: null,
  };
}
