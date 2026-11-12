import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, chromium } from 'playwright-core';
import { spawnSync } from 'node:child_process';

test('Windows app: native encrypted tickets, logout, restart, abrupt exit and storage boundary', { skip: !process.env.ESBUILD_MODULE_PATH, timeout: 120000 }, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const repo = resolve('.').replaceAll('\\','/');
  const bundle = await build({ stdin: { contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{usePortableDraft,clearPortableLocalDrafts}from'${repo}/app/pos/portable/use-portable-draft';
    import{usePortableCloseGuard}from'${repo}/app/pos/portable/use-portable-close-guard';
    import{PortableDraftControls}from'${repo}/app/pos/portable/portable-draft-controls';
    import*as ops from'${repo}/lib/portable-operations';window.ops=ops;
    import{useSupplementalKeyboard,setSupplementalKeyboard}from'${repo}/lib/portable-keyboard-preference';
    function KeyboardPreference(){const enabled=useSupplementalKeyboard();return <button onClick={()=>setSupplementalKeyboard(!enabled)}>{enabled?'Keyboard on':'Keyboard off'}</button>;}
    function Desk(){const[value,setValue]=React.useState({amount:0});
      const draft=usePortableDraft({scope:'salon:token',operationScope:'salon:key',version:0,recovery:value,emptyRecovery:{amount:0},restore:setValue,onVersion:()=>{}});
      usePortableCloseGuard(value.amount>0);
      return <><output>{draft.ready?'Ready '+value.amount:'Loading'}</output><button onClick={()=>setValue({amount:125})}>Enter ticket</button>
      <button onClick={async()=>{await ops.savePortableOperation('salon:key','receipt',{localDraftKey:draft.recoveryKey.current,total:value.amount});draft.checkpoint({amount:0});setValue({amount:0});}}>Submit</button>
      <PortableDraftControls scope="salon:key" active={value.amount>0} activity={String(value.amount)} value={value} label={'Ticket '+value.amount} reset={async()=>{draft.checkpoint({amount:0});setValue({amount:0});}} restore={v=>{setValue(v);return true;}}/>
      </>;}
    function App(){const[logged,setLogged]=React.useState(true);return <><KeyboardPreference/>{logged?<><Desk/><button onClick={()=>{clearPortableLocalDrafts();setLogged(false);}}>Logout</button></>:<button onClick={()=>setLogged(true)}>Login</button>}</>;}createRoot(document.getElementById('root')).render(<App/>);
  `, loader:'tsx',resolveDir:repo },jsx:'automatic',bundle:true,write:false,platform:'browser'});
  const server=createServer((req,res)=>{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
    else if(req.url.startsWith('/api/')){res.statusCode=503;res.end('{}');}
    else{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/bundle.js"></script>');}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  // Older installed hosts reject the new optional closed-edit namespace.
  // Ordinary saved tickets must remain visible and recoverable.
  const legacyBrowser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
  try{const legacy=await legacyBrowser.newPage();await legacy.addInitScript(()=>{const values=new Map([['kingpos:parked-tickets:v1:salon:key',JSON.stringify([{id:'legacy-saved',at:1,label:'Ticket 125',value:{amount:125}}])]]);window.qaArchiveDenied=0;window.kingposDesktop={version:4,storage:{get(key){if(key.startsWith('kingpos:closed-ticket-edits:')){window.qaArchiveDenied++;throw Error('Old host: namespace unavailable');}return values.get(key)??null;},set(key,value){values.set(key,value);},remove(key){values.delete(key);}},operations:{checkpoint:async()=>0,list:async()=>[],save:async()=>{}}};});await legacy.goto('http://127.0.0.1:'+server.address().port);await legacy.getByRole('button',{name:'Saved tickets (1)',exact:true}).click();await legacy.getByRole('button',{name:/^Ticket 125/}).click();await legacy.getByText('Ready 125',{exact:true}).waitFor();assert.ok(await legacy.evaluate(()=>window.qaArchiveDenied>0));console.log('PASS older native host: optional archive denial preserves saved-ticket recovery');}finally{await legacyBrowser.close();}
  const profile=mkdtempSync(join(tmpdir(),'kingpos-desktop-'));
  let app;
  const env={...process.env,KINGPOS_DESKTOP_TEST_PROFILE:profile,KINGPOS_DESKTOP_TEST_ORIGIN:`http://127.0.0.1:${server.address().port}`};
  delete env.ELECTRON_RUN_AS_NODE;
  const launch=()=>electron.launch({executablePath:resolve('desktop/node_modules/electron/dist/electron.exe'),args:[resolve('desktop')],env});
  try{
    app=await launch();let page=await app.firstWindow();await page.getByText('Ready 0',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.kingposDesktop.version),4);
    await page.getByRole('button',{name:'Keyboard off',exact:true}).click();
    await page.getByRole('button',{name:'Keyboard on',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
    const second=spawnSync(resolve('desktop/node_modules/electron/dist/electron.exe'),[resolve('desktop')],{env,timeout:15000});
    assert.equal(second.status,0,'A second launch must hand off to the existing app');
    assert.equal(app.windows().length,1);
    await page.getByRole('button',{name:'Enter ticket'}).click();await page.getByText('Ready 125',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Logout',exact:true}).click();await page.getByRole('button',{name:'Login',exact:true}).click();
    await page.getByText('Ready 125',{exact:true}).waitFor();
    await app.close();app=await launch();page=await app.firstWindow();await page.getByText('Ready 125',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Keyboard on',exact:true}).waitFor();
    await page.getByRole('button',{name:'Save for later',exact:true}).click();await page.getByText('Ready 0',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Enter ticket'}).click();await page.getByRole('button',{name:'Submit',exact:true}).click();await page.getByText('Ready 0',{exact:true}).waitFor();
    const before=await page.evaluate(()=>window.ops.listPortableOperations('salon:key'));assert.equal(before.length,1);assert.equal(before[0].state,'pending');
    // Simulate a killed process without asking the app to flush browser storage.
    await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});app=await launch();page=await app.firstWindow();
    await page.getByText('Ready 0',{exact:true}).waitFor();
    const after=await page.evaluate(()=>window.ops.listPortableOperations('salon:key'));assert.equal(after[0].id,before[0].id);
    await page.getByRole('button',{name:'Saved tickets (1)'}).click();await page.getByRole('button',{name:/^Ticket 125/}).click();await page.getByText('Ready 125',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.kingposDesktop.storage.get('kingpos:parked-tickets:v1:another:key')),null);
    await assert.rejects(page.evaluate(()=>window.kingposDesktop.storage.get('../../secrets')));
    const allFiles=await app.evaluate(({app})=>app.getPath('userData'));assert.equal(allFiles,profile);
    await app.close();app=undefined;
    // Data encryption is exercised with actual Electron safeStorage / Windows DPAPI.
    const { readdirSync }=await import('node:fs');const dirs=readdirSync(join(profile,'data'));
    const bytes=readFileSync(join(profile,'data',dirs[0],'tickets.sqlite'));
    assert.equal(bytes.includes(Buffer.from('"total":125')),false);
  }finally{await app?.close().catch(()=>{});await new Promise(done=>server.close(done));if(!resolve(profile).startsWith(resolve(tmpdir())+sep+'kingpos-desktop-'))throw Error('Unexpected directory');rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:250});}
});
