import { WorkspaceText } from "@/components/workspace-language";
import { getWindowsPosRelease } from '@/lib/windows-pos-release';
import { WindowsPosDownloadLinks } from '@/components/windows-pos-download';
export async function DesktopDownloadPanel() {
  const release = await getWindowsPosRelease();
  return (
    <div className="settings-launch">
      <div>
        {release ? <WindowsPosDownloadLinks href={release.href} compact /> : <span><WorkspaceText text="Windows download unavailable" /></span>}
        <a href="/pos/portable" target="_blank" rel="noreferrer"><WorkspaceText text="↗ Run Portable in browser" /></a>
      </div>
      <p><WorkspaceText text="Use a POS ID to sign in. The Windows app keeps saved tickets on this computer." /></p>
      {release ? <small>v{release.version} · <WorkspaceText text={release.edition === 'test' ? 'Local test edition · Requires the salon’s configured server.' : 'Online edition · Internet required for sign-in and syncing.'} /></small> : null}
    </div>
  );
}
