import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(executablePath);
async function fixture() {
  const output = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AppLocalHelp}from'./components/app-local-help';import{getAppLocalHelpGuide,APP_LOCAL_HELP_GUIDES}from'./lib/app-local-reference-content';
window.navigations=[];window.guide=slug=>getAppLocalHelpGuide(slug,'en');window.guideCount=APP_LOCAL_HELP_GUIDES.length;
function App(){const[state,setState]=useState({slug:undefined,language:'en',support:false});window.support=()=>setState({language:'en',support:true});function navigate(href){window.navigations.push(href);const url=new URL(href,location.origin);if(url.pathname==='/help'||url.pathname.startsWith('/help/')){history.pushState(null,'',href);setState({slug:url.pathname.split('/')[2],language:url.searchParams.get('lang')||'en',support:false})}}return <AppLocalHelp {...state} navigate={navigate}/>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': process.cwd() }, plugins: [{ name: 'fixture-styles', setup(builder) { builder.onLoad({ filter: /\.css$/ }, () => ({ loader: 'js', contents: 'export default {};' })); } }] });
  const requests = [];
  const server = createServer((request, response) => { requests.push({ method: request.method, path: request.url }); response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html'); response.end(request.url === '/bundle.js' ? output.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/help`); await page.getByRole('heading', { name: 'Reylumi Help' }).waitFor();
  return { page, requests, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}

test('full Help search, role filters, article sections and language navigation work without a network or Next router', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    await page.context().setOffline(true);
    const count = await page.evaluate(() => guideCount);
    assert.equal(await page.locator('[role="status"]').innerText(), 'Guides found: ' + count);
    await page.getByRole('searchbox').fill('unlikelymissingguide');
    assert.equal(await page.locator('[role="status"]').innerText(), 'Guides found: 0');
    await page.getByRole('button', { name: 'Reset search' }).click();
    await page.getByRole('button', { name: 'Salon owners', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Salon owners', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('link', { name: /Owner Tips: run your first salon day/ }).first().click();
    await page.getByRole('heading', { name: 'Owner Tips: run your first salon day', exact: true }).waitFor();
    const guide = await page.evaluate(() => window.guide('owner-tips'));
    for (const section of guide.sections) {
      await page.getByRole('heading', { name: section.title, exact: true }).waitFor();
      assert.ok((await page.locator('main').innerText()).includes(section.check));
      assert.ok((await page.locator('main').innerText()).includes(section.example));
    }
    assert.equal(await page.locator('#steps ol > li').count(), guide.steps.length);
    assert.equal(await page.locator('picture').count(), guide.evidence.screenshots.length);
    await page.getByRole('button', { name: 'Tiếng Việt', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('main').lang === 'vi');
    assert.match(await page.locator('picture img').first().getAttribute('src'), /\/vi\//);
    assert.ok(await page.evaluate(() => navigations.at(-1).includes('lang=vi')));
    assert.ok(app.requests.every(request => request.method === 'GET'));
    assert.ok(!app.requests.some(request => request.path.startsWith('/api/')));
  } finally { await app.close(); }
});

test('offline Support instructions show full public guidance and require explicit navigation for requests or recovery', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); const { page } = app;
  try {
    await page.context().setOffline(true); await page.evaluate(() => window.support());
    await page.getByRole('heading', { name: 'Report / Contact' }).waitFor();
    await page.getByRole('heading', { name: 'Send a request', exact: true }).waitFor();
    assert.ok((await page.locator('main').innerText()).includes('confirmation from the server'));
    assert.equal(await page.locator('form,input[type=password]').count(), 0);
    assert.equal(await page.evaluate(() => navigations.length), 0);
    await page.getByRole('link', { name: 'Account access', exact: true }).click();
    assert.equal(await page.evaluate(() => navigations.at(-1)), '/account-recovery');
    assert.ok(app.requests.every(request => request.method === 'GET'));
  } finally { await app.close(); }
});
