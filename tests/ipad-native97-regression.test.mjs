import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('current role remains actionable and pending blocks duplicate requests; Book highlights only the current top-level tab', async () => {
  const source=readFileSync('app/navigation-shell.tsx','utf8');
  const row=source.slice(source.indexOf('function CustomerWorkspaceRow('),source.indexOf('function useWorkspaceNavigationFeedback('));
  const bundle=await build({bundle:true,write:false,format:'iife',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    const useWorkspaceTranslation=()=>s=>s, customerWorkspaceLabel=w=>w.type, customerWorkspaceSubtitle=()=>'', personalOpenAction=()=>({href:'/beauty'}), workspaceOpenAction=()=>({href:'/staff/today'}), actionKey=w=>w.id, workspaceAvatarClass=()=>'';
    const WorkspaceAvatar=()=>null, Icon=()=>null, WorkspaceText=({text})=>text, WorkspaceMemberName=({name})=>name;
    ${row}
    window.calls=[]; const root=createRoot(document.getElementById('root'));
    window.show=(type,pendingKey=null)=>root.render(<CustomerWorkspaceRow accountLabel="Account" currentWorkspaceId="same" workspace={{id:'same',type}} pendingKey={pendingKey} onRunAction={(w,a)=>window.calls.push(a.href)}/>);
    window.show('staff');
  `}});
  const css=readFileSync('app/bookings/booking-workspace.css','utf8');
  const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:`<style>:root{--booking-orange:rgb(255,100,0);--booking-muted:rgb(100,100,100)}${css}</style><div id="root"></div><nav class="owner-schedule-tabs"><button aria-current="page">Today</button><details class="owner-schedule-menu"><summary>Settings</summary><div><a aria-current="page">Appointments</a></div></details></nav><script src="/app.js"></script>`)});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page=await browser.newPage();
    for(const viewport of [{width:768,height:1024},{width:1024,height:768},{width:1440,height:900}]){
      await page.setViewportSize(viewport);await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByRole('button',{name:'Switch to staff'}).click();
      assert.deepEqual(await page.evaluate(()=>window.calls),['/staff/today']);
      const summary=page.locator('summary');
      assert.notEqual(await summary.evaluate(n=>getComputedStyle(n).color),'rgb(255, 100, 0)');
      await summary.click();
      assert.equal(await summary.evaluate(n=>getComputedStyle(n).color),'rgb(255, 100, 0)');
      await summary.click();
      await summary.evaluate(n=>n.setAttribute('aria-current','page'));
      assert.equal(await summary.evaluate(n=>getComputedStyle(n).color),'rgb(255, 100, 0)');
    }
    for(const type of ['personal','owner']) {
      await page.evaluate(type=>window.show(type),type);
      await page.getByRole('button',{name:'Switch to '+type}).click();
    }
    assert.deepEqual(await page.evaluate(()=>window.calls),['/staff/today','/beauty','/staff/today']);
    await page.evaluate(()=>window.show('personal','busy'));
    await page.getByRole('button',{name:'Switch to personal'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Switch to personal'}).isDisabled(),true);
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});

test('native and web Library use the compact library view while profile routes retain their sections',()=>{
  const native=readFileSync('lib/app-local-personal-registry.tsx','utf8');
  assert.match(native,/libraryPage=\{url.pathname==="\/beauty\/library"\}/);
  assert.match(native,/initialSection=\{url.pathname==="\/beauty\/library"\?"library":"overview"\}/);
  const web=readFileSync('app/(app)/beauty/library/page.tsx','utf8');
  assert.match(web,/<BeautyProfileClient libraryPage initialSection="library"/);
  const client=readFileSync('app/beauty/beauty-profile-client.tsx','utf8');
  assert.match(client,/libraryPage = false/);
  assert.match(client,/libraryPage \? <header>[\s\S]*?<h1[^>]*>Library<\/h1><\/header> : <><BeautyProfileHeader/);
});
