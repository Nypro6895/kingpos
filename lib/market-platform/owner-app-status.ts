import type { OwnerInstallation, OwnerVersion } from "@/types/market-platform-owner";

export type OwnerAppStatus = {
  kind: "available" | "payment-required" | "installed" | "setup-required" | "access-blocked";
  label: string;
  detail: string;
  action: string;
  canOpen: boolean;
  update: OwnerVersion | null;
};

export function compareOwnerVersions(a: OwnerVersion, b: OwnerVersion): number {
  const left = a.version.split(".").map(BigInt), right = b.version.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? -1 : 1;
  return 0;
}

/** These are server workspace observations, never a claim that a hosted app is online. */
export function ownerAppStatus(version: OwnerVersion, installation: OwnerInstallation | undefined, catalog: OwnerVersion[]): OwnerAppStatus {
  const current = installation?.state === "active" && installation.appId === version.app_id ? installation : undefined;
  const installedVersion = current && catalog.find(v => v.app_id === current.appId && v.id === current.versionId);
  const latest = catalog.filter(v => v.app_id === version.app_id).sort(compareOwnerVersions)[0];
  const update = current && installedVersion && latest && compareOwnerVersions(latest, installedVersion) < 0 ? latest : null;
  if (current) {
    if (!installedVersion || !current.usable) return {kind:"access-blocked", label:"Access needs attention", detail:"The installed version cannot currently be used. Review its access or choose an available version. You can still remove this app.", action:"Review app access", canOpen:false, update};
    if (!current.connectionReady || !installedVersion.connectionReady) return {kind:"setup-required", label:"Waiting for developer setup", detail:"This app is installed, but its developer connection is not ready. Contact the developer for help; do not copy or share tokens.", action:"View setup details", canOpen:false, update};
    return {kind:"installed", label:"Installed", detail:"Open the installed version to connect. The developer's website may ask you to sign in; its availability is checked when you open it.", action:"View installed version", canOpen:true, update};
  }
  if (!version.entitled) return {kind:"payment-required", label:"Access required", detail:"Access must be confirmed before you can activate this version. No salon data is shared until you approve its permissions.", action:"View access options", canOpen:false, update:null};
  return {kind:"available", label:"Available to activate", detail:"Review this app and approve its permissions for your current salon before activating it.", action:"View app", canOpen:false, update:null};
}
