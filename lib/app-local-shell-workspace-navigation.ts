"use client";
import { appLocalPath, getAppLocalHost } from "./app-local-host";
import { getAppLocalCommandScope } from "./app-local-command-client";

let pending = false;
/** Entry owns the fresh admission and its retry. Never repeat a committed command. */
export function completeWorkspaceHandoff(path: string) {
  window.dispatchEvent(new CustomEvent("reylumi:app-local-workspace-handoff", { detail: { path: appLocalPath(path) } }));
}
/** Installed-build alias only. Web keeps its original document handoff. */
export function navigateToWorkspace(workspaceId: string, destinationHref?: string) {
  const host = getAppLocalHost();
  if (!host.isNative) {
    const params = new URLSearchParams({ workspace_id: workspaceId }); if (destinationHref) params.set("destination", destinationHref);
    window.location.assign(`/workspace/open?${params}`); return;
  }
  const scope = getAppLocalCommandScope();
  if (!scope || !navigator.onLine) throw new Error("Connect to open a different workspace.");
  if (pending) return;
  pending = true;
  void (async () => {
    const result = await host.command<{ path: string }>("shell.switch-workspace", { workspaceId, ...(destinationHref ? { destination: destinationHref } : {}) }, { scope });
    if (scope !== getAppLocalCommandScope()) return;
    completeWorkspaceHandoff(result.path);
  })().catch(() => {
    window.dispatchEvent(new CustomEvent("reylumi:app-local-workspace-error", { detail: "Workspace context could not be updated. Try again." }));
    // The write may already have committed. Recovery checks the current role;
    // it must not blindly submit the workspace-changing command a second time.
    completeWorkspaceHandoff(location.pathname + location.search);
  }).finally(() => { pending = false; });
}
