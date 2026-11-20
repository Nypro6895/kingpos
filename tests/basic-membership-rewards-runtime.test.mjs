import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {build, transformSync} from 'esbuild';
import {chromium} from 'playwright-core';

const artifactDir=path.resolve('artifacts/basic-membership-rewards');
const require=createRequire(new URL('../package.json',import.meta.url));
const policyModule={exports:{}};
new Function('module','exports',transformSync(await fs.readFile('lib/experience-route-policies.ts','utf8'),{loader:'ts',format:'cjs'}).code)(policyModule,policyModule.exports);
const {getExperienceRoutePolicy:policy,getExperienceRouteKey:key}=policyModule.exports;
let browser,server,origin,streamPage;

test('only exact ordinary Membership and Rewards routes gain bounded browsing continuity',()=>{
  assert.equal(policy('/membership').retainData,'public');
  assert.equal(policy('/membership').requiresAuth,false);
  assert.equal(policy('/membership').refreshAfterMs,60_000);
  assert.equal(policy('/membership').revalidateOnShow,true);
  assert.equal(policy('/rewards').retainData,'memory');
  assert.equal(policy('/rewards').requiresAuth,true);
  assert.equal(policy('/rewards').allowPrefetch,false);
  assert.equal(policy('/rewards').revalidateOnShow,false,'the named wallet reader owns fresh data');
  for(const href of ['/membership','/rewards?from=beauty']){
    assert.equal(policy(href).resetOnHide,false,href);assert.notEqual(key(href),null,href);
  }
  for(const href of ['/membership?token=private','/rewards?next=%2Fsettings','/rewards?mode=delete','/rewards#salon','/membership?code=x','/membership/new','/rewards/unknown','/gift-cards','/qr','/welcome/phone']){
    assert.equal(policy(href).resetOnHide,true,href);assert.equal(key(href),null,href);
  }
  assert.equal(policy('/membership','handler').family,'handler');
});

