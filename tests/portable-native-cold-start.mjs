import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {_electron} from 'playwright-core';
const dir=mkdtempSync(join(tmpdir(),'kingpos-cold-start-'));
let sawCookie=false;
const server=createServer((req,res)=>{
  if(req.url==='/api/probe'){res.setHeader('content-type','application/json');res.end(JSON.stringify({origin:req.headers.origin??null}));return;}
  if(req.headers.cookie?.includes('kingpos-portable-pos-session=fixture'))sawCookie=true;
  if(req.url.startsWith('/_next/')) {res.setHeader('content-type','text/javascript');res.end('window.shellLoaded=true');return;}
  res.setHeader('content-type','text/html');res.end('<main data-portable-pos-shell>Offline workspace</main><script src="/_next/static/app.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const env={...process.env,KINGPOS_DESKTOP_TEST_ORIGIN:origin,KINGPOS_DESKTOP_TEST_PROFILE:dir};delete env.ELECTRON_RUN_AS_NODE;
let app;
async function launch(){app=await _electron.launch({executablePath:resolve('desktop/node_modules/electron/dist/electron.exe'),args:[resolve('desktop')],env});const page=await app.firstWindow();await page.waitForFunction(()=>window.shellLoaded);return page;}
try{
  let page=await launch();
  assert.equal(await page.evaluate(async()=>{const r=await fetch('/api/probe',{method:'POST'});return(await r.json()).origin;}),origin,'Same-origin POST must retain Origin');
  await page.evaluate(()=>window.kingposDesktop.offline.prepare('test:device',[]));
  await app.evaluate(async({BrowserWindow})=>{const s=BrowserWindow.getAllWindows()[0].webContents.session;await s.cookies.set({url:BrowserWindow.getAllWindows()[0].webContents.getURL(),name:'kingpos-portable-pos-session',value:'fixture',httpOnly:true});await s.clearStorageData({storages:['serviceworkers','cachestorage']});});
  await page.reload();assert.equal(sawCookie,true,'Authorized requests must keep the session cookie');
  await app.close();app=null;
  await new Promise(r=>server.close(r));
  page=await launch();
  assert.equal(await page.locator('main').textContent(),'Offline workspace');
  assert.equal(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({name:'kingpos-portable-pos-session'}))[0]?.value),'fixture');
  await page.evaluate(()=>window.kingposDesktop.offline.lock());
  await app.close();app=null;
  console.log('PASS: real Electron cold-start with server stopped and browser caches cleared; local JS loads; app session retained.');
}finally{await app?.close();if(server.listening)await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:300});}
