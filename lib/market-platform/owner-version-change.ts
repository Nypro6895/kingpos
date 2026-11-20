import type { OwnerInstallation, OwnerVersion } from "@/types/market-platform-owner";

export function ownerVersionChange(selected: OwnerVersion, installed: OwnerInstallation | undefined, catalog: OwnerVersion[]) {
  if (!installed || installed.state !== "active" || installed.appId !== selected.app_id || installed.versionId === selected.id) return null;
  const previous = catalog.find(version => version.id === installed.versionId && version.app_id === installed.appId);
  const oldScopes = new Set(installed.scopes), nextScopes = new Set(selected.manifest.scopes);
  return {
    previousVersion: previous?.version ?? null,
    added: [...nextScopes].filter(scope => !oldScopes.has(scope)),
    removed: [...oldScopes].filter(scope => !nextScopes.has(scope)),
    previousLaunch: previous?.manifest.launchUrl ?? null,
    nextLaunch: selected.manifest.launchUrl,
    launchChanged: previous ? previous.manifest.launchUrl !== selected.manifest.launchUrl : null,
  };
}
