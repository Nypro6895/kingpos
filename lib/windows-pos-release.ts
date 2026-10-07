import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

export async function getWindowsPosRelease() {
  const downloadUrl = process.env.WINDOWS_POS_DOWNLOAD_URL?.trim();
  const downloadVersion = process.env.WINDOWS_POS_DOWNLOAD_VERSION?.trim();
  if (downloadUrl) {
    try {
      const url = new URL(downloadUrl);
      if (url.protocol !== 'https:' || url.username || url.password ||
        !downloadVersion || !/^\d+\.\d+\.\d+$/.test(downloadVersion)) return null;
      return { version: downloadVersion, href: url.href, edition: 'release' as const };
    } catch { return null; }
  }
  try {
    const manifest = await readFile(path.join(process.cwd(), 'public/desktop-updates/latest.yml'), 'utf8');
    const version = manifest.match(/^version:\s*["']?([\d.]+)/m)?.[1];
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return null;
    const filename = manifest.match(/^path:\s*["']?(.+?)["']?\s*$/m)?.[1];
    if (!filename || ![`KingPOS Portable-Setup-${version}.exe`, `KingPOS Portable Test-Setup-${version}.exe`].includes(filename)) return null;
    const edition = filename.includes(' Test-') ? 'test' as const : 'release' as const;
    if (process.env.NODE_ENV === 'production' && edition === 'test') return null;
    await access(path.join(process.cwd(), 'public/desktop-updates', filename));
    return { version, href: '/desktop-updates/' + encodeURIComponent(filename), edition };
  } catch { return null; }
}