test.before(async()=>{
  await fs.mkdir(artifactDir,{recursive:true});
  const fixture=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{Activity} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {ExperiencePageBoundary} from './components/experience-page-boundary';
    import {RewardWallet} from './components/rewardlumi/reward-workspaces';
    import {MembershipWebsite} from './app/(legal)/membership/website';
    const authenticated=location.pathname==='/rewards';
    const qa=window.qa={shown:true,revision:'server-1',reads:[],refreshes:0,validations:0,checked:Date.now(),answer:true,viewer:authenticated?'viewer-a':null};
    qa.router={refresh(){qa.refreshes++;}};
    qa.checkedAt=()=>qa.checked;qa.getValidationRevision=()=>qa.scope.validationRevision;
    qa.validate=()=>{qa.validations++;if(qa.answer){qa.checked=Date.now();qa.scope={...qa.scope,validationRevision:qa.scope.validationRevision+1};qa.render();}return Promise.resolve(qa.answer);};
    qa.scope={context:{scope:authenticated?'personal-a':'public',authenticated,viewerId:qa.viewer},validationRevision:1,checkedAt:qa.checkedAt,getValidationRevision:qa.getValidationRevision,validate:qa.validate};
    qa.transport=operation=>new Promise((resolve,reject)=>qa.reads.push({operation,resolve,reject,viewer:qa.viewer}));
    const root=createRoot(document.getElementById('root'));
    function App(){return <Activity mode={qa.shown?'visible':'hidden'}><ExperiencePageBoundary renderRevision={qa.revision}>{location.pathname==='/rewards'?<RewardWallet viewerId={qa.viewer} transport={qa.transport}/>:<MembershipWebsite plans={null}/>}</ExperiencePageBoundary></Activity>;}
    qa.render=()=>flushSync(()=>root.render(<App/>));qa.hide=()=>{qa.shown=false;qa.render();};qa.show=()=>{qa.shown=true;qa.render();};
    qa.switchAccount=()=>{qa.viewer='viewer-b';qa.scope={...qa.scope,context:{scope:'personal-b',authenticated:true,viewerId:qa.viewer}};qa.render();};
    qa.render();qa.ready=true;
  `},bundle:true,write:false,outdir:artifactDir,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'bounded-runtime',setup(b){
    const mocks={
      'next/navigation':`export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>window.qa.router;`,
      'next/link':`import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>;}`,
      'next/image':`import React from 'react';export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}`,
      '@/components/experience-scope':`export const useExperienceScope=()=>window.qa.scope;`,
      '@/components/loading-feedback':`export const PageLoadingSkeleton=()=> <p role="status" data-global-loading>Validating access</p>;`,
    };
    b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:null);
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:process.cwd()}));
    b.onLoad({filter:/\.[jt]sx?$/},async args=>{
      if(args.path.includes('node_modules'))return;
      const text=await fs.readFile(args.path,'utf8');if(!/^\s*["']use server["']/.test(text))return;
      const names=[...text.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m=>m[1]);
      return{loader:'js',contents:names.map(name=>'export const '+name+'=()=>{throw Error("No server actions in the bounded fixture")};').join('\n')};
    });
  }}]});
  const js=fixture.outputFiles.find(f=>f.path.endsWith('.js')).text,css=fixture.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
  await fs.writeFile(path.join(artifactDir,'fixture.js'),js);
  const ssr=await build({entryPoints:['app/(legal)/membership/page.tsx'],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',packages:'external',loader:{'.css':'empty'},plugins:[{name:'held-reference-read',setup(b){
    b.onResolve({filter:/\.css$/},()=>({path:'styles',namespace:'ssr-css'}));
    b.onLoad({filter:/.*/,namespace:'ssr-css'},()=>({contents:'export default {};',loader:'js'}));
    b.onResolve({filter:/^@\/components\/experience-page$/},()=>({path:'boundary',namespace:'ssr'}));
    b.onResolve({filter:/^@\/lib\/platform-admin\/membership$/},()=>({path:'read',namespace:'ssr'}));
    b.onLoad({filter:/.*/,namespace:'ssr'},args=>({contents:args.path==='boundary'?'exports.withExperiencePage=Page=>Page;':'exports.publicMembershipPlans=()=>globalThis.__membershipRead;exports.publicMembershipWebsite=async()=>null;',loader:'js'}));
  }}]});
  const ssrModule={exports:{}};new Function('require','module','exports',ssr.outputFiles[0].text)(require,ssrModule,ssrModule.exports);streamPage=ssrModule.exports.default;
  server=createServer((req,res)=>{
    const url=new URL(req.url,'http://fixture.invalid');
    if(url.pathname==='/stream'){
      globalThis.__membershipRead=new Promise(resolve=>{globalThis.__resolveMembership=resolve;});
      const {createElement}=require('react'),{renderToPipeableStream}=require('react-dom/server');
      res.setHeader('content-type','text/html;charset=utf-8');
      const stream=renderToPipeableStream(createElement(streamPage),{onShellReady(){stream.pipe(res);},onError(error){res.destroy(error);}});return;
    }
    res.setHeader('content-type',url.pathname==='/fixture.js'?'text/javascript':url.pathname==='/fixture.css'?'text/css':'text/html;charset=utf-8');
    res.end(url.pathname==='/fixture.js'?js:url.pathname==='/fixture.css'?css:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
});
test.after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));delete globalThis.__membershipRead;delete globalThis.__resolveMembership;});

async function open(t,href){
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.clock.install({time:new Date('2026-11-13T18:00:00Z')});
  try {await page.goto(origin+href);await page.waitForFunction(()=>window.qa?.ready,null,{timeout:5_000});await page.locator('h1').waitFor({timeout:5_000});}
  catch(error){await page.close();throw new Error(error.message+'; browser errors: '+JSON.stringify(errors));}
  t.after(async()=>{assert.deepEqual(errors,[]);await page.close();});return page;
}
const card=name=>({salonId:name,salonName:name,enabled:true,available:7,pending:0,reserved:0,offers:[],joinedAt:'2026-11-01T00:00:00Z'});
async function resolveRead(page,index,name){await page.evaluate(({index,name})=>qa.reads[index].resolve({cards:[name]}),{index,name:card(name)});}
async function markHeader(page){await page.locator('header').evaluate(el=>window.originalHeader=el);}
async function sameHeader(page){assert.equal(await page.locator('header').evaluate(el=>el===window.originalHeader),true);}

test('guest Membership preserves header and billing choice across warm reveal without private reads',async t=>{
  const page=await open(t,'/membership');await page.getByRole('button',{name:'Annual',exact:true}).click();await markHeader(page);
  await page.evaluate(()=>{qa.hide();qa.show();});
  await sameHeader(page);assert.equal(await page.getByRole('button',{name:'Annual',exact:true}).getAttribute('aria-pressed'),'true');
  assert.deepEqual(await page.evaluate(()=>({reads:qa.reads.length,refreshes:qa.refreshes,validations:qa.validations})),{reads:0,refreshes:0,validations:0});
});

test('Membership mutable reference data revalidates after 60s without replacing visible header or billing choice',async t=>{
  const page=await open(t,'/membership');await page.getByRole('button',{name:'Annual',exact:true}).click();await markHeader(page);
  await page.clock.fastForward(60_001);await page.evaluate(()=>{qa.hide();qa.show();});
  await page.waitForFunction(()=>qa.refreshes===1);await sameHeader(page);
  assert.equal(await page.getByRole('button',{name:'Annual',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('[data-global-loading]').count(),0);
});

test('actual Membership route streams neutral header before held public reference data',async()=>{
  const response=await fetch(origin+'/stream'),reader=response.body.getReader();
  const first=new TextDecoder().decode((await reader.read()).value);
  assert.match(first,/reylumi/);assert.match(first,/Loading membership plans/);
  assert.doesNotMatch(first,/More tools\. More possibilities/,'no default published copy is presented as current before the read');
  globalThis.__resolveMembership(null);
  let rest='';for(;;){const part=await reader.read();if(part.done)break;rest+=new TextDecoder().decode(part.value);}
  assert.match(rest,/Plan details are temporarily unavailable/);
});

test('cold Rewards reveal keeps the actual header while its named wallet read is pending',async t=>{
  const page=await open(t,'/rewards');await page.waitForFunction(()=>qa.reads.length===1);await markHeader(page);
  await page.evaluate(()=>{qa.hide();qa.show();});await page.waitForFunction(()=>qa.reads.length===2);await sameHeader(page);
  assert.equal(await page.locator('[data-global-loading]').count(),0);assert.equal(await page.evaluate(()=>qa.refreshes),0);
  await resolveRead(page,1,'Current salon');await page.getByRole('heading',{name:'Current salon',exact:true}).waitFor();
  await resolveRead(page,0,'Late old salon');assert.equal(await page.getByText('Late old salon',{exact:true}).count(),0);
});

test('warm Rewards reveal uses its wallet reader, retains existing cards, and avoids whole-page refresh',async t=>{
  const page=await open(t,'/rewards');await page.waitForFunction(()=>qa.reads.length===1);await resolveRead(page,0,'Current salon');await page.getByRole('heading',{name:'Current salon',exact:true}).waitFor();await markHeader(page);
  await page.clock.fastForward(31_000);await page.evaluate(()=>{qa.hide();qa.show();});await page.waitForFunction(()=>qa.reads.length===2);
  await sameHeader(page);assert.equal(await page.getByRole('heading',{name:'Current salon',exact:true}).isVisible(),true);
  assert.equal(await page.evaluate(()=>qa.refreshes),0);assert.ok(await page.evaluate(()=>qa.validations)>0);
  await page.evaluate(()=>qa.reads[1].reject(Error('Transient fixture failure')));await page.getByText(/Showing your last update/).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Current salon',exact:true}).isVisible(),true);
});

test('Rewards account switch withdraws old cards and rejects an old in-flight account response',async t=>{
  const page=await open(t,'/rewards');await page.waitForFunction(()=>qa.reads.length===1);
  await page.evaluate(()=>qa.switchAccount());await page.waitForFunction(()=>qa.reads.length===2);
  await resolveRead(page,0,'Account A private salon');assert.equal(await page.getByText('Account A private salon',{exact:true}).count(),0);
  await resolveRead(page,1,'Account B salon');await page.getByRole('heading',{name:'Account B salon',exact:true}).waitFor();
});

test('Rewards reset removes private cards and ignores late reads',async t=>{
  const page=await open(t,'/rewards');await page.waitForFunction(()=>qa.reads.length===1);
  await page.evaluate(()=>window.dispatchEvent(new Event('reylumi:experience-reset')));await resolveRead(page,0,'Account A private salon');
  await page.getByText(/Your account has changed/).waitFor();assert.equal(await page.getByText('Account A private salon',{exact:true}).count(),0);
});

test('Rewards retained cards stay hidden when stale foreground authorization is denied',async t=>{
  const page=await open(t,'/rewards');await page.waitForFunction(()=>qa.reads.length===1);await resolveRead(page,0,'Private salon');await page.getByRole('heading',{name:'Private salon',exact:true}).waitFor();
  await page.clock.fastForward(31_000);await page.evaluate(()=>{qa.answer=false;qa.hide();qa.show();});await page.waitForFunction(()=>qa.validations>0);
  assert.equal(await page.getByRole('heading',{name:'Private salon',exact:true}).isVisible(),false);
  assert.equal(await page.evaluate(()=>qa.refreshes),0);
});
