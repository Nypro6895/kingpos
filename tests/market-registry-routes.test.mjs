import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const optedIn = process.env.RUN_MARKET_REGISTRY_ROUTES === '1';
const allowed = new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','HOMEDRIVE','HOMEPATH','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS']);
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('built private pages deny unauthenticated access and never allow browser/shared caching', {
  skip: !optedIn && 'Opt in after an isolated production build with RUN_MARKET_REGISTRY_ROUTES=1.', timeout: 90000,
}, async t => {
  assert.ok(existsSync('.next/BUILD_ID'), 'Complete the isolated production build first.');
  for (const enabled of ['false','true']) {
    await t.test(`runtime feature flag ${enabled}`, async () => {
      const port = await freePort();
      // Do not inherit any live service configuration, credentials or background workers.
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
      Object.assign(env, { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', MARKET_PRIVATE_REGISTRY_ENABLED: enabled });
      const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
        env, windowsHide: true, stdio: ['ignore','pipe','pipe'],
      });
      let log = '';
      server.stdout.on('data', b => { log += b; });
      server.stderr.on('data', b => { log += b; });
      try {
        for (let attempt = 0; !log.includes('Ready in'); attempt++) {
          assert.equal(server.exitCode, null, 'Local Next server exited.');
          assert.ok(attempt < 60, 'Local Next startup timed out.');
          await delay(250);
        }
        for (const path of ['/developers/market','/market-review']) {
          const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
          assert.equal(response.status, 200);
          const control = response.headers.get('cache-control') || '';
          assert.match(control, /private/i);
          assert.match(control, /no-store/i);
          const html = await response.text();
          assert.match(html, enabled === 'false' ? /Private app review is not available/ : /Sign in with an account authorized for private app review/);
          assert.doesNotMatch(html, /<(?:input|textarea)\b[^>]*\bname="(?:displayName|description|reason)"/);
          assert.doesNotMatch(html, /market_registry_(?:save_draft|review)\(/);
        }
      } finally {
        server.kill();
        if (server.exitCode === null) await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(5000)]);
      }
    });
  }
});
