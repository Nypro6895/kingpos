import { readFile } from "node:fs/promises";
import path from "node:path";
export async function DesktopDownloadPanel() {
  let version='';let installer='';
  try{
    const manifest=await readFile(path.join(process.cwd(),'public/desktop-updates/latest.yml'),'utf8');
    version=manifest.match(/^version:\s*["']?([\d.]+)/m)?.[1]??'';
    const filename=`KingPOS Portable Test-Setup-${version}.exe`;
    if(/^\d+\.\d+\.\d+$/.test(version))installer='/desktop-updates/'+encodeURIComponent(filename);
  }catch{/* No release has been published to this host. */}
  return <div className="settings-launch"><div>{installer?<a href={installer} download>↓ Download Windows app <small>v{version}</small></a>:<span>Windows download unavailable</span>}<a href="/pos/portable" target="_blank" rel="noreferrer">↗ Run Portable in browser</a></div><p>Use a POS ID to sign in. The Windows app keeps saved tickets on this computer.</p>{installer?<small>Local test edition · Requires the salon’s configured server.</small>:null}</div>;
}
