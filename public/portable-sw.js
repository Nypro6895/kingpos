/* Portable-only offline shell. Never cache mutations, APIs or payment requests. */
const CACHE = 'kingpos-portable-shell-v1';
const META = '/pos/__portable-cache-session';
const ROOT = '/pos/portable';
let preparing = Promise.resolve();
let locked = false;
async function metadata() {
  const cache = await caches.open(CACHE);
  const response = await cache.match(META);
  return response ? response.json() : null;
}
async function clear() { await caches.delete(CACHE); }
async function prepare(data) {
  let path = ROOT;
  if (data.displayPath) {
    const target = new URL(data.displayPath, self.location.origin);
    if (target.origin !== self.location.origin || target.pathname !== '/pos/customer-display' || !target.searchParams.get('token')) return;
    path = target.pathname + target.search;
  }
  const previous = await metadata();
  if (previous?.scope !== data.scope) await clear();
  // A display-first request must not publish readiness without the POS shell.
  if (path !== ROOT && !(await (await caches.open(CACHE)).match(ROOT))) {
    await prepare({ ...data, displayPath: undefined });
    if (!(await (await caches.open(CACHE)).match(ROOT))) return;
  }
  const existingCache = await caches.open(CACHE);
  if (previous?.scope === data.scope && Date.now() - (previous.preparedPaths?.[path] ?? (path === ROOT ? previous.preparedAt : 0)) < 300000 && await existingCache.match(path)) {
    // Cache newly visited chunks without regenerating the whole HTML snapshot.
    await Promise.all((data.assets || []).map(async value => {
      const url = new URL(value, self.location.origin);
      if (url.origin !== self.location.origin || !url.pathname.startsWith('/_next/static/') || await existingCache.match(url.href)) return;
      const asset = await fetch(url.href, {credentials:'same-origin'});
      if (asset.ok) await existingCache.put(url.href,asset);
    }));
    return;
  }
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', headers: { Accept: 'text/html' } });
  if (!response.ok) return;
  const html = await response.clone().text();
  if (!html.includes(path === ROOT ? 'data-portable-pos-shell' : 'data-customer-display-shell')) { if (path === ROOT) await clear(); return; }
  const assets = new Set((html.match(/\/_next\/static\/[^"\s<>\\]+/g) || []).map(value => value.replaceAll('&amp;', '&')));
  for (const value of data.assets || []) {
    const url = new URL(value, self.location.origin);
    if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) assets.add(url.href);
  }
  const cache = await caches.open(CACHE);
  // Publish the shell only after all required code has been cached.
  await Promise.all([...assets].map(async value => {
    if (await cache.match(value)) return;
    const asset = await fetch(value, { credentials: 'same-origin' });
    if (!asset.ok) throw new Error('Asset unavailable');
    await cache.put(value, asset);
  }));
  await cache.put(path, response);
  locked = false;
  const latest=await metadata();
  const at=Date.now();
  await cache.put(META, new Response(JSON.stringify({ scope:data.scope,
    preparedAt:path===ROOT?at:latest?.preparedAt,
    preparedPaths:{...(latest?.preparedPaths ?? {}),[path]:at},
  })));
}
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.kind === 'portable-lock') {
    locked = true;
    preparing = preparing.catch(() => {}).then(clear);
    event.waitUntil(preparing);
  }
  if (event.data?.kind === 'portable-prepare' && typeof event.data.scope === 'string') {
    preparing = preparing.catch(() => {}).then(() => prepare(event.data));
    event.waitUntil(preparing.catch(() => {}));
  }
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = request.mode === 'navigate' && (url.pathname === ROOT || url.pathname.startsWith(ROOT + '/'));
  const display = request.mode === 'navigate' && url.pathname === '/pos/customer-display' && url.searchParams.has('token');
  const asset = url.pathname.startsWith('/_next/static/');
  if (!navigation && !display && !asset) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request, { signal: AbortSignal.timeout(4000) });
      if (response.status >= 500) throw new Error("Server unavailable");
      if (navigation && response.ok && !(await response.clone().text()).includes("data-portable-pos-shell")) await clear();
      if (response.ok && asset) {
        const meta = await metadata();
        if (meta) await (await caches.open(CACHE)).put(request, response.clone());
      }
      return response;
    } catch {
      if (locked) return Response.error();
      const meta = await metadata();
      if (!meta) { await clear(); return Response.error(); }
      const cache = await caches.open(CACHE);
      if (navigation && (url.pathname !== ROOT || url.search)) return Response.redirect(new URL(ROOT, self.location.origin).href, 302);
      return (await cache.match(navigation ? ROOT : request)) || Response.error();
    }
  })());
});
