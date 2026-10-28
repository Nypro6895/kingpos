import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
let browser, server, base;
before(async () => {
  if (!executablePath) return;
  const bundle = await build({
    stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
      import React,{Activity,useEffect,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {SettingContent} from './app/settings/setting-content';
      window.calls={profile:0,blocked:0,connections:0};window.live={};
      function Panel({name}){
        const [draft,setDraft]=useState('');
        useEffect(()=>{window.calls[name]++;window.live[name]=true;return()=>{window.live[name]=false}},[]);
        return <input aria-label={name+' draft'} value={draft} onChange={e=>setDraft(e.target.value)}/>;
      }
      function App(){
        const [selected,setSelected]=useState('profile'),[shown,setShown]=useState(true),[viewer,setViewer]=useState(1);
        return <><nav>{['profile','blocked','connections','owner'].map(n=><button key={n} onClick={()=>setSelected(n)}>{n}</button>)}
          <button onClick={()=>setShown(v=>!v)}>toggle page</button><button onClick={()=>setViewer(v=>v+1)}>change viewer</button></nav>
          <output data-selected={selected} data-shown={String(shown)} data-viewer={viewer}/>
          <Activity key={viewer} mode={shown?'visible':'hidden'}>{['profile','blocked','connections'].map(name=><SettingContent key={name} active={selected===name}><Panel name={name}/></SettingContent>)}</Activity></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` }, bundle: true, write: false, platform: 'browser', jsx: 'automatic',
  });
  server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

test('inactive retained sections do not restart readers when their parent page returns', { skip: !executablePath }, async t => {
  const page = await browser.newPage(); t.after(() => page.close()); await page.goto(base);
  await page.waitForFunction(() => window.calls.profile === 1);
  assert.deepEqual(await page.evaluate(() => window.calls), { profile: 1, blocked: 0, connections: 0 });
  for (const name of ['blocked', 'connections', 'owner']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForFunction(name => document.querySelector('output').dataset.selected === name, name);
  }
  await page.getByRole('button', { name: 'toggle page', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('output').dataset.shown === 'false');
  await page.getByRole('button', { name: 'toggle page', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('output').dataset.shown === 'true');
  assert.deepEqual(await page.evaluate(() => window.calls), { profile: 1, blocked: 1, connections: 1 });
  assert.equal(await page.evaluate(() => Object.values(window.live).some(Boolean)), false);
});

test('section reveal refreshes its own reader while retaining a draft and viewer change discards it', { skip: !executablePath }, async t => {
  const page = await browser.newPage(); t.after(() => page.close()); await page.goto(base);
  await page.waitForFunction(() => window.calls.profile === 1);
  await page.getByLabel('profile draft', { exact: true }).fill('QA unsaved draft');
  await page.getByRole('button', { name: 'blocked', exact: true }).click();
  await page.waitForFunction(() => window.calls.blocked === 1);
  await page.getByRole('button', { name: 'owner', exact: true }).click();
  await page.getByRole('button', { name: 'toggle page', exact: true }).click();
  await page.getByRole('button', { name: 'toggle page', exact: true }).click();
  await page.getByRole('button', { name: 'profile', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('output').dataset.selected === 'profile');
  assert.equal(await page.getByLabel('profile draft', { exact: true }).inputValue(), 'QA unsaved draft');
  assert.deepEqual(await page.evaluate(() => window.calls), { profile: 2, blocked: 1, connections: 0 });
  await page.getByRole('button', { name: 'change viewer', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('output').dataset.viewer === '2');
  assert.equal(await page.getByLabel('profile draft', { exact: true }).inputValue(), '');
  assert.deepEqual(await page.evaluate(() => window.calls), { profile: 3, blocked: 1, connections: 0 });
});

test('the actual Settings hub uses the retained section boundary', () => {
  const source = readFileSync('app/settings/settings-hub-client.tsx', 'utf8');
  assert.match(source, /import\s*\{\s*SettingContent\s*\}\s*from\s*["']\.\/setting-content["']/);
  assert.doesNotMatch(source, /function\s+SettingContent\s*\(/);
  assert.match(source, /<SettingContent active=\{active\}>\{i\.content\}<\/SettingContent>/);
});
