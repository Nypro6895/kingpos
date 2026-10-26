'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const ROOT = '/pos/portable';
// An installed, authorized workspace is not a time-limited browser cache.
// Publish a complete generation atomically; never cache API responses or POSTs.
class OfflineShell {
  constructor(directory, codec, origin, fetcher) {
    mkdirSync(directory, { recursive: true });
    this.codec = codec; this.origin = origin; this.fetcher = fetcher; this.epoch = 0;
    this.pending = Promise.resolve();
    this.db = new DatabaseSync(join(directory, 'workspace.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS resources(url TEXT PRIMARY KEY,body BLOB NOT NULL); CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,body BLOB NOT NULL);');
  }
  encode(value) { return this.codec.encryptString(JSON.stringify(value)); }
  decode(value) { return JSON.parse(this.codec.decryptString(Buffer.from(value))); }
  meta(key) { const row = this.db.prepare('SELECT body FROM metadata WHERE key=?').get(key); return row ? this.decode(row.body) : null; }
  setMeta(key, value) { this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(key, this.encode(value)); }
  lock() { this.epoch++; this.db.exec("DELETE FROM resources; DELETE FROM metadata;"); }
  cached(path) { const row = this.db.prepare('SELECT body FROM resources WHERE url=?').get(path); return row ? this.decode(row.body) : null; }
  response(path) { const value = this.cached(path); return value ? new Response(Buffer.from(value.body, 'base64'), { headers: value.headers }) : null; }
  prepare(scope, assets = [], displayPath) {
    const epoch = this.epoch;
    const task = this.pending.catch(() => {}).then(() => this.capture(scope, assets, displayPath, epoch));
    this.pending = task;
    return task;
  }
  async capture(scope, assets, displayPath, epoch) {
    if (typeof scope !== 'string' || !scope || scope.length > 512 || epoch !== this.epoch) return;
    if (this.meta('scope') && this.meta('scope') !== scope) { this.lock(); epoch = this.epoch; }
    let path = ROOT;
    if (displayPath) {
      const url = new URL(displayPath, this.origin);
      if (url.origin !== this.origin || url.pathname !== '/pos/customer-display' || !url.searchParams.get('token')) throw Error('Invalid screen');
      path = url.pathname + url.search;
      if (!this.cached(ROOT)) await this.capture(scope, assets, undefined, epoch);
      if (!this.cached(ROOT) || epoch !== this.epoch) return;
    }
    const fetch = url => this.fetcher(new Request(new URL(url, this.origin), { headers: { Accept: url === path ? 'text/html' : '*/*' }, credentials: 'include', cache: url === path ? 'no-store' : 'default', signal: AbortSignal.timeout(20000) }));
    const prepared=this.meta('prepared');
    const renew=prepared?.scope!==scope || !this.cached(path) || Date.now()-(prepared?.paths?.[path] ?? 0)>=300000;
    let response,html='';
    if(renew){
      response=await fetch(path);
      if(!response.ok)throw Error('Workspace unavailable');
      html=await response.text();
      if(!html.includes(path===ROOT?'data-portable-pos-shell':'data-customer-display-shell')){
        if(path===ROOT && epoch===this.epoch)this.lock();
        return;
      }
    }
    const urls = new Set();
    for (const value of [...(html.match(/\/_next\/static\/[^"\s<>\\]+/g) || []), ...assets]) {
      const url = new URL(value.replaceAll('&amp;', '&'), this.origin);
      if (url.origin === this.origin && url.pathname.startsWith('/_next/static/')) urls.add(url.pathname + url.search);
    }
    const pack = (body, headers) => ({ body: Buffer.from(body).toString('base64'), headers: { 'content-type': headers.get('content-type') || 'application/octet-stream', ...(headers.get('content-security-policy') ? { 'content-security-policy': headers.get('content-security-policy') } : {}) } });
    const rows = renew ? [[path, pack(html, response.headers)]] : [];
    // Bounded concurrency avoids starving POS traffic while preparing the app.
    const list = [...urls];
    for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(async url => {
      if(this.cached(url))return;
      const asset = await fetch(url);
      if (!asset.ok) throw Error('App file unavailable');
      rows.push([url, pack(await asset.arrayBuffer(), asset.headers)]);
    }));
    if (epoch !== this.epoch) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const write = this.db.prepare('INSERT OR REPLACE INTO resources VALUES(?,?)');
      for (const [url, value] of rows) write.run(url, this.encode(value));
      this.setMeta('scope', scope);
      if(renew)this.setMeta('prepared',{scope,paths:{...(prepared?.scope===scope?prepared.paths:{}),[path]:Date.now()}});
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async handle(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== this.origin) return this.fetcher(request);
    const path = url.pathname + url.search;
    const asset = url.pathname.startsWith('/_next/static/');
    const html = request.headers.get('accept')?.includes('text/html');
    const root = html && (url.pathname === ROOT || url.pathname.startsWith(ROOT + '/'));
    const display = html && url.pathname === '/pos/customer-display';
    if (!asset && !root && !display) return this.fetcher(request);
    // Hashed application files are immutable and safe to serve locally.
    if (asset) { const cached = this.response(path); if (cached) return cached; }
    try {
      const response = await this.fetcher(new Request(request, { signal: AbortSignal.timeout(this.cached(root ? ROOT : path) ? 4000 : 30000) }));
      if (response.status >= 500) throw Error('Server unavailable');
      if (root && response.ok && !(await response.clone().text()).includes('data-portable-pos-shell')) this.lock();
      return response;
    } catch (error) {
      if (root && path !== ROOT && this.cached(ROOT)) return Response.redirect(this.origin + ROOT);
      const cached = this.response(root ? ROOT : path);
      if (cached) return cached;
      throw error;
    }
  }
  close() { this.epoch++; this.db.close(); }
}
module.exports = { OfflineShell };
