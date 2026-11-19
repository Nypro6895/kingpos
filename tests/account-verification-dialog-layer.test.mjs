import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const artifactDir = 'artifacts/account-verification-dialog-layer-20261114';
const captureBaseline = process.env.CAPTURE_DIALOG_BASELINE === '1';
const executablePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const fixtureUser = {
  id: 'fixture-account', auth_user_id: 'fixture-auth', display_name: 'Alex Nguyen',
  first_name: 'Alex', last_name: 'Nguyen', email: 'alex@example.test', phone: null,
  language: 'en', timezone: 'America/Chicago', created_at: '2026-01-01',
  avatar_url: null, status: 'active',
};

async function buildFixture() {
  const baselineSource = captureBaseline
    ? execFileSync('git', ['show', '830f0a6:app/account/account-profile-editor.tsx'], {encoding: 'utf8'})
    : null;
  const mocks = {
    'next/navigation': `
      import {useSyncExternalStore} from 'react';
      const subscribe=changed=>{window.addEventListener('popstate',changed);return()=>window.removeEventListener('popstate',changed)};
      export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname,()=>'/account');
      export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search,()=>''));
      const navigate=(url,replace=false)=>{history[replace?'replaceState':'pushState']({},'',url);window.dispatchEvent(new PopStateEvent('popstate'))};
      const router={refresh(){window.calls.push({action:'refresh'})},push(url){navigate(url)},replace(url){navigate(url,true)}};
      export const useRouter=()=>router;
    `,
    'next/link': `import React from 'react';export default function Link(props){return <a {...props}/>}`,
    '@/app/settings/language-actions': `export async function languageAction(){throw Error('Unexpected language mutation in fixture')}`,
    '@/app/account/actions': `
      export async function updateAccountProfileAction(payload){window.calls.push({action:'profile',payload});return {error:null,phoneClaim:{status:'verification_required',normalizedPhone:payload.phone,canSendOtp:true,resendCooldownSeconds:0}}}
      export async function getAccountAvatarUploadSessionAction(){throw Error('Unexpected upload in fixture')}
      export async function sendAccountPhoneVerificationOtpAction(payload){window.calls.push({action:'sms',payload});return window.failSms?{error:'Verification code could not be sent. Please try again.'}:{error:null,resendAfterSeconds:0}}
      export async function verifyAccountPhoneOtpAction(payload){window.calls.push({action:'verify',payload});return {error:'Fixture code is not valid.'}}
    `,
    '@/app/account/phone-change-actions': `
      export async function authorizePhoneChangeAction(payload){window.calls.push({action:'email',payload});return {error:null,...(payload.code?{verified:true}:{sent:true})}}
    `,
  };
  const fixture = `
    import React,{Activity,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {AccountProfileEditor} from './app/account/account-profile-editor';
    import {OverlayDismissal} from './components/overlay-dismissal';
    window.calls=[];window.failSms=true;
    function App(){
      const [hidden,setHidden]=useState(false),[revision,setRevision]=useState(0),[user,setUser]=useState(${JSON.stringify(fixtureUser)});
      window.fixtureReset=phone=>flushSync(()=>{setHidden(false);setRevision(v=>v+1);setUser({...${JSON.stringify(fixtureUser)},phone});window.calls=[];window.failSms=true});
      window.fixtureHide=()=>flushSync(()=>setHidden(true));
      window.fixtureReveal=()=>flushSync(()=>setHidden(false));
      window.fixtureNavigate=url=>flushSync(()=>{history.pushState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'))});
      return <><OverlayDismissal/><div className="settings-style"><div className="settings-hub"><div className="settings-inline-editor"><Activity mode={hidden?'hidden':'visible'}><AccountProfileEditor key={revision} user={user} createdAtLabel="Jan 1, 2026" embedded/></Activity></div></div></div><nav className="workspace-mobile-nav" aria-label="Fixture footer"><button type="button">Footer action</button></nav></>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  const built = await build({
    stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: fixture},
    bundle: true, write: false, outdir: 'fixture', jsx: 'automatic',
    plugins: [{name: 'offline-account-fixture', setup(b) {
      b.onResolve({filter: /.*/}, a => Object.hasOwn(mocks, a.path) ? {path: a.path, namespace: 'fixture'} : undefined);
      b.onLoad({filter: /.*/, namespace: 'fixture'}, a => ({contents: mocks[a.path], loader: 'tsx', resolveDir: process.cwd()}));
      if (baselineSource) b.onLoad({filter: /app[\\/]account[\\/]account-profile-editor\.tsx$/}, () => ({contents: baselineSource, loader: 'tsx', resolveDir: path.resolve('app/account')}));
    }}],
  });
  const css = (await postcss([tailwind()]).process(readFileSync('app/globals.css', 'utf8'), {
    from: path.resolve('app/globals.css'),
  })).css + '\n' + [
    'app/settings/settings-hub.css', 'app/settings/settings-controls.css',
    'components/iphone-glass-nav.css',
  ].map(p => readFileSync(p, 'utf8')).join('\n') + '\n' + built.outputFiles.filter(f => f.path.endsWith('.css')).map(f=>f.text).join('\n') + `
    body{margin:0;font-family:Arial,sans-serif}
    .workspace-mobile-nav{position:fixed;inset:auto 0 0;height:80px;z-index:60;background:#fff;border-top:1px solid #ddd;display:flex;align-items:center;justify-content:center}
  `;
  const js = built.outputFiles.find(f => f.path.endsWith('.js')).text;
  mkdirSync(artifactDir, {recursive: true});
  writeFileSync(artifactDir + '/fixture.js', js);
  writeFileSync(artifactDir + '/fixture.css', css);
  return {js, css};
}

async function newFixturePage(browser, fixture, viewport) {
  const page = await browser.newPage({viewport});
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(5000);
  const errors = [], unexpectedRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://account-fixture.test') {
      unexpectedRequests.push(route.request().url());
      return route.abort();
    }
    return route.fulfill({
      contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html',
      body: url.pathname.endsWith('.js') ? fixture.js : `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${fixture.css}</style><div id="root"></div><script src="/fixture.js"></script>`,
    });
  });
  await page.goto('http://account-fixture.test/account');
  await page.getByRole('button', {name: 'Edit', exact: true}).waitFor();
  return {page, errors, unexpectedRequests};
}

async function editPhone(page) {
  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await page.getByLabel('Display name', {exact: true}).fill('Preserved draft');
  await page.getByLabel('Phone', {exact: true}).fill('+14145550200');
  await page.getByRole('button', {name: 'Save profile', exact: true}).click();
}

async function hitTest(locator) {
  return locator.evaluate(element => {
    const r = element.getBoundingClientRect();
    const point = {x: r.left + r.width / 2, y: r.top + r.height / 2};
    const hit = document.elementFromPoint(point.x, point.y);
    return {receivesClick: hit === element || element.contains(hit), point, box: r.toJSON(), hit: hit?.tagName};
  });
}

async function assertLayer(page, dialog, action) {
  assert.equal(await dialog.evaluate(element => Boolean(element.closest('.settings-hub'))), false, 'dialog must escape the clipping settings hub');
  await action.scrollIntoViewIfNeeded();
  const metrics = await hitTest(action);
  assert.equal(metrics.receivesClick, true, JSON.stringify(metrics));
  const viewport = page.viewportSize();
  assert.ok(metrics.box.left >= 0 && metrics.box.right <= viewport.width, JSON.stringify(metrics));
  assert.ok(metrics.box.top >= 0 && metrics.box.bottom <= viewport.height, JSON.stringify(metrics));
  await action.click({trial: true});
}

test('account verification dialogs escape Settings clipping and remain interactive through local lifecycle', {
  skip: !executablePath, timeout: 120000,
}, async t => {
  const fixture = await buildFixture();
  const browser = await chromium.launch({executablePath, headless: true});
  const viewports = captureBaseline ? [{width:390,height:844}] : [
    {width:320,height:1000}, {width:390,height:844}, {width:430,height:932},
    {width:844,height:390}, {width:768,height:1024}, {width:1280,height:900},
  ];
  try {
    for (const viewport of viewports) {
      await t.test(`${viewport.width}x${viewport.height}`, async () => {
      const {page, errors, unexpectedRequests} = await newFixturePage(browser, fixture, viewport);
      const size = `${viewport.width}x${viewport.height}`;
      try {
        await editPhone(page);
        const otp = page.getByRole('dialog', {name: 'Verify phone number', exact: true});
        await otp.waitFor();
        const send = otp.getByRole('button', {name: 'Send code', exact: true});
        await page.screenshot({path: `${artifactDir}/${captureBaseline?'baseline':'fixed'}-initial-${size}.png`, fullPage: true});
        if (captureBaseline) {
          const hit = await hitTest(send);
          const hub = await page.locator('.settings-hub').evaluate(e => ({box:e.getBoundingClientRect().toJSON(),clipPath:getComputedStyle(e).clipPath}));
          assert.equal(hit.receivesClick, false, 'published source must reproduce the clipped button');
          writeFileSync(`${artifactDir}/baseline-hit-test.json`, JSON.stringify({viewport,hub,send:hit}, null, 2));
          return;
        }
        await assertLayer(page, otp, send);
        await send.click();
        await otp.getByText('Verification code could not be sent. Please try again.', {exact:true}).waitFor();
        await assertLayer(page, otp, send);
        await page.screenshot({path:`${artifactDir}/fixed-failed-${size}.png`,fullPage:true});
        assert.equal(await otp.getByLabel('Verification code', {exact:true}).count(), 0);
        await page.evaluate(() => {window.failSms=false});
        await send.click();
        const code = otp.getByLabel('Verification code', {exact:true});
        await code.fill('123');
        await code.press('4');
        assert.equal(await code.inputValue(), '1234');
        assert.equal(await code.evaluate(e => document.activeElement === e), true, 'typing rerenders must retain input focus');
        await code.press('5');await code.press('6');
        const verify = otp.getByRole('button', {name:'Verify',exact:true});
        await assertLayer(page, otp, verify);
        const resend = otp.getByRole('button', {name:'Resend code',exact:true});
        const close = otp.getByRole('button', {name:'Close',exact:true});
        await resend.focus();await page.keyboard.press('Tab');
        assert.equal(await close.evaluate(e=>document.activeElement===e),true,'Tab must remain inside the dialog');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await resend.evaluate(e=>document.activeElement===e),true,'Shift+Tab must wrap within the dialog');
        await verify.click();
        await otp.getByText('Fixture code is not valid.', {exact:true}).waitFor();
        await page.screenshot({path:`${artifactDir}/fixed-code-${size}.png`,fullPage:true});
        await page.keyboard.press('Escape');
        await otp.waitFor({state:'detached'});
        const openerRestored = await page.getByRole('button',{name:'Save profile',exact:true}).evaluate(e=>document.activeElement===e);
        assert.equal(await page.getByLabel('Display name',{exact:true}).inputValue(), 'Preserved draft');
        assert.equal(await page.getByLabel('Phone',{exact:true}).inputValue(), '+14145550200');
        await page.getByRole('button',{name:'Save profile',exact:true}).click();
        await otp.waitFor();await otp.getByRole('button',{name:'Close',exact:true}).click();await otp.waitFor({state:'detached'});
        await page.getByRole('button',{name:'Save profile',exact:true}).click();await otp.waitFor();
        await page.getByRole('button',{name:'Close phone verification',exact:true}).click({position:{x:2,y:2}});await otp.waitFor({state:'detached'});

        await page.evaluate(() => window.fixtureReset('+14145550100'));
        await editPhone(page);
        const email = page.getByRole('dialog',{name:'Verify phone change',exact:true});
        await email.waitFor();
        const sendEmail = email.getByRole('button',{name:'Send email code',exact:true});
        await assertLayer(page,email,sendEmail);await sendEmail.click();
        const emailCode = email.getByLabel('Email code',{exact:true});await emailCode.fill('123');await emailCode.press('4');
        assert.equal(await emailCode.evaluate(e=>document.activeElement===e),true);
        await page.screenshot({path:`${artifactDir}/fixed-email-${size}.png`,fullPage:true});
        await page.keyboard.press('Escape');await email.waitFor({state:'detached'});
        assert.equal(await page.getByLabel('Phone',{exact:true}).inputValue(),'+14145550200');
        assert.equal((await page.evaluate(()=>window.calls)).filter(c=>c.action==='profile').length,0,'email proof gate must block profile mutation');
        assert.equal(openerRestored,true,'dismissal must restore focus to the opener');
        assert.deepEqual(errors, []);
        assert.deepEqual(unexpectedRequests, []);
      } finally {await page.close();}
      });
    }
    if (captureBaseline) return;

    await t.test('route, hash, Back and Activity retain drafts without stale body overlays', async () => {
    const {page,errors,unexpectedRequests} = await newFixturePage(browser,fixture,{width:390,height:844});
    try {
      await editPhone(page);
      const dialog = page.getByRole('dialog',{name:'Verify phone number',exact:true});await dialog.waitFor();
      for (const target of ['/account#details','/other-route']) {
        await page.evaluate(url=>window.fixtureNavigate(url),target);
        await dialog.waitFor({state:'detached',timeout:3000});
        await page.goBack();
        await page.getByLabel('Phone',{exact:true}).waitFor();
        assert.equal(await dialog.count(),0,'Back must not resurrect stale verification');
        assert.equal(await page.getByLabel('Display name',{exact:true}).inputValue(),'Preserved draft');
        await page.getByRole('button',{name:'Save profile',exact:true}).click();await dialog.waitFor();
      }
      assert.equal(await page.evaluate(()=>{window.fixtureHide();return [...document.querySelectorAll('[data-account-verification-layer]')].filter(e=>!e.hidden&&e.getClientRects().length).length}),0,'Activity hide must synchronously hide retained body portals');
      await page.evaluate(()=>window.fixtureReveal());
      await page.getByLabel('Phone',{exact:true}).waitFor();
      assert.equal(await dialog.count(),0,'Activity reveal must not resurrect stale verification');
      assert.equal(await page.getByLabel('Display name',{exact:true}).inputValue(),'Preserved draft');
      assert.equal(await page.getByLabel('Phone',{exact:true}).inputValue(),'+14145550200');
      assert.deepEqual(errors,[]);assert.deepEqual(unexpectedRequests,[]);
    } finally {await page.close();}
    });
  } finally {await browser.close();}
});
