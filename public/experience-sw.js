/* Public images plus explicitly prepared authorized offline documents. */
importScripts('/experience-offline-worker.js');
self.installExperienceOfflineShell();
const MEDIA_CACHE = "reylumi-experience-media-v1";
const INDEX_KEY = new URL("/__experience-media__/index", self.location.origin).href;
const MAX_ENTRIES = 160;
const MAX_BYTES = 48 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const BUCKETS = new Set(["account-avatars", "beauty-profile-media", "salon-profile-media"]);
const UUID_IMAGE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:webp|png|jpe?g|avif)$/i;
const OPERATIONAL_PATH = /^\/(?:pos|tax-company|admin|api|auth|login|signup|staff|support|settings|salon-settings|book|booking|bookings|booking-payment|booking-setup|my-bookings|check-in|visit|market|account|account-recovery|forgot-password|reset-password|security-check|customers|payroll|payments|permissions|roles|ownership|accept-invite)(?:\/|$)/;
let writes = Promise.resolve();
let persistingImages = 0;
let mediaOrigin = "";
try {
  const configured = new URL(new URL(self.location.href).searchParams.get("mediaOrigin"));
  if (configured.protocol === "https:" && !configured.username && !configured.password) mediaOrigin = configured.origin;
} catch { /* An unconfigured worker leaves all requests untouched. */ }

function serialized(operation) {
  const result = writes.catch(() => {}).then(operation);
  writes = result.catch(() => {});
  return result;
}

function publicVersionedImage(url) {
  if (!mediaOrigin || url.origin !== mediaOrigin || url.search || url.hash || url.username || url.password) return false;
  const parts = url.pathname.split("/");
  if (parts.slice(0, 5).join("/") !== "/storage/v1/object/public" || !BUCKETS.has(parts[5])) return false;
  // Uploads use a new UUID filename, with upsert disabled, when an image changes.
  if (!UUID_IMAGE.test(parts.at(-1)) || parts.length < 8) return false;
  return parts.slice(6).every((part) => part && !/%(?:2f|5c|2e)/i.test(part) && part !== "." && part !== "..");
}

function eligibleRequest(request) {
  if (request.method !== "GET" || request.destination !== "image" || request.headers.has("authorization") || request.headers.has("range")) return false;
  if (["no-store", "reload", "no-cache"].includes(request.cache)) return false;
  const url = new URL(request.url);
  if (publicVersionedImage(url)) return true;
  if (url.origin !== self.location.origin || url.pathname !== "/_next/image" || url.hash) return false;
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 3 || new Set(keys).size !== 3 || keys.some((key) => !["url", "w", "q"].includes(key))) return false;
  if (!/^\d+$/.test(url.searchParams.get("w")) || !/^\d+$/.test(url.searchParams.get("q"))) return false;
  const width = Number(url.searchParams.get("w")), quality = Number(url.searchParams.get("q"));
  if (width < 1 || width > 4096 || quality < 1 || quality > 100) return false;
  try { return publicVersionedImage(new URL(url.searchParams.get("url"))); } catch { return false; }
}

function imageKey(request) {
  const key = new URL("/__experience-media__/image", self.location.origin);
  key.searchParams.set("url", request.url);
  // Next image responses vary by Accept. Keep WebP and AVIF in separate entries.
  key.searchParams.set("accept", request.headers.get("accept") || "");
  return new Request(key.href, { headers: { Accept: request.headers.get("accept") || "" } });
}

async function readIndex(cache) {
  const response = await cache.match(INDEX_KEY);
  if (!response) return [];
  try {
    const rows = await response.json();
    return Array.isArray(rows) ? rows.filter((row) => typeof row.key === "string" && row.key.startsWith(self.location.origin + "/__experience-media__/image?") && Number.isFinite(row.usedAt) && Number.isFinite(row.expiresAt) && Number.isFinite(row.bytes) && row.bytes > 0 && row.bytes <= MAX_IMAGE_BYTES) : [];
  } catch { return []; }
}

async function saveIndex(cache, rows) {
  await cache.put(INDEX_KEY, new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } }));
}

async function trim(cache, rows) {
  const now = Date.now();
  const live = [];
  for (const row of rows) {
    if (row.expiresAt <= now) await cache.delete(row.key);
    else live.push(row);
  }
  live.sort((a, b) => a.usedAt - b.usedAt);
  let bytes = live.reduce((total, row) => total + row.bytes, 0);
  while (live.length > MAX_ENTRIES || bytes > MAX_BYTES) {
    const oldest = live.shift();
    bytes -= oldest.bytes;
    await cache.delete(oldest.key);
  }
  return live;
}

