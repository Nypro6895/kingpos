import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const skip = !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH;

async function fixture(kind = 'login', { embedded = false, clock = false } = {}) {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const root = resolve('.').replaceAll('\\', '/');
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{Activity,useEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{LoginForm}from'${root}/app/login/login-form';import{SignupForm}from'${root}/app/signup/signup-form';
import{StaffInviteSignupForm}from'${root}/app/staff/invite/[token]/staff-invite-signup-form';
window.authRequests=[];window.callbacks=0;window.authOnline=true;window.nav={pushes:[],refreshes:0,fail:false};
Object.defineProperty(Navigator.prototype,'onLine',{get:()=>window.authOnline});
const originalFetch=window.fetch.bind(window);
window.fetch=(url,options={})=>{
 if(!String(url).startsWith('/api/'))return originalFetch(url,options);
 const request={url:String(url),method:options.method??'GET',signal:options.signal,body:options.body instanceof FormData?Object.fromEntries(options.body):options.body};
 window.authRequests.push(request);return new Promise((resolve,reject)=>{request.reply=(status,result)=>resolve(new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json'}}));request.fail=()=>reject(new TypeError('Fixture connection failure'));});
};
function App(){const[visible,setVisible]=useState(true);const[mounted,setMounted]=useState(true);useEffect(()=>{window.hideAuth=()=>setVisible(false);window.showAuth=()=>setVisible(true);window.removeAuth=()=>setMounted(false);},[]);return <><p data-fixture-state>{mounted?(visible?'visible':'hidden'):'removed'}</p>{mounted?<Activity mode={visible?'visible':'hidden'}>${kind === 'signup' ? '<SignupForm nextPath="/pos"/>' : kind === 'invite' ? '<StaffInviteSignupForm maskedEmail="f***@example.invalid" token="fixture-invite-token"/>' : `<LoginForm nextPath="/pos" ${embedded ? 'onAuthenticated={()=>{window.callbacks++;}}' : ''}/>`}</Activity>:null}</>;}
createRoot(document.getElementById('root')).render(<App/>);
` },
    jsx: 'automatic', bundle: true, write: false, platform: 'browser',
    plugins: [{ name: 'held-auth-service', setup(builder) {
      builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onResolve({ filter: /(?:^|\/)workspace-language$/ }, () => ({ path: 'language', namespace: 'fixture' }));
      builder.onResolve({ filter: /portable\/touch-keyboard$/ }, () => ({ path: 'keyboard', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: root, contents: ({
        'next/navigation': `export function useRouter(){return{push(href){if(window.nav.fail)throw Error('Fixture navigation cancelled');window.nav.pushes.push(href)},refresh(){window.nav.refreshes++}}}`,
        'next/link': `import React from'react';export default function Link(props){return <a {...props}/>}`,
        language: 'export const WorkspaceText=({text})=>text;export function useWorkspaceTranslation(){return value=>value;}',
        keyboard: 'export function PortableTouchKeyboard(){return null;}',
      })[args.path] }));
    } }],
  });
  let serviceRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text);
    } else if (request.url.startsWith('/api/')) {
      serviceRequests++; response.writeHead(503); response.end();
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<style>.hidden{display:none}[hidden]{display:none}button{padding:12px}input{display:block;margin:6px}</style><div id="root"></div><script src="/bundle.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  if (clock) await page.clock.install();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/' + kind);
  return { page, errors, async close() {
    assert.equal(serviceRequests, 0, 'no auth or security request reaches a real server');
    await browser.close(); await new Promise(resolve => server.close(resolve));
  } };
}

async function credentials(page, kind = 'login') {
  await page.getByLabel(kind === 'invite' ? 'Re-enter invited email' : 'Email', { exact: true }).fill('fixture@example.invalid');
  await page.getByLabel(kind === 'invite' ? 'Create password' : 'Password', { exact: true }).fill('Fixture password 123!');
}
async function count(page, expected) { await page.waitForFunction(expected => window.authRequests.length === expected, expected); }
async function reply(page, index, status, result) { await page.evaluate(({ index, status, result }) => window.authRequests[index].reply(status, result), { index, status, result }); }
async function burst(page) { await page.locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
async function busy(page, name) {
  const button = page.getByRole('button', { name, exact: true });
  await button.waitFor();
  assert.equal(await button.isDisabled(), true);
  assert.equal(await button.getAttribute('aria-busy'), 'true');
}

test('login paints immediate guarded feedback and keeps it through a delayed verified route handoff', { skip, timeout: 60_000 }, async () => {
  const app = await fixture('login', { clock: true });
  const { page } = app;
  try {
    await credentials(page);
    await burst(page);
    await count(page, 1);
    await busy(page, 'Logging in...');
    assert.equal(await page.locator('form').getAttribute('aria-busy'), 'true');
    await page.clock.fastForward(120_000);
    assert.equal(await page.evaluate(() => window.authRequests[0].signal.aborted), false, 'slow auth writes are not timed out or replayed');
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), []);
    await reply(page, 0, 200, { redirectTo: '/pos' });
    await busy(page, 'Opening your account...');
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), ['/pos']);
    assert.equal(await page.evaluate(() => window.nav.refreshes), 1);
    await burst(page);
    assert.equal(await page.evaluate(() => window.authRequests.length), 1, 'the guard remains active after the auth API finishes');
    await page.evaluate(() => window.removeAuth());
    await page.locator('[data-fixture-state]').filter({ hasText: 'removed' }).waitFor();
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('login failures and offline checks allow an explicit retry without duplicate or automatic requests', { skip, timeout: 60_000 }, async () => {
  const app = await fixture();
  const { page } = app;
  try {
    await credentials(page);
    await page.evaluate(() => { window.authOnline = false; });
    await burst(page);
    assert.equal(await page.evaluate(() => window.authRequests.length), 0);
    await page.getByRole('alert').waitFor();
    await page.evaluate(() => { window.authOnline = true; });
    await burst(page); await count(page, 1);
    await reply(page, 0, 401, { error: 'Fixture credentials rejected' });
    await page.getByText('Fixture credentials rejected', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Log in', exact: true }).isEnabled(), true);
    await burst(page); await count(page, 2);
    await page.evaluate(() => window.authRequests[1].fail());
    await page.getByRole('button', { name: 'Log in', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Log in', exact: true }).isEnabled(), true);
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'fixture@example.invalid');
    await page.evaluate(() => { window.nav.fail = true; });
    await burst(page); await count(page, 3);
    await reply(page, 2, 200, { redirectTo: '/pos' });
    await page.getByRole('button', { name: 'Log in', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Log in', exact: true }).isEnabled(), true, 'a cancelled synchronous handoff does not leave an unusable form');
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), []);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

const mfa = { challengeId: 'fixture-challenge', factorId: 'fixture-factor', factorType: 'totp', phone: null, expiresAt: null };
test('MFA remains unauthenticated until verified, guards duplicate verification, and preserves failure recovery', { skip, timeout: 60_000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    await credentials(page); await burst(page); await count(page, 1);
    await reply(page, 0, 200, { mfa });
    await page.getByLabel('Security code', { exact: true }).fill('123456');
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), []);
    assert.equal(await page.getByRole('button', { name: 'Use a different account', exact: true }).isEnabled(), true);
    await burst(page); await count(page, 2); await busy(page, 'Verifying...');
    assert.equal(await page.getByRole('button', { name: 'Use a different account', exact: true }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.authRequests[1].body), { code: '123456', factor_id: 'fixture-factor', challenge_id: 'fixture-challenge', next: '/pos' });
    await reply(page, 1, 400, { error: 'Fixture code rejected' });
    await page.getByText('Fixture code rejected', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Verify and log in', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: 'Use a different account', exact: true }).click();
    await credentials(page); await burst(page); await count(page, 3);
    await reply(page, 2, 200, { mfa });
    await page.getByLabel('Security code', { exact: true }).fill('654321');
    await burst(page); await count(page, 4);
    await reply(page, 3, 200, { redirectTo: '/pos' });
    await busy(page, 'Opening your account...');
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), ['/pos']);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('embedded login completion invokes its owner once and releases feedback when the owner keeps the form mounted', { skip, timeout: 60_000 }, async () => {
  const app = await fixture('login', { embedded: true }); const { page } = app;
  try {
    await credentials(page); await burst(page); await count(page, 1);
    await reply(page, 0, 200, {});
    await page.getByRole('button', { name: 'Log in', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Log in', exact: true }).isEnabled(), true);
    assert.equal(await page.evaluate(() => window.callbacks), 1);
    assert.equal(await page.evaluate(() => window.nav.refreshes), 1);
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), []);
    await burst(page); await count(page, 2); await reply(page, 1, 200, { mfa });
    await page.getByLabel('Security code', { exact: true }).fill('123456');
    await burst(page); await count(page, 3); await reply(page, 2, 200, {});
    await page.getByRole('button', { name: 'Verify and log in', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Verify and log in', exact: true }).isEnabled(), true);
    assert.equal(await page.evaluate(() => window.callbacks), 2);
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), []);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('signup guards slow writes, preserves verified handoff feedback, and recovers from API and navigation failure', { skip, timeout: 60_000 }, async () => {
  const app = await fixture('signup'); const { page } = app;
  try {
    await credentials(page); await burst(page); await count(page, 1); await busy(page, 'Creating...');
    await reply(page, 0, 400, { error: 'Fixture signup rejected' });
    await page.getByText('Fixture signup rejected', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create account', exact: true }).isEnabled(), true);
    await page.evaluate(() => { window.nav.fail = true; });
    await burst(page); await count(page, 2); await reply(page, 1, 200, { redirectTo: '/pos' });
    await page.getByRole('button', { name: 'Create account', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create account', exact: true }).isEnabled(), true);
    await page.evaluate(() => { window.nav.fail = false; });
    await burst(page); await count(page, 3); await reply(page, 2, 200, { redirectTo: '/pos' });
    await busy(page, 'Opening your account...'); await burst(page);
    assert.equal(await page.evaluate(() => window.authRequests.length), 3);
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), ['/pos']);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('signup security check retries account creation exactly once after an explicit verified challenge', { skip, timeout: 60_000 }, async () => {
  const app = await fixture('signup'); const { page } = app;
  try {
    await credentials(page); await burst(page); await count(page, 1);
    await reply(page, 0, 403, { challengeRequired: true, code: 'security_check_required' });
    await count(page, 2);
    assert.equal(await page.evaluate(() => window.authRequests[1].url), '/api/security/challenge');
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
    await reply(page, 1, 200, { id: 'fixture-security', image });
    await page.getByLabel('Characters in the image', { exact: true }).fill('ABC123');
    await burst(page); await count(page, 3);
    assert.equal(await page.evaluate(() => window.authRequests.filter(request => request.url === '/api/auth/signup').length), 1, 'showing or submitting a challenge does not replay signup before verification');
    await reply(page, 2, 200, { ok: true }); await count(page, 4);
    await busy(page, 'Creating...');
    assert.equal(await page.evaluate(() => window.authRequests[3].url), '/api/auth/signup');
    assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'fixture@example.invalid');
    await burst(page);
    assert.equal(await page.evaluate(() => window.authRequests.length), 4);
    await reply(page, 3, 200, { redirectTo: '/pos' });
    await busy(page, 'Opening your account...');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

for (const kind of ['login', 'signup']) test(`${kind} hides or unmounts cancel local feedback and cannot apply obsolete auth replies`, { skip, timeout: 60_000 }, async () => {
  const app = await fixture(kind); const { page } = app;
  try {
    await credentials(page); await burst(page); await count(page, 1);
    await page.evaluate(() => window.hideAuth());
    await page.locator('[data-fixture-state]').filter({ hasText: 'hidden' }).waitFor();
    assert.equal(await page.evaluate(() => window.authRequests[0].signal.aborted), true);
    await page.evaluate(() => window.showAuth());
    await page.getByRole('button', { name: kind === 'login' ? 'Log in' : 'Create account', exact: true }).waitFor();
    await burst(page); await count(page, 2);
    await reply(page, 0, 200, { redirectTo: '/obsolete-account' });
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), []);
    await busy(page, kind === 'login' ? 'Logging in...' : 'Creating...');
    await reply(page, 1, 400, { error: 'Fixture retry rejected' });
    await page.getByText('Fixture retry rejected', { exact: true }).waitFor();
    await burst(page); await count(page, 3);
    await page.evaluate(() => window.removeAuth());
    await page.locator('[data-fixture-state]').filter({ hasText: 'removed' }).waitFor();
    await reply(page, 2, 200, { redirectTo: '/late-account' });
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), []);
    assert.equal(await page.evaluate(() => window.callbacks), 0);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('staff invite signup preserves its token, guards retries, and retains feedback until verified route handoff', { skip, timeout: 60_000 }, async () => {
  const app = await fixture('invite'); const { page } = app;
  try {
    await credentials(page, 'invite'); await burst(page); await count(page, 1);
    await busy(page, 'Creating account...');
    assert.equal(await page.evaluate(() => window.authRequests[0].url), '/api/staff/invite/signup');
    assert.deepEqual(await page.evaluate(() => window.authRequests[0].body), { token: 'fixture-invite-token', email: 'fixture@example.invalid', password: 'Fixture password 123!' });
    await page.evaluate(() => window.hideAuth());
    await page.locator('[data-fixture-state]').filter({ hasText: 'hidden' }).waitFor();
    assert.equal(await page.evaluate(() => window.authRequests[0].signal.aborted), true);
    await page.evaluate(() => window.showAuth());
    await page.getByRole('button', { name: 'Create account and connect', exact: true }).waitFor();
    await burst(page); await count(page, 2);
    await reply(page, 0, 200, { redirectTo: '/obsolete-invite' });
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), []);
    await busy(page, 'Creating account...');
    await reply(page, 1, 400, { error: 'Fixture invite rejected' });
    await page.getByText('Fixture invite rejected', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create account and connect', exact: true }).isEnabled(), true);
    await burst(page); await count(page, 3); await reply(page, 2, 200, {});
    await busy(page, 'Opening your account...');
    await burst(page);
    assert.equal(await page.evaluate(() => window.authRequests.length), 3);
    assert.deepEqual(await page.evaluate(() => window.nav.pushes), ['/staff/connections']);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
