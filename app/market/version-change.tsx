import { WorkspaceText } from "@/components/workspace-language";
import { ownerVersionChange } from "@/lib/market-platform/owner-version-change";
import { publicScopeLabels } from "@/lib/market-platform/published-contract";
import type { OwnerInstallation, OwnerVersion } from "@/types/market-platform-owner";
import styles from "./developer-apps.module.css";

export function OwnerVersionChange({ selected, installed, catalog }: { selected: OwnerVersion; installed?: OwnerInstallation; catalog: OwnerVersion[] }) {
  const change = ownerVersionChange(selected, installed, catalog);
  if (!change) return null;
  return <aside className={styles.versionChange} aria-label="Version changes to review">
    <h3><WorkspaceText text="Review this version change" /></h3>
    <p><WorkspaceText text="Only your current salon is affected. Review this version's access before approving." /></p>
    {change.added.length > 0 && <><h4><WorkspaceText text="Newly requested access" /></h4><ul>{change.added.map(scope => <li key={scope}><WorkspaceText text={publicScopeLabels[scope] ?? scope} /></li>)}</ul></>}
    {change.removed.length > 0 && <><h4><WorkspaceText text="Access no longer requested" /></h4><ul>{change.removed.map(scope => <li key={scope}><WorkspaceText text={publicScopeLabels[scope] ?? scope} /></li>)}</ul></>}
    {!change.added.length && !change.removed.length && <p><WorkspaceText text="The requested access is unchanged. A different version still needs your approval." /></p>}
    {change.launchChanged === true && <><h4><WorkspaceText text="The app's launch address changes" /></h4><p><WorkspaceText text="Previous address" />: <code>{change.previousLaunch}</code><br /><WorkspaceText text="New address" />: <code>{change.nextLaunch}</code></p></>}
    {change.launchChanged === null && <p><WorkspaceText text="The previous version's launch details are unavailable. Review the selected address and listed permissions." /></p>}
    <p><WorkspaceText text="Manifest review does not certify that the developer's hosted code has remained unchanged." /></p>
  </aside>;
}