async function cachedImage(request) {
  return serialized(async () => {
    const cache = await caches.open(MEDIA_CACHE);
    const key = imageKey(request);
    const rows = await readIndex(cache);
    const row = rows.find((entry) => entry.key === key.url);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      await cache.delete(key);
      await saveIndex(cache, rows.filter((entry) => entry !== row));
      return null;
    }
    const response = await cache.match(key);
    if (!response) return null;
    row.usedAt = Date.now();
    await saveIndex(cache, rows);
    return response;
  });
}

function responseLifetime(response) {
  // Opaque images cannot expose no-store, status or size. Keep their normal HTTP cache.
  if (!response.ok || response.status !== 200 || response.type === "opaque" || response.type === "opaqueredirect") return 0;
  const control = response.headers.get("cache-control") || "";
  if (/(?:^|,)\s*(?:no-store|no-cache|private)(?:\s|,|=|$)/i.test(control) || response.headers.has("set-cookie")) return 0;
  if (!/^image\/(?:avif|webp|png|jpeg)(?:;|$)/i.test(response.headers.get("content-type") || "")) return 0;
  if ((response.headers.get("vary") || "").split(",").some((value) => value.trim() === "*")) return 0;
  const maxAge = control.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i);
  const age = Math.max(0, Number(response.headers.get("age")) || 0);
  return Math.min(MAX_AGE, maxAge ? Math.max(0, Number(maxAge[1]) - age) * 1000 : MAX_AGE);
}

async function storeImage(request, response) {
  const lifetime = responseLifetime(response);
  if (!lifetime || !response.body || Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) return;
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_IMAGE_BYTES) { void reader.cancel().catch(() => {}); return; }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  if (!bytes) return;
  const stored = new Response(new Blob(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
  await serialized(async () => {
    const cache = await caches.open(MEDIA_CACHE);
    const key = imageKey(request);
    const now = Date.now();
    const rows = (await readIndex(cache)).filter((row) => row.key !== key.url);
    try {
      await cache.put(key, stored);
      rows.push({ key: key.url, usedAt: now, expiresAt: now + lifetime, bytes });
      await saveIndex(cache, await trim(cache, rows));
    } catch (error) {
      // A failed index write must not leave uncounted images consuming storage.
      await cache.delete(key).catch(() => {});
      throw error;
    }
  });
}

// Default worker lifecycle avoids taking over existing tabs or scoped POS workers.
self.addEventListener("activate", (event) => {
  event.waitUntil(serialized(async () => {
    const cache = await caches.open(MEDIA_CACHE);
    const rows = await trim(cache, await readIndex(cache));
    const retained = new Set([INDEX_KEY, ...rows.map((row) => row.key)]);
    for (const key of await cache.keys()) if (!retained.has(key.url)) await cache.delete(key);
    await saveIndex(cache, rows);
  }).catch(() => {}));
});

self.addEventListener("fetch", (event) => {
  if (!eligibleRequest(event.request)) return;
  // Register the lifetime promise synchronously, including work after fetch resolves.
  let finish;
  event.waitUntil(new Promise((resolve) => { finish = resolve; }));
  event.respondWith((async () => {
    try {
      if (event.clientId) {
        let client;
        try { client = await self.clients.get(event.clientId); } catch { return await fetch(event.request); }
        if (!client || new URL(client.url).origin !== self.location.origin || OPERATIONAL_PATH.test(new URL(client.url).pathname)) return await fetch(event.request);
      } else return await fetch(event.request);
      let cached;
      try { cached = await cachedImage(event.request); } catch { /* Storage denied/full. */ }
      if (cached) return cached;
      const response = await fetch(event.request);
      // Avoid teeing bodies we cannot store, and bound temporary memory on phones.
      if (persistingImages < 2 && response.body && responseLifetime(response) > 0 && Number(response.headers.get("content-length")) <= MAX_IMAGE_BYTES) {
        const copy = response.clone();
        persistingImages += 1;
        const complete = finish;
        // Store the response already fetched for the image, without another download.
        void storeImage(event.request, copy).catch(() => {}).finally(() => {
          persistingImages -= 1;
          complete();
        });
        finish = null;
      }
      return response;
    } finally { if (finish) finish(); }
  })());
});
