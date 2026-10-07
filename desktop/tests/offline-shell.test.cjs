const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { OfflineShell } = require('../offline-shell.cjs');
const codec = {encryptString: v => Buffer.from(v), decryptString: v => v.toString()};
test('native shell survives restart and long offline periods; failed preparation keeps complete generation; lock wins races', async () => {
  const directory = mkdtempSync(join(tmpdir(),'kingpos-shell-test-'));
  let offline = false, broken = false;
  const fetch = async request => {
    if (offline) throw Error('offline');
    if (request.url.includes('/_next/')) return new Response('window.loaded=true', {status:broken ? 503 : 200,headers:{'content-type':'text/javascript'}});
    return new Response(`<main data-portable-pos-shell>Ready</main><script src="/_next/static/${broken ? 'new-app.js' : 'app.js'}"></script>`, {headers:{'content-type':'text/html'}});
  };
  let shell = new OfflineShell(directory,codec,'https://pos.test',fetch);
  const request = path => new Request('https://pos.test'+path,{headers:{accept:'text/html'}});
  try {
    await shell.prepare('salon:key');
    broken = true;
    const originalNow=Date.now;Date.now=()=>originalNow()+300001;
    try {await assert.rejects(shell.prepare('salon:key'));}
    finally {Date.now=originalNow;}
    shell.close(); shell = new OfflineShell(directory,codec,'https://pos.test',fetch);
    offline = true;
    const now = Date.now; Date.now = () => now() + 400*86400000;
    try { assert.match(await (await shell.handle(request('/pos/portable'))).text(), /Ready/); }
    finally {Date.now = now;}
    assert.equal((await shell.handle(request('/pos/portable/book'))).status,302);
    assert.match(await (await shell.handle(new Request('https://pos.test/_next/static/app.js'))).text(),/loaded/);
    await assert.rejects(shell.handle(new Request('https://pos.test/api/pos/portable/operations',{method:'POST',body:'{}'})));
    const preparation = shell.prepare('salon:key'); shell.lock(); await preparation;
    await assert.rejects(shell.handle(request('/pos/portable')));
    offline = false; broken = false; await shell.prepare('new:scope');
    assert.equal(shell.meta('scope'),'new:scope');
  } finally {shell.close(); rmSync(directory,{recursive:true,force:true});}
});
