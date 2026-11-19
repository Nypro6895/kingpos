import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { build, buildSync } from 'esbuild';
import { chromium } from 'playwright-core';
import ts from 'typescript';

// Production StaffPage/Read, resource cache and prefetch runtime. Only host IO
// and the presentation body are synthetic; this is not physical-iOS acceptance.
const browserPath = process.env.TEST_BROWSER_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const options = { skip: !browserPath, timeout: 30_000 };
const scopeA = 'v3:' + 'a'.repeat(64), scopeB = 'v3:' + 'b'.repeat(64);
const staffA = '00000000-0000-4000-8000-000000000003', staffB = '00000000-0000-4000-8000-000000000004';
const original = execFileSync('git', ['show', 'cf77926:lib/app-local-owner-page-registry.tsx'], { encoding: 'utf8' });
const source = readFileSync('lib/app-local-owner-page-registry.tsx', 'utf8');
function definition(name, value = source) {
  const ast = ts.createSourceFile('registry.tsx', value, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === name));
  assert.ok(node, 'production definition must exist: ' + name);
  return node.getText(ast);
}
const mod = { exports: {} };
new Function('module', 'exports', buildSync({ entryPoints: ['lib/owner-staff-read-args.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text)(mod, mod.exports);
const { ownerStaffReadArgs: args, ownerStaffReadArgsFromRecord: pick } = mod.exports;
test('Staff read identity excludes presentation only and keeps every lookup/binding value exactly', () => {
  assert.deepEqual(args('/staff?add=1&setup=1&filter=active&q=Kim&error=bad&connection_notice=ok&connection_error=bad&invite_request=request'), {});
  assert.deepEqual(args('/staff?staff=' + staffA + '&invite_email=&invite_phone=%20%2B14145550000%20'), { staff: staffA, invite_email: '', invite_phone: ' +14145550000 ' });
  assert.deepEqual(args('/staff?invite_email=first&invite_email=last'), { invite_email: 'last' });
  const unexpected = { staff: undefined, invite_email: null, invite_phone: 123, q: 'ignored' };
  assert.deepEqual(pick(unexpected), { staff: undefined, invite_email: null, invite_phone: 123 }, 'record mapping never coerces owned values');
  assert.deepEqual(unexpected, { staff: undefined, invite_email: null, invite_phone: 123, q: 'ignored' });
});

function context(scope = scopeA) {
  const now = Date.now(), identity = { scope, viewerId: staffA, salonId: staffB, workspaceId: 'staff-fixture-owner', permissionRevision: 'r1', authenticated: true };
  return { schemaVersion: 1, context: identity, onlineValidatedAt: now, display: { name: 'Synthetic QA', role: 'Owner', language: 'en' },
    access: { ownerWorkspace: true, staffWorkspace: false },
    grant: { version: 1, ...identity, scopes: [scope], generation: 'generation-0000000001', grantRevision: 'r1', issuedAt: now - 100, expiresAt: now + 3_600_000, kind: 'owner', path: '/staff' } };
}
let browser, server, base;
before(async () => {
  if (!browserPath) return;
  const root = resolve('.').replaceAll('\\', '/');
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: root, contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{useAppLocalResource,peekAppLocalResource,refreshAppLocalResource,resetAppLocalResources,seedAppLocalResource}from'./lib/app-local-resource';
    import{ownerStaffReadArgs}from'./lib/owner-staff-read-args';
    import{useAppLocalPrefetch}from'./lib/app-local-prefetch';
    import policy from './lib/app-local-owner-page-registry.json';
    const h=window.h={reads:[],pending:new Map(),rules:[],caches:[],commands:[],serial:0};
    window.__reylumiAppLocalContext={generation:'generation-0000000001',scopeEpoch:1,nonce:'fixture'};
    const response=row=>({schemaVersion:1,status:200,scope:row.scope,etag:'r'+row.id,updatedAt:Date.now(),offline:false,data:{version:row.id,scope:row.scope,args:row.args}});
    window.holdRead=(extra={})=>h.rules.push({remaining:1,...extra});
    window.releaseRead=id=>{const held=h.pending.get(id);h.pending.delete(id);held.resolve(response(held.row));};
    window.host={isNative:true,read(name,args={},options={}){
      const row={id:++h.serial,name,args,scope:options.scope};h.reads.push(row);
      const rule=name==='page.owner-staff'?h.rules.find(rule=>rule.remaining>0&&(!rule.scope||rule.scope===row.scope)):null;if(rule)rule.remaining--;
      return new Promise((resolve,reject)=>{
        const abort=()=>{if(!rule?.ignoreAbort)reject(new DOMException('cancelled','AbortError'));};
        options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
        if(rule?.status)reject(Object.assign(new Error('Synthetic denial'),{status:rule.status}));
        else if(rule)h.pending.set(row.id,{row,resolve});else resolve(response(row));
      });
    },cache(operation,args){h.caches.push({operation,...args});return Promise.resolve(null);},
    command(name,args){h.commands.push({name,args});throw Error('Business writes forbidden');},openOnline(){throw Error('External navigation forbidden');}};
    const WorkspaceText=({text})=>text,LumiLoadingStatus=()=> <p>Loading</p>,getAppLocalHost=()=>window.host;
    const AppLocalOwnerStaffView=({data,params})=><section data-testid='staff-content'>
      <output data-testid='identity'>{data.scope+'|'+data.version+'|'+(data.args.staff??'')+'|'+(data.args.invite_email??'')}</output>
      <p data-testid='presentation'>{JSON.stringify(params)}</p>
      {params.add==='1'&&<input data-testid='staff-draft' aria-label='Staff name draft' defaultValue=''/>}
    </section>;
    ${['urlFor', 'query', 'argsFor', 'Read', 'StaffPage'].map(name => definition(name)).join('\n')}
    ${definition('StaffPage', original).replace('function StaffPage(', 'function LegacyStaffPage(')}
    function Runtime({value,path}){useAppLocalPrefetch(value,path);return null;}
    function App(){
      const[cfg,set]=useState({value:null,path:'/staff',runtime:false,legacy:false});
      const[paths,setPaths]=useState(['/staff']);
      window.configure=next=>set(old=>{const value={...old,...next};history.replaceState({},'',value.path);return value;});
      if(!paths.includes(cfg.path))setPaths([...paths,cfg.path]);
      window.refreshStaff=()=>refreshAppLocalResource(cfg.value.context.scope,'page.owner-staff',ownerStaffReadArgs(cfg.path));
      const Page=cfg.legacy?LegacyStaffPage:StaffPage;
      return <>{cfg.value&&paths.map(path=><React.Activity key={cfg.value.context.scope+':'+path} mode={path===cfg.path?'visible':'hidden'}><Page context={cfg.value} path={path}/></React.Activity>)}{cfg.value&&cfg.runtime?<Runtime value={cfg.value} path={cfg.path}/>:null}</>;
    }
    window.peekStaff=(scope,args={})=>peekAppLocalResource(scope,'page.owner-staff',args);
    window.resetReads=resetAppLocalResources;
    window.seedStaff=(scope,args,stamp)=>seedAppLocalResource(scope,'page.owner-staff',args,{schemaVersion:1,status:200,scope,etag:'bootstrap',updatedAt:stamp,offline:false,data:{scope,version:500,args:ownerStaffReadArgs('/staff?'+new URLSearchParams(args))}});
    createRoot(document.getElementById('root')).render(<App/>);window.fixtureReady=true;
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', plugins: [{ name: 'staff-host-boundaries', setup(b) {
    b.onResolve({ filter: /\/(app-local-host|experience-persistent-cache)$/ }, a => ({ path: a.path.split('/').at(-1), namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'app-local-host' ? 'export const getAppLocalHost=()=>window.host;' : 'export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};' }));
  } }] });
  server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html');res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:browserPath,headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
async function fixture(t, cfg = {}, setup) {
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{try{assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>h.commands.length),0);}finally{await page.close();}});
  await page.addInitScript(()=>{const now=Date.now;window.clockOffset=0;Date.now=()=>now()+window.clockOffset;});
  await page.goto(base);await page.waitForFunction(()=>window.fixtureReady);if(setup)await setup(page);
  await page.evaluate(cfg=>window.configure(cfg),{value:context(),path:'/staff',...cfg});return page;
}
const reads=page=>page.evaluate(()=>h.reads.filter(row=>row.name==='page.owner-staff'));
const ready=(page,scope=scopeA)=>page.locator('[data-testid=staff-content]:visible').filter({has:page.getByTestId('identity').filter({hasText:scope})}).waitFor();
test('negative control: baseline Add staff repeats the DTO; current UI queries reuse one read and unchanged timestamp',options,async t=>{
  for(const legacy of [true,false]){
    const page=await fixture(t,{legacy});await ready(page);
    const initial=await page.evaluate(scope=>window.peekStaff(scope),scopeA);
    await page.evaluate(()=>window.configure({path:'/staff?add=1'}));await ready(page);
    assert.equal((await reads(page)).length,legacy?2:1);
    if(!legacy){
      for(const path of ['/staff?add=1&q=Kim&filter=active','/staff?add=1&setup=1&error=notice&connection_notice=done&invite_request=synthetic']){await page.evaluate(path=>window.configure({path}),path);await ready(page);}
      assert.equal((await reads(page)).length,1);const latest=await page.evaluate(scope=>window.peekStaff(scope),scopeA);
      assert.equal(latest.updatedAt,initial.updatedAt);assert.equal(latest.verifiedAt,initial.verifiedAt);
      assert.match(await page.locator('[data-testid=presentation]:visible').textContent(),/notice/);
    }
  }
});
test('an in-flight default read is joined by Add staff; form draft DOM survives refresh and retained reentry',options,async t=>{
  const page=await fixture(t,{},page=>page.evaluate(()=>window.holdRead()));await page.waitForFunction(()=>h.pending.size===1);
  await page.evaluate(()=>window.configure({path:'/staff?add=1'}));assert.equal((await reads(page)).length,1);
  await page.evaluate(id=>window.releaseRead(id),(await reads(page))[0].id);await ready(page);
  const input=page.locator('[data-testid=staff-draft]:visible');await input.fill('Synthetic unsaved staff');await input.evaluate(node=>window.originalDraft=node);
  await page.evaluate(async()=>{await window.refreshStaff();});await ready(page);assert.equal(await input.evaluate(node=>node===window.originalDraft),true);assert.equal(await input.inputValue(),'Synthetic unsaved staff');
  await page.evaluate(()=>window.configure({path:'/staff'}));await ready(page);await page.evaluate(()=>window.configure({path:'/staff?add=1'}));await ready(page);
  assert.equal(await page.locator('[data-testid=staff-draft]:visible').evaluate(node=>node===window.originalDraft),true);assert.equal(await input.inputValue(),'Synthetic unsaved staff');
});
test('selected staff and exact invite lookup inputs keep separate reads, including empty values',options,async t=>{
  const page=await fixture(t);await ready(page);
  const cases=[['staff='+staffA,{staff:staffA}],['staff='+staffB,{staff:staffB}],['invite_email=qa%40example.test',{invite_email:'qa@example.test'}],['invite_email=',{invite_email:''}],['invite_phone=%20%2B14145550000%20',{invite_phone:' +14145550000 '}]];
  for(const[query,expected]of cases){await page.evaluate(path=>window.configure({path}),'/staff?'+query+'&add=1');await ready(page);assert.deepEqual((await reads(page)).at(-1).args,expected);}
  assert.equal((await reads(page)).length,1+cases.length);
});
test('default prefetch and foreground filter/add transitions agree on the shared Staff key',options,async t=>{
  const page=await fixture(t,{runtime:true});await ready(page);
  for(const path of ['/staff?q=Kim&filter=active','/staff?add=1','/staff?connection_error=synthetic']){await page.evaluate(path=>window.configure({path}),path);await ready(page);await page.waitForTimeout(200);}
  assert.equal((await reads(page)).length,1);assert.deepEqual((await reads(page))[0].args,{});
});
test('freshness is not extended by UI reuse and the original deadline still causes a real read',options,async t=>{
  const page=await fixture(t);await ready(page);const initial=await page.evaluate(scope=>window.peekStaff(scope),scopeA);
  await page.evaluate(()=>{window.clockOffset=29_000;window.configure({path:'/staff?add=1'});});await ready(page);assert.equal((await reads(page)).length,1);assert.equal(await page.evaluate(scope=>window.peekStaff(scope).verifiedAt,scopeA),initial.verifiedAt);
  await page.evaluate(()=>{window.clockOffset=31_000;window.holdRead();window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>h.pending.size===1);assert.equal((await reads(page)).length,2);await ready(page);
  await page.evaluate(id=>window.releaseRead(id),(await reads(page)).at(-1).id);await page.waitForFunction(scope=>window.peekStaff(scope).verifiedAt>0&&!window.peekStaff(scope).refreshing,scopeA);assert.ok(await page.evaluate(scope=>window.peekStaff(scope).verifiedAt,scopeA)>initial.verifiedAt);
});
test('denial withdraws the shared view and unavailable admission cannot expose it',options,async t=>{
  const page=await fixture(t,{path:'/staff?add=1'});await ready(page);await page.locator('[data-testid=staff-draft]:visible').fill('Private synthetic draft');
  await page.evaluate(async()=>{window.holdRead({status:403});await window.refreshStaff();});await page.getByRole('alert').waitFor();assert.equal(await page.locator('[data-testid=staff-content]:visible').count(),0);assert.equal(await page.evaluate(scope=>window.peekStaff(scope).data,scopeA),undefined);
  const denied=context();denied.access.ownerWorkspace=false;await page.evaluate(value=>window.configure({value}),denied);await page.locator('main:visible').getByText('Open this page from a Business workspace.',{exact:true}).waitFor();assert.equal(await page.locator('[data-testid=staff-content]:visible').count(),0);
});
test('scope/reset rejects a late old read and never reuses its Staff DTO or draft',options,async t=>{
  const page=await fixture(t,{},page=>page.evaluate(()=>window.holdRead({ignoreAbort:true})));await page.waitForFunction(()=>h.pending.size===1);const old=(await reads(page))[0];
  await page.evaluate(({scope,value})=>{window.resetReads(scope);window.configure({value,path:'/staff?add=1'});},{scope:scopeA,value:context(scopeB)});await ready(page,scopeB);
  await page.locator('[data-testid=staff-draft]:visible').fill('New scope draft');await page.evaluate(id=>window.releaseRead(id),old.id);await page.waitForTimeout(100);await ready(page,scopeB);
  assert.equal(await page.evaluate(scope=>window.peekStaff(scope),scopeA),undefined);assert.equal(await page.locator('[data-testid=staff-draft]:visible').inputValue(),'New scope draft');assert.equal((await reads(page)).filter(row=>row.scope===scopeB).length,1);
});
test('accepted legacy bootstrap Staff args reuse the canonical key without another read or timestamp renewal',options,async t=>{
  for(const owned of [{},{staff:staffA},{invite_email:''},{invite_email:'qa@example.test',invite_phone:' +14145550000 '}]){
    const query=new URLSearchParams({...owned,add:'1',filter:'active',q:'Kim',error:'synthetic'}).toString();let stamp;
    const page=await fixture(t,{path:'/staff?'+query},async page=>{stamp=await page.evaluate(({scope,args})=>{const stamp=Date.now()-1000;window.seedStaff(scope,args,stamp);return stamp;},{scope:scopeA,args:{...owned,add:'1',filter:'active',q:'Kim',error:'synthetic'}});});
    await ready(page);assert.equal((await reads(page)).length,0);const snapshot=await page.evaluate(({scope,args})=>window.peekStaff(scope,args),{scope:scopeA,args:owned});assert.equal(snapshot.updatedAt,stamp);assert.equal(snapshot.data.version,500);
    const before=snapshot.verifiedAt;await page.evaluate(path=>window.configure({path}),'/staff?'+new URLSearchParams({...owned,connection_notice:'done'}));await ready(page);assert.equal((await reads(page)).length,0);assert.equal(await page.evaluate(({scope,args})=>window.peekStaff(scope,args).verifiedAt,{scope:scopeA,args:owned}),before);
  }
});
