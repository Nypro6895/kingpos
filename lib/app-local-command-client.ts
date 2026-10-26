"use client";
import { getAppLocalHost, appLocalPath } from "./app-local-host";
import { encodeAppLocalValue } from "./app-local-command-codec";
import { handlesAppLocalFileCommand } from "./app-local-upload-client";
import { completeWorkspaceHandoff, navigateToWorkspace, requestWorkspaceResolution } from "./app-local-shell-workspace-navigation";

let currentScope: string | undefined;
export function setAppLocalCommandScope(scope: string | undefined) { currentScope = scope; }
export function getAppLocalCommandScope() { return currentScope; }
export async function invokeAppLocalCommand(name: string, values: unknown[], invalidate = true, source?: string, workspaceChange = false) {
  if (!currentScope) throw new Error("Connect to verify your account before saving.");
  const scope = currentScope;
  const generation = window.__reylumiAppLocalContext?.generation;
  let result: { value?: unknown; redirect?: string };
  try {
    const upload = await handlesAppLocalFileCommand(name, values, scope);
    result = upload.handled ? upload : await getAppLocalHost().command<{ value?: unknown; redirect?: string }>(name, { values: await encodeAppLocalValue(values) }, { scope });
  } catch (error) {
    if (workspaceChange && scope === currentScope && generation === window.__reylumiAppLocalContext?.generation) requestWorkspaceResolution(generation);
    throw error;
  }
  if (scope !== currentScope || generation !== window.__reylumiAppLocalContext?.generation) throw new Error("Your account has changed. Please open the page again.");
  if (result.redirect) {
    const path = appLocalPath(result.redirect), target = new URL(path, "https://reylumi.com");
    if (target.pathname === "/workspace/open" && target.searchParams.get("workspace_id")) {
      navigateToWorkspace(target.searchParams.get("workspace_id")!, target.searchParams.get("destination") ?? undefined);
      return result.value;
    }
    window.dispatchEvent(new CustomEvent("reylumi:app-local-navigate", { detail: { path } }));
  }
  // Booking commands from notifications can also select a workspace. Recheck
  // after the original write once, without changing its confirmation semantics.
  if (workspaceChange) {
    completeWorkspaceHandoff(location.pathname + location.search);
    return result.value;
  }
  if (invalidate) window.dispatchEvent(new CustomEvent("reylumi:app-local-command-complete", { detail: { scope, name, source } }));
  return result.value;
}
