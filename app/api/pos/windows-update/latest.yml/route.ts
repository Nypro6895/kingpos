import { getWindowsPosRelease } from '@/lib/windows-pos-release';

export async function GET() {
  const release = await getWindowsPosRelease();
  const sha512 = process.env.WINDOWS_POS_DOWNLOAD_SHA512?.trim();
  const size = Number(process.env.WINDOWS_POS_DOWNLOAD_SIZE);
  // Fail closed until the release coordinator pins the exact published binary.
  // JSON is a YAML subset and avoids interpolation into executable metadata.
  if (!release || release.edition !== 'release' || !sha512 ||
    !/^[A-Za-z0-9+/]{86}==$/.test(sha512) ||
    !Number.isSafeInteger(size) || size <= 0 || size > 512 * 1024 * 1024) {
    return new Response('Windows update information is temporarily unavailable.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json({ version: release.version, path: '/download/windows', sha512,
    files: [{ url: '/download/windows', sha512, size }] },
  { headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/yaml' } });
}
