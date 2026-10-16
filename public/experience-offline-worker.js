/* Shared prepared-document boot. Never cache/replay APIs, RSC, actions or payments. */
self.installExperienceOfflineShell = function () {
  const realm = new URL(self.registration.scope).pathname.startsWith('/pos/') ? 'pos' : 'web';
  const PREFIX = 'reylumi-offline-' + realm + '-v1-', INDEX = PREFIX + 'index';
  const META = new URL('/__experience-offline__/' + realm, self.location.origin).href;
  const ASSETS = 'reylumi-offline-assets-v1-', DAY = 86400000, MAX_BYTES = 48 * 1024 * 1024;
  const ASSET_BINDING = new URL('/__experience-offline__/verified-assets', self.location.origin).href;
  let epoch = 0, locked = false, pending = Promise.resolve();
  const secret = /^(?:token|access_token|refresh_token|code|secret|signature|session|session_id|password|client_secret|payment|bookingStripe|checkout|payment_intent|payment_intent_client_secret|setup_intent|setup_intent_client_secret|redirect_status|key|invite|next|return_to)$/i;
  function pathKey(value) {
    try {
      if (!value || value.length > 2048 || /\\|%2f|%5c|%00/i.test(value)) return null;
      const url = new URL(value, self.location.origin), path = url.pathname.replace(/\/$/, '') || '/';
      if (url.origin !== self.location.origin || url.username || url.password || url.hash) return null;
      if (!/^(?:\/(?:pos(?:\/(?:ticket(?:\/[\w-]+)?|book|check-in|report|settings))?|pos\/portable(?:\/(?:ticket|book|check-in|report|today))?|staff\/(?:today|my-work|workday|appointments)|payroll|customers(?:\/[\w-]+)?|activity(?:\/receipts\/[\w-]+)?|my-bookings(?:\/[\w-]+)?|my-place|more(?:\/(?:saved-post|following))?|beauty|explore(?:\/favorites)?|market|notifications))$/.test(path)) return null;
      if (/(?:^|\/)(?:new|edit|create|delete|checkout|payment|setup)(?:\/|$)/.test(path)) return null;
      for (const [key, value] of url.searchParams) if (secret.test(key) || value.length > 512 || /(?:token|secret|password)=/i.test(value)) return null;
      if (path === '/market' && [...url.searchParams.keys()].some(key => !['q', 'category'].includes(key))) return null;
      url.searchParams.sort(); return path + url.search;
    } catch { return null; }
  }
  // Preserve the existing explicitly paired customer-display shell. Its bearer
  // URL never becomes a generic route hint or a persistent JSON read model.
  function displayKey(value) {
    try { const url = new URL(value, self.location.origin); return url.origin === self.location.origin && url.pathname === '/pos/customer-display' && !url.hash && [...url.searchParams.keys()].length === 1 && url.searchParams.has('token') && url.searchParams.get('token').length > 0 && url.searchParams.get('token').length <= 1024 ? url.pathname + url.search : null; } catch { return null; }
  }
  function valid(grant, path, generation) {
    if (/^\/staff\/(?:my-work|workday|appointments)(?:\?|$)/.test(path || '') || grant?.kind === 'staff') {
      const binding = grant?.staffBinding, uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (grant?.kind !== 'staff' || !binding || binding.version !== 1 || binding.revoked === true || ![binding.staffId, binding.viewerId, binding.salonId, binding.revision].every(value => typeof value === 'string' && uuid.test(value)) || binding.viewerId !== grant.viewerId || binding.salonId !== grant.salonId || !Number.isFinite(Date.parse(binding.approvedAt)) || Date.parse(binding.approvedAt) > Date.now() + 60000) return false;
    }
    return grant && grant.version === 1 && grant.path === path && typeof grant.scope === 'string' && grant.scope.length > 0 && grant.scope.length <= 8192
      && Array.isArray(grant.scopes) && grant.scopes.includes(grant.scope) && typeof grant.grantRevision === 'string'
      && typeof grant.generation === 'string' && /^[\w-]{16,100}$/.test(grant.generation) && (!generation || grant.generation === generation)
      && Number.isFinite(grant.issuedAt) && Number.isFinite(grant.expiresAt) && grant.issuedAt <= Date.now() + 60000
      && grant.expiresAt > Date.now() && grant.expiresAt > grant.issuedAt && grant.expiresAt - grant.issuedAt <= DAY;
  }
  async function metadata() { try { return await (await (await caches.open(INDEX)).match(META))?.json() || { entries: {} }; } catch { return { entries: {} }; } }
  async function save(value) { await (await caches.open(INDEX)).put(META, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })); }
  async function clear() { for (const name of await caches.keys()) if (name.startsWith(PREFIX) || name === 'kingpos-portable-shell-v1') await caches.delete(name); }
  async function lock() { epoch++; locked = true; await clear(); }
  async function broadcastClear(scope, status) { for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) client.postMessage({ kind: 'experience-offline-cleared', scope, status }); }
  const read = (url, timeout = 15000) => fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(timeout), priority: 'low' });
  const htmlAttribute = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  function assetUrl(value) { try { const url = new URL(value, self.location.origin); return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/') && !url.hash && !url.username && !url.password && !/%2f|%5c|\.\./i.test(url.pathname) ? url.href : null; } catch { return null; } }
  function deployedAsset(value) {
    try {
      const url = new URL(value, self.location.origin), id = url.searchParams.get('dpl'), name = url.pathname.split('/').pop();
      if (!assetUrl(url.href) || [...url.searchParams].length !== 1 || !/^[\w-]{1,32}$/.test(id || '') || !/\.(?:m?js|css|woff2?|ttf|otf)$/i.test(name) || !/(?:^|[-.])[a-f0-9]{8,64}(?=[-.]|$)/i.test(name)) return null;
      url.search = ''; return { url: url.href, deploymentId: id };
    } catch { return null; }
  }
  // Vercel can append this opt-in toolbar after Next generated its manifest.
  // Recognize only that exact deployment-bound suffix; never cache/execute it.
  function originalAsset(body, expected, path, deploymentId) {
    if (body.byteLength === expected.bytes) return body;
    if (!/^\/_next\/static\/chunks\/webpack-[a-f0-9]+\.js$/.test(path) || !/^dpl_[A-Za-z0-9]+$/.test(deploymentId || '')) throw new Error('Unexpected build asset bytes');
    const suffix = new TextEncoder().encode('\n;(function(){try{if(typeof document==="undefined"||!/(?:^|;\\s)__vercel_toolbar=1(?:;|$)/.test(document.cookie))return;}catch(e){return;}var s=document.createElement(\'script\');s.src=\'https://vercel.live/_next-live/feedback/feedback.js\';s.setAttribute("data-explicit-opt-in","true");s.setAttribute("data-cookie-opt-in","true");s.setAttribute("data-deployment-id",' + JSON.stringify(deploymentId) + ');((document.head||document.documentElement).appendChild(s))})();');
    if (body.byteLength !== expected.bytes + suffix.byteLength || !suffix.every((value, index) => new Uint8Array(body)[expected.bytes + index] === value)) throw new Error('Unexpected build asset suffix');
    return body.slice(0, expected.bytes);
  }
  async function completeEntry(entry, path, generation) {
    if (!entry || !valid(entry.grant, entry.authorityPath || path, generation) || !Array.isArray(entry.assets) || !entry.assets.length || !(await caches.keys()).includes(entry.assetCache)) return false;
    const cache = await caches.open(entry.assetCache), present = new Set((await cache.keys()).map(key => key.url));
    return entry.assets.every(url => present.has(url)) && Boolean(await (await caches.open(entry.cache)).match(path));
  }
  async function prepare(input) {
    const display = input.displayPath ? displayKey(input.displayPath) : null;
    if (input.displayPath && !display) return null;
    const path = display || pathKey(input.path || '/pos/portable'), authorityPath = display ? '/pos/portable' : path, started = input.epoch ?? epoch;
    if (started !== epoch) return null;
    if (!path || typeof input.generation !== 'string' || !/^[\w-]{16,100}$/.test(input.generation)) return null;
    const response = await read('/api/experience/offline-context?path=' + encodeURIComponent(authorityPath) + '&generation=' + encodeURIComponent(input.generation));
    if (response.status === 401 || response.status === 403) { await lock(); await broadcastClear(input.scope, response.status); return null; }
    if (!response.ok) {
      if (response.status === 503) {
        const unavailable = await response.json().catch(() => null), old = await metadata();
        if (started === epoch && unavailable?.offlineState === 'unconfirmed' && Object.values(old.entries).some(row => row.grant?.kind === 'staff' && row.grant.scopes.includes(unavailable.scope))) { await lock(); await broadcastClear(undefined, 409); }
      }
      return null;
    }
    const grant = await response.json();
    if (!valid(grant, authorityPath, input.generation) || started !== epoch) return null;
    if (grant.kind === 'portable' && grant.localCommands !== true) return null;
    if (input.scope && !grant.scopes.includes(input.scope)) { await lock(); await broadcastClear(input.scope, 409); return null; }
    let meta = await metadata();
    const identity = JSON.stringify([grant.viewerId, grant.scope, grant.generation]), authority = grant.kind === 'staff' ? 'staff' : grant.kind === 'portable' ? 'portable' : 'base';
    const revisions = { ...(meta.revisions || {}) };
    if (meta.identity && meta.identity !== identity || revisions[authority] && revisions[authority] !== grant.grantRevision) { await lock(); await broadcastClear(undefined, 409); return null; }
    revisions[authority] = grant.grantRevision;
    const previous = meta.entries[path];
    if (previous && Date.now() - previous.preparedAt < 60000 && await completeEntry(previous, path, input.generation)) return previous.grant;
    const [page, manifestResponse] = await Promise.all([read(path, 30000), read('/api/experience/offline-assets?path=' + encodeURIComponent(path))]);
    if (started !== epoch || !page.ok || !manifestResponse.ok || page.redirected && (display ? displayKey(page.url) : pathKey(page.url)) !== path) return null;
    const html = await page.text();
    if (html.length * 2 > 8 * 1024 * 1024 || !html.includes(display ? 'data-customer-display-shell' : 'data-experience-offline-scope="' + htmlAttribute(grant.scope) + '"')) return null;
    const manifest = await manifestResponse.json();
    if (typeof manifest.version !== 'string' || !/^[\w-]{8,128}$/.test(manifest.version) || !Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 600 || !Number.isFinite(manifest.totalBytes) || manifest.totalBytes > MAX_BYTES || !Array.isArray(manifest.files) || manifest.files.length !== manifest.assets.length) return null;
    if (manifest.deploymentId !== undefined && (typeof manifest.deploymentId !== 'string' || !/^[\w-]{1,32}$/.test(manifest.deploymentId))) return null;
    const files = new Map(manifest.files.map(file => [new URL(file.path, self.location.origin).pathname, file]));
    if (manifest.files.some(file => !assetUrl(file.path) || !Number.isFinite(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/.test(file.sha256))) return null;
    const assets = new Set(manifest.assets.map(assetUrl));
    for (const value of html.match(/\/_next\/static\/[^"\s<>\\]+/g) || []) assets.add(assetUrl(value.replaceAll('&amp;', '&')));
    for (const value of input.assets || []) { const url = assetUrl(value); if (url) assets.add(url); }
    if (assets.has(null) || assets.size > 700) return null;
    const assetName = ASSETS + manifest.version, assetCache = await caches.open(assetName), queue = [...assets];
    let cursor = 0, bytes = 0;
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (cursor < queue.length) {
        const url = queue[cursor++]; if (started !== epoch) throw new Error('Preparation superseded');
        const expected = files.get(new URL(url).pathname); if (!expected) throw new Error('Required asset is outside this build');
        const existing = await assetCache.match(url);
        if (existing && existing.headers.get('x-reylumi-sha256') === expected.sha256 && Number(existing.headers.get('x-reylumi-bytes')) === expected.bytes) { bytes += expected.bytes; if (bytes > MAX_BYTES) throw new Error('Asset budget exceeded'); continue; }
        const file = existing || await read(url, 30000); if (!file.ok || file.type === 'opaque') throw new Error('Required asset unavailable');
        const received = await file.arrayBuffer(), body = originalAsset(received, expected, new URL(url).pathname, manifest.deploymentId); bytes += body.byteLength; if (bytes > MAX_BYTES) throw new Error('Asset budget exceeded');
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', body))].map(value => value.toString(16).padStart(2, '0')).join('');
        if (body.byteLength !== expected.bytes || digest !== expected.sha256) throw new Error('Required asset does not match the verified build');
        if (started !== epoch) throw new Error('Preparation superseded');
        const fileHeaders = new Headers(file.headers); fileHeaders.delete('content-encoding'); fileHeaders.delete('content-length'); fileHeaders.set('x-reylumi-bytes', String(body.byteLength)); fileHeaders.set('x-reylumi-sha256', digest);
        if (body !== received) fileHeaders.delete('etag');
        await assetCache.put(url, new Response(body, { status: 200, headers: fileHeaders }));
      }
    }));
    if (started !== epoch || !valid(grant, authorityPath, input.generation)) return null;
    // Public build authority survives replacing a private page's snapshot.
    // Write it only after every required asset passed its byte/hash check.
    if (manifest.deploymentId) await assetCache.put(ASSET_BINDING, new Response(JSON.stringify({ version: 1, manifestVersion: manifest.version, deploymentId: manifest.deploymentId }), { headers: { 'Content-Type': 'application/json' } }));
    const pageName = PREFIX + 'page-' + crypto.randomUUID();
    try {
      const bootJson = JSON.stringify(grant).replaceAll('<', '\\u003c');
      const placeholder = /(<script\b[^>]*\bid=["']reylumi-offline-boot["'][^>]*>)[\s\S]*?(<\/script>)/;
      // The server supplies a hydration-safe prepaint guard in the head. Never
      // publish older markup without that guard, even if all chunks are cached.
      if (!placeholder.test(html) || !html.includes('id="reylumi-offline-bootstrap"') || !html.includes('id="reylumi-offline-guard"')) throw new Error('Offline bootstrap guard unavailable');
      const pageHeaders = new Headers(page.headers); pageHeaders.delete('content-length'); pageHeaders.delete('content-encoding'); pageHeaders.set('Content-Type', 'text/html; charset=utf-8'); pageHeaders.set('Cache-Control', 'private, no-store');
      const guardedHtml = html.replace(placeholder, (_, before, after) => before + bootJson + after).replace(/<style\b[^>]*\bid=["']reylumi-offline-guard["'][^>]*>/, tag => /\bmedia=/.test(tag) ? tag.replace(/\bmedia=["'][^"']*["']/, 'media="all"') : tag.replace('>', ' media="all">'));
      await (await caches.open(pageName)).put(path, new Response(guardedHtml, { headers: pageHeaders }));
      if (started !== epoch) { await caches.delete(pageName); return null; }
      meta = await metadata(); if (started !== epoch) { await caches.delete(pageName); return null; }
      const entries = Object.fromEntries(Object.entries(meta.entries || {}).filter(([, row]) => valid(row.grant, row.grant.path, input.generation)));
      entries[path] = { cache: pageName, assetCache: assetName, grant, authorityPath, deploymentId: manifest.deploymentId, assets: [...assets, ...(manifest.deploymentId ? [ASSET_BINDING] : [])], preparedAt: Date.now(), bytes: html.length * 2 };
      const ordered = Object.entries(entries).sort((a, b) => b[1].preparedAt - a[1].preparedAt);
      let htmlBytes = ordered.reduce((sum, [, row]) => sum + (row.bytes || 0), 0);
      while (ordered.length > 1 && (ordered.length > 16 || htmlBytes > 32 * 1024 * 1024)) htmlBytes -= ordered.pop()[1].bytes || 0;
      await save({ identity, revisions, entries: Object.fromEntries(ordered.slice(0, 16)) }); locked = false;
      const retained = new Set(ordered.slice(0, 16).map(([, row]) => row.cache));
      for (const name of await caches.keys()) if (name.startsWith(PREFIX + 'page-') && !retained.has(name)) await caches.delete(name);
      // Static code is public. Keep at most two complete build generations.
      const assetCaches = (await caches.keys()).filter(name => name.startsWith(ASSETS));
      for (const name of assetCaches.slice(0, Math.max(0, assetCaches.length - 2))) if (name !== assetName) await caches.delete(name);
      return grant;
    } catch (error) { await caches.delete(pageName); throw error; }
  }
  async function prepared(path, generation) {
    if (locked) return null;
    const entry = (await metadata()).entries[path];
    return await completeEntry(entry, path, generation) ? entry : null;
  }
  self.addEventListener('message', event => {
    const data = event.data || {}, port = event.ports?.[0];
    const reply = value => { try { port?.postMessage(value); } catch { /* The page may have closed. */ } };
    if (data.kind === 'portable-lock' || data.kind === 'experience-offline-lock') { event.waitUntil(lock().then(async () => { if ([401, 403, 409].includes(data.status)) await broadcastClear(undefined, data.status); reply({ ok: true }); })); return; }
    if (data.kind === 'experience-offline-has') { const path = pathKey(data.path); event.waitUntil((path ? prepared(path, data.generation) : Promise.resolve(null)).then(entry => reply({ ok: Boolean(entry), grant: entry?.grant }))); return; }
    if (data.kind === 'portable-prepare' || data.kind === 'experience-offline-prepare') {
      const messageEpoch = epoch;
      const run = pending.catch(() => {}).then(() => prepare({ ...data, epoch: messageEpoch })); pending = run.catch(() => {});
      event.waitUntil(run.then(grant => reply({ ok: Boolean(grant), grant })).catch(() => reply({ ok: false })));
    }
  });
  self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
  self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', event => {
    const request = event.request, url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('rsc') || url.searchParams.has('_rsc')) return;
    const path = request.mode === 'navigate' ? pathKey(url.href) || displayKey(url.href) : null, asset = assetUrl(url.href);
    if (!path && !asset) return;
    let finishBackground;
    const background = new Promise(resolve => { finishBackground = resolve; });
    event.waitUntil(background);
    event.respondWith((async () => {
      try {
      if (asset) {
        const deployed = deployedAsset(url.href), allowed = deployed ? new Set(Object.values((await metadata()).entries).filter(row => row.deploymentId === deployed.deploymentId).map(row => row.assetCache)) : new Set();
        for (const name of (await caches.keys()).filter(name => name.startsWith(ASSETS)).reverse()) {
          const cache = await caches.open(name);
          if (!url.search) { const exact = await cache.match(request); if (exact) return exact; }
          if (deployed) {
            const marker = await cache.match(ASSET_BINDING), binding = await marker?.json().catch(() => null);
            const matches = binding?.version === 1 && binding.manifestVersion === name.slice(ASSETS.length) && binding.deploymentId === deployed.deploymentId;
            if (matches || !marker && allowed.has(name)) { const response = await cache.match(request) || await cache.match(deployed.url); if (response && /^[a-f0-9]{64}$/.test(response.headers.get('x-reylumi-sha256') || '')) return response; }
          }
        }
        return self.navigator.onLine === false ? Response.error() : fetch(request);
      }
      const local = await prepared(path);
      if (local) {
        // A valid display lease renders immediately. Fresh server authority and
        // future complete HTML reconcile silently without replacing this DOM.
        if (self.navigator.onLine !== false) {
          const started = epoch;
          const run = pending.catch(() => {}).then(() => prepare({ path, displayPath: local.authorityPath !== path ? path : undefined, generation: local.grant.generation, scope: local.grant.scope, epoch: started }));
          pending = run.catch(() => {});
          const finish = finishBackground; finishBackground = null;
          void run.catch(() => {}).finally(finish);
        }
        return await (await caches.open(local.cache)).match(path) || Response.error();
      }
      try {
        if (self.navigator.onLine === false) throw new Error('Offline');
        const response = await fetch(request, { signal: AbortSignal.timeout(30000) });
        if (response.status >= 500) throw new Error('Unavailable');
        if (response.status === 401 || response.status === 403 || response.redirected && /\/(?:login|signup)(?:\?|$)/.test(response.url)) { await lock(); await broadcastClear(); }
        return response;
      } catch {
        const entry = await prepared(path);
        if (entry) return await (await caches.open(entry.cache)).match(path) || Response.error();
        return new Response('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reylumi</title><body style="font:16px system-ui;padding:32px"><h1>Reylumi</h1><p>Please connect to continue.</p><button onclick="location.reload()">Try again</button></body></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      } finally { if (finishBackground) finishBackground(); }
    })());
  });
};
