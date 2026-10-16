"use client";
import { getAppLocalHost } from "./app-local-host";
import { getAppLocalCommandScope } from "./app-local-command-client";

let pending = false;
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
    // A changed cookie jar is never paired with the old account's displayed DTO.
    window.dispatchEvent(new Event("reylumi:app-local-reset"));
    const fresh = await host.context(result.path, { fresh: true });
    const activeScope = getAppLocalCommandScope();
    if (activeScope && activeScope !== fresh.context.scope) return;
    window.dispatchEvent(new CustomEvent("reylumi:app-local-context", { detail: fresh }));
    window.dispatchEvent(new CustomEvent("reylumi:app-local-navigate", { detail: { path: result.path } }));
  })().catch(() => {
    window.dispatchEvent(new CustomEvent("reylumi:app-local-workspace-error", { detail: "Workspace context could not be updated. Try again." }));
    window.dispatchEvent(new Event("pageshow"));
  }).finally(() => { pending = false; });
}
