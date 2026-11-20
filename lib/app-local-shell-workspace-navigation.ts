"use client";
import { appLocalPath, getAppLocalHost } from "./app-local-host";
import { getAppLocalCommandScope } from "./app-local-command-client";

let pending = false;
/** Entry owns the fresh admission and its retry. Never repeat a committed command. */
export function completeWorkspaceHandoff(path: string, gesture?: { generation?: string; scope: string; workspaceId: string }) {
  window.dispatchEvent(new CustomEvent("reylumi:app-local-workspace-handoff", { detail: { path: appLocalPath(path), ...(gesture ? { gesture } : {}) } }));
}
/** Resolve an uncertain write through a fresh account read, never another write. */
export function requestWorkspaceResolution(generation = window.__reylumiAppLocalContext?.generation, workspaceId?: string, gesture?: { generation?: string; scope: string; workspaceId: string }) {
  window.dispatchEvent(new CustomEvent("reylumi:app-local-workspace-resolve", { detail: { generation, ...(workspaceId ? { workspaceId } : {}), ...(gesture ? { gesture } : {}) } }));
}
/** Installed-build alias only. Web keeps its original document handoff. */
export function navigateToWorkspace(workspaceId: string, destinationHref?: string) {
  const host = getAppLocalHost();
  if (!host.isNative) {
    const params = new URLSearchParams({ workspace_id: workspaceId }); if (destinationHref) params.set("destination", destinationHref);
    window.location.assign(`/workspace/open?${params}`); return;
  }
  const scope = getAppLocalCommandScope();
  const generation = window.__reylumiAppLocalContext?.generation;
  if (!scope || !navigator.onLine) throw new Error("Connect to open a different workspace.");
  if (pending) return;
  pending = true;
  window.dispatchEvent(new CustomEvent("reylumi:app-local-workspace-start", { detail: { generation, scope, workspaceId } }));
  void (async () => {
    const result = await host.command<{ path: string }>("shell.switch-workspace", { workspaceId, ...(destinationHref ? { destination: destinationHref } : {}) }, { scope });
    const activeScope = getAppLocalCommandScope();
    // A stale read can withdraw the old scope while this authorized gesture
    // commits. Undefined means checking again, not a different accepted user.
    // Destination admission still requires a fresh server context.
    if (window.__reylumiAppLocalContext?.generation !== generation || activeScope && scope !== activeScope) return;
    completeWorkspaceHandoff(result.path, { generation, scope, workspaceId });
  })().catch(() => {
    const activeScope = getAppLocalCommandScope();
    if (window.__reylumiAppLocalContext?.generation !== generation || activeScope && activeScope !== scope) return;
    // Cookies may already select the requested workspace. The old Staff path
    // would resolve Staff identity even after a committed Owner selection.
    requestWorkspaceResolution(generation, workspaceId, { generation, scope, workspaceId });
  }).finally(() => {
    window.dispatchEvent(new CustomEvent("reylumi:app-local-workspace-finish", { detail: { generation, scope } }));
    pending = false;
  });
}
