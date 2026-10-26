import { getWindowsPosDownloadSource } from '@/lib/windows-pos-release';

export const maxDuration = 300;

async function download(request: Request, method: 'GET' | 'HEAD') {
  const release = await getWindowsPosDownloadSource();
  const unavailable = () => new Response('Windows installer is temporarily unavailable.', {
    status: 503, headers: { 'Cache-Control': 'no-store' },
  });
  if (!release) return unavailable();
  const source = new URL(release.href, request.url);
  if (source.origin === new URL(request.url).origin && source.pathname === '/download/windows') return unavailable();
  const headers = new Headers({ 'Accept-Encoding': 'identity' });
  for (const name of ['range', 'if-range']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    // Follow storage redirects on the server. Never send Location or storage
    // headers to the browser, including when upstream returns an error page.
    const upstream = await fetch(source, {
      method, headers, redirect: 'follow', cache: 'no-store', signal: request.signal,
    });
    if (![200, 206, 416].includes(upstream.status) ||
      (upstream.status !== 416 && /text\/html|application\/json/i.test(upstream.headers.get('content-type') || ''))) {
      await upstream.body?.cancel();
      return unavailable();
    }
    const responseHeaders = new Headers({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="KingPOS-Portable-Setup-${release.version}.exe"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of ['content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    // Stream without buffering the installer in function memory.
    return new Response(method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return unavailable(); }
}

export async function GET(request: Request) { return download(request, 'GET'); }
export async function HEAD(request: Request) { return download(request, 'HEAD'); }
