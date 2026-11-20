import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';

// Geometry regression only. Real Next navigation/history/Activity behavior is
// verified separately; this fixture does not simulate those router contracts.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baselineCommit='46d23d0af5e2092c27fed9acb0117b625e2e5b27';
// Exact Git blob of components/experience-page-boundary.tsx at baselineCommit.
// Readable embedded source keeps the negative control usable in shallow clones
// and source archives. Its original CRLF bytes and final newline are preserved.
const baselineSourceSha256='c875f44baa0d5fdf2d9647e16080959efb2317f99cbf33f7b333160fde029886';
const baselineSourceLines=[
  "\"use client\";",
  "",
  "import { Activity, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from \"react\";",
  "import { usePathname, useRouter, useSearchParams } from \"next/navigation\";",
  "import { getExperienceRoutePolicy } from \"@/lib/experience-route-policies\";",
  "import { useExperienceScope } from \"@/components/experience-scope\";",
  "import { PageLoadingSkeleton } from \"@/components/loading-feedback\";",
  "",
  "const RESOURCE_VIEWS = new Set([\"/market\", \"/notifications\", \"/staff/today\", \"/staff/my-work\", \"/staff/appointments\", \"/staff/workday\", \"/staff/scan\", \"/activity\", \"/bookings\", \"/reports\"]);",
  "",
  "/** Activity cleans effects when hidden; keep browsing state but reset action flows. */",
  "export function ExperiencePageBoundary({ children, admin = false, renderRevision = \"\", pendingFallback }: { children: ReactNode; admin?: boolean; renderRevision?: string; pendingFallback?: ReactNode }) {",
  "  const pathname = usePathname();",
  "  const query = useSearchParams().toString();",
  "  const href = pathname + (query ? `?${query}` : \"\");",
  "  const policy = getExperienceRoutePolicy(href);",
  "  // Settings sections and Forum reading tabs own their local query navigation",
  "  // and readers. Refreshing the whole RSC tree races those reads and hides",
  "  // their header/tabs. Forum actions and sensitive URLs keep their own policy.",
  "  const localQueryNavigation = pathname === \"/settings\" || policy.family === \"forum\";",
  "  const lifecycleHref = localQueryNavigation ? pathname : href;",
  "  const lifecyclePolicy = pathname === \"/settings\" ? getExperienceRoutePolicy(pathname) : policy;",
  "  const scope = useExperienceScope();",
  "  const contextScope = scope?.context.scope;",
  "  const authenticated = scope?.context.authenticated;",
  "  const validate = scope?.validate;",
  "  const checkedAt = scope?.checkedAt;",
  "  const getValidationRevision = scope?.getValidationRevision;",
  "  const router = useRouter();",
  "  const container = useRef<HTMLDivElement>(null);",
  "  const shown = useRef(false);",
  "  const renderedAt = useRef(0);",
  "  const refreshPending = useRef(false);",
  "  const refreshGeneration = useRef(0);",
  "  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);",
  "  const [failedRevision, setFailedRevision] = useState<string | null>(null);",
  "  const refreshFailed = failedRevision === renderRevision;",
  "  const [activation, setActivation] = useState(0);",
  "  const [checkingAuthRevision, setCheckingAuthRevision] = useState<number | null>(null);",
  "  const [waitingRevision, setWaitingRevision] = useState<string | null>(null);",
  "  const checkingAuth = checkingAuthRevision !== null && (scope?.validationRevision ?? 0) <= checkingAuthRevision;",
  "  const checking = checkingAuth || waitingRevision === renderRevision;",
  "  const revision = useRef(renderRevision);",
  "  const cancelRefresh = useCallback(() => {",
  "    refreshGeneration.current++;",
  "    refreshPending.current = false;",
  "    if (refreshTimer.current) clearTimeout(refreshTimer.current);",
  "    refreshTimer.current = null;",
  "  }, []);",
  "  useLayoutEffect(() => {",
  "    // Activity re-runs layout effects on reveal. Only a NEW server render may",
  "    // renew data age or acknowledge an unfinished refresh.",
  "    if (!renderedAt.current || revision.current !== renderRevision) {",
  "      revision.current = renderRevision;",
  "      renderedAt.current = Date.now();",
  "      cancelRefresh();",
  "    }",
  "  }, [renderRevision, cancelRefresh]);",
  "",
  "  useLayoutEffect(() => () => {",
  "    // A local Settings section change must abandon an unfinished page reveal",
  "    // refresh, without treating that section change as another page reveal.",
  "    cancelRefresh();",
  "    setWaitingRevision(null);",
  "    setFailedRevision(null);",
  "  }, [href, contextScope, cancelRefresh]);",
  "",
  "  const refreshServerView = useCallback(() => {",
  "    if (refreshPending.current || !navigator.onLine) { if (!navigator.onLine) setFailedRevision(revision.current); return; }",
  "    refreshPending.current = true;",
  "    const generation = ++refreshGeneration.current;",
  "    const requestedRevision = revision.current;",
  "    setFailedRevision(null);",
  "    router.refresh();",
  "    refreshTimer.current = setTimeout(() => {",
  "      if (generation !== refreshGeneration.current) return;",
  "      refreshPending.current = false;",
  "      refreshTimer.current = null;",
  "      setFailedRevision(requestedRevision);",
  "    }, 12_000);",
  "  }, [router]);",
  "",
  "  useLayoutEffect(() => {",
  "    const returning = shown.current;",
  "    shown.current = true;",
  "    const elapsed = Date.now() - renderedAt.current;",
  "    const root = container.current;",
  "    let active = true;",
  "    // Admin has its own grant provider/boundary. POS owns its operational state.",
  "    const delegated = lifecyclePolicy.family === \"pos\" || (lifecyclePolicy.family === \"admin\" && !admin);",
  "    if (returning && !delegated) {",
  "      if (lifecyclePolicy.resetOnHide) {",
  "        // Activity reveal must hide stale action data before the browser paints.",
  "        setWaitingRevision(revision.current);",
  "        refreshServerView();",
  "      } else {",
  "        const protectedView = lifecyclePolicy.requiresAuth || Boolean(authenticated);",
  "        const mustValidate = protectedView && checkedAt && Date.now() - checkedAt() >= 30_000;",
  "        // Synchronous hiding prevents an unvalidated retained private view flashing.",
  "        if (mustValidate) setCheckingAuthRevision(getValidationRevision?.() ?? 0);",
  "        const reconcile = async () => {",
  "          if (protectedView && validate && !(await validate())) return;",
  "          if (!active) return;",
  "          setCheckingAuthRevision(null);",
  "          const resourceView = RESOURCE_VIEWS.has(pathname);",
  "          if (!resourceView && lifecyclePolicy.revalidateOnShow && elapsed >= lifecyclePolicy.refreshAfterMs) refreshServerView();",
  "        };",
  "        void reconcile();",
  "      }",
  "    }",
  "    return () => {",
  "      active = false;",
  "      // Next may abandon a refresh when navigation/Activity takes priority.",
  "      // Its timer must never report a failure on a later navigation attempt.",
  "      cancelRefresh();",
  "      setWaitingRevision(null);",
  "      setFailedRevision(null);",
  "      for (const media of root?.querySelectorAll<HTMLMediaElement>(\"video,audio\") ?? []) media.pause();",
  "      for (const dialog of root?.querySelectorAll<HTMLDialogElement>(\"dialog[open]\") ?? []) dialog.close();",
  "      if (!delegated && lifecyclePolicy.resetOnHide) setActivation(value => value + 1);",
  "    };",
  "  // Hidden Activity routes clean this effect and restart it on the next reveal.",
  "  // Query/path changes also represent a new view, not an old pending command.",
  "  }, [lifecycleHref, pathname, admin, contextScope, authenticated, validate, checkedAt, getValidationRevision, router,",
  "    lifecyclePolicy.family, lifecyclePolicy.resetOnHide, lifecyclePolicy.requiresAuth, lifecyclePolicy.revalidateOnShow, lifecyclePolicy.refreshAfterMs, refreshServerView, cancelRefresh]);",
  "",
  "  return <div ref={container} className=\"contents\" data-experience-view=\"\" data-experience-family={policy.family} key={contextScope ?? \"public\"}>",
  "    {refreshFailed ? <div role=\"status\" className=\"mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3 text-sm\">",
  "      <span>The page could not update. Check your connection and try again.</span>",
  "      <button type=\"button\" className=\"min-h-11 shrink-0 underline\" onClick={refreshServerView}>Try again</button>",
  "    </div> : checking ? (pendingFallback ?? <PageLoadingSkeleton />) : null}",
  "    <Activity mode={checking ? \"hidden\" : \"visible\"}><div className=\"contents\" key={activation}>{children}</div></Activity>",
  "  </div>;",
  "}",
  "",
];
const boundaryFile=path.join(root,'components/experience-page-boundary.tsx');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let browser,server,origin,artifactDir;
const results=[];

test.before(async()=>{
  await fs.mkdir(path.join(root,'artifacts/experience-page-scroll-target'),{recursive:true});
  artifactDir=await fs.mkdtemp(path.join(root,'artifacts/experience-page-scroll-target/run-'));
  // This is the byte-exact real pre-fix component, not an approximation. No
  // Git history, subprocess, network fetch or .git directory is needed here.
  const baseline=Buffer.from(baselineSourceLines.join('\r\n'),'utf8');
  assert.equal(sha(baseline),baselineSourceSha256,'Embedded baseline bytes must remain exact');
  const current=await fs.readFile(boundaryFile);
  assert.notEqual(sha(current),sha(baseline),'Regression needs both the exact pre-fix and actual patched component');
  const fixture=await build({
    stdin:{resolveDir:root,loader:'tsx',contents:`
      import React,{Activity,Fragment,useRef,useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {ExperiencePageBoundary as Baseline} from 'baseline-boundary';
      import {ExperiencePageBoundary as Patched} from 'actual-boundary';
      const q=new URLSearchParams(location.search),Boundary=q.get('variant')==='baseline'?Baseline:Patched;
      window.qa={router:{refresh(){throw Error('Unexpected refresh in public geometry fixture');}}};
      function Content(){const[draft,setDraft]=useState('fixture-only');return <>
        <main className="route-item route-first"><h1>Policy heading</h1><label>Synthetic field<input value={draft} onChange={e=>setDraft(e.target.value)}/></label></main>
        <section className="route-item route-second"><button type="button">Read-only control</button></section>
      </>;}
      function App(){
        const fragment=useRef(null),[visible,setVisible]=useState(true);
        window.qa.setVisible=next=>flushSync(()=>setVisible(next));
        window.qa.fragmentRectCount=()=>fragment.current?.getClientRects?.().length??0;
        window.qa.measure=()=>{
          if(typeof fragment.current?.getClientRects!=='function')throw Error('Next vendored React Fragment geometry is unavailable');
          const rect=r=>({x:r.x,y:r.y,width:r.width,height:r.height,top:r.top});
          const host=document.querySelector('.fixture-host'),first=document.querySelector('.route-first');
          const anchor=document.querySelector('[data-experience-scroll-target]');
          return {fragmentRects:[...fragment.current.getClientRects()].map(rect),first:rect(first.getBoundingClientRect()),
            host:rect(host.getBoundingClientRect()),items:[...document.querySelectorAll('.route-item')].map(e=>rect(e.getBoundingClientRect())),
            anchor:anchor?{rect:rect(anchor.getBoundingClientRect()),ariaHidden:anchor.getAttribute('aria-hidden'),position:getComputedStyle(anchor).position,pointerEvents:getComputedStyle(anchor).pointerEvents}:null,
            wrapperDisplay:getComputedStyle(document.querySelector('[data-experience-view]')).display,
            scrollY:window.scrollY,reactVersion:React.version};
        };
        return <><button id="outside-focus" className="outside-focus">Outside fixture</button><div className="fixture-prefix"/><div className={'fixture-host '+q.get('layout')} style={{position:q.get('position')||'static'}}>
          <Activity mode={visible?'visible':'hidden'}><Fragment ref={fragment}><Boundary renderRevision="geometry-only"><Content/></Boundary></Fragment></Activity>
        </div><div className="fixture-tail"/></>;
      }
      flushSync(()=>createRoot(document.getElementById('root')).render(<App/>));window.qa.ready=true;
    `},
    bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',
    define:{'process.env.NODE_ENV':'"development"'},
    // App Router uses Next's vendored channel, whose Fragment refs expose real
    // getClientRects. Stable npm React may silently lack this capability.
    alias:{'@':root,react:path.join(root,'node_modules/next/dist/compiled/react'),'react-dom':path.join(root,'node_modules/next/dist/compiled/react-dom')},
    plugins:[{name:'public-boundary-geometry',setup(b){
      b.onResolve({filter:/^actual-boundary$/},()=>({path:boundaryFile}));
      b.onResolve({filter:/^baseline-boundary$/},()=>({path:'baseline',namespace:'baseline'}));
      b.onLoad({filter:/.*/,namespace:'baseline'},()=>({contents:baseline.toString(),loader:'tsx',resolveDir:path.dirname(boundaryFile)}));
      b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
      b.onResolve({filter:/experience-scope$/},()=>({path:'scope',namespace:'fixture'}));
      b.onResolve({filter:/loading-feedback$/},()=>({path:'loading',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:root,loader:'tsx',contents:a.path==='navigation'?
        `export const usePathname=()=>'/help';export const useSearchParams=()=>new URLSearchParams();export const useRouter=()=>window.qa.router;`:
        a.path==='scope'?`export const useExperienceScope=()=>null;`:`export const PageLoadingSkeleton=()=>null;`}));
    }}],
  });
  const javascript=fixture.outputFiles[0].text;
  const css=(await postcss([tailwind()]).process(await fs.readFile(path.join(root,'app/globals.css'),'utf8'),{from:path.join(root,'app/globals.css')})).css+`
    html,body{margin:0}body{font-family:Arial,sans-serif}.fixture-prefix{height:1400px}.fixture-tail{height:1600px}
    .fixture-host{margin:0 24px}.fixture-host.flow{display:block}.fixture-host.flex{display:flex;flex-direction:column;gap:19px}
    .fixture-host.grid{display:grid;grid-template-columns:1fr 1fr;gap:19px}.route-item{min-width:0;height:180px;padding:13px;border:1px solid #444}
    .route-item h1{margin:0 0 12px;font-size:20px}.route-second{height:120px}.route-item input{width:130px}
    .outside-focus{position:fixed;top:4px;right:4px}
  `;
  await fs.writeFile(path.join(artifactDir,'source-pins.json'),JSON.stringify({baselineCommit,baselineBoundarySha256:sha(baseline),actualBoundarySha256:sha(current),reactVendor:'next/dist/compiled/react',reactDomVendor:'next/dist/compiled/react-dom',scope:'actual component + real Fragment/CSS geometry; mocked public auth/navigation only'},null,2));
  server=createServer((req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const url=new URL(req.url,'http://127.0.0.1');
    if(!['/help','/fixture.js'].includes(url.pathname)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; img-src 'none'");
    res.setHeader('Content-Type',url.pathname==='/fixture.js'?'text/javascript':'text/html');
    res.end(req.method==='HEAD'?'':url.pathname==='/fixture.js'?javascript:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/fixture.js"></script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  const executablePath=[process.env.TEST_BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p));
  assert.ok(executablePath,'An existing test browser is required; no download/install fallback');
  browser=await chromium.launch({executablePath,headless:true});
});
test.after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));if(artifactDir)await fs.writeFile(path.join(artifactDir,'geometry-results.json'),JSON.stringify({scope:'Chromium component geometry only; actual Next history/hash/Activity/scroll=false covered separately',results},null,2));});

async function withFixture(variant,layout,position,viewport,inspect){
  const page=await browser.newPage({viewport});const errors=[],unexpected=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin&&['/help','/fixture.js'].includes(u.pathname)&&['GET','HEAD'].includes(r.request().method()))return r.continue();unexpected.push(r.request().method()+' '+u.pathname);return r.abort();});
  try{
    await page.goto(`${origin}/help?variant=${variant}&layout=${layout}&position=${position}`);await page.waitForFunction(()=>window.qa?.ready);
    const value=await inspect(page);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);return value;
  }finally{await page.close();}
}
async function measure(variant,layout,position,viewport){return withFixture(variant,layout,position,viewport,async page=>{
  const initial=await page.evaluate(()=>qa.measure());await page.evaluate(()=>window.scrollTo(0,1000));
  return{initial,scrolled:await page.evaluate(()=>qa.measure())};
});}

test('real route Fragment is empty for exact old component, and gets page-origin geometry with the actual marker',async()=>{
  for(const position of['static','relative'])for(const viewport of[{width:412,height:860},{width:1024,height:900}]){
    const old=await measure('baseline','flow',position,viewport),current=await measure('patched','flow',position,viewport);
    assert.deepEqual(old.initial.fragmentRects,[],'display:contents must reproduce the empty real Fragment negative control');
    for(const state of[current.initial,current.scrolled]){
      assert.equal(state.fragmentRects.length,1);const marker=state.fragmentRects[0];
      assert.equal(marker.width,0);assert.equal(marker.height,0);assert.ok(Math.abs(marker.top-state.first.top)<0.5,'Marker is at the actual route content origin, before and after scrolling');
      assert.equal(state.wrapperDisplay,'contents');assert.equal(state.anchor.ariaHidden,'true');assert.equal(state.anchor.position,'absolute');assert.equal(state.anchor.pointerEvents,'none');
    }
    assert.ok(current.scrolled.fragmentRects[0].top<current.initial.fragmentRects[0].top,'Real geometry follows document scroll, not a fixed viewport marker');
    results.push({case:'fragment-geometry',position,viewport,old,current});
  }
});

test('zero-size sibling preserves actual children layout in flow, flex and grid',async()=>{
  for(const layout of['flow','flex','grid'])for(const position of['static','relative'])for(const viewport of[{width:412,height:860},{width:1024,height:900}]){
    const old=await measure('baseline',layout,position,viewport),current=await measure('patched',layout,position,viewport);
    assert.deepEqual(current.initial.items,old.initial.items,`${layout}/${position}: marker must not add a cell, gap, height or width`);
    assert.deepEqual(current.initial.host,old.initial.host,`${layout}/${position}: parent box remains unchanged`);
    assert.equal(current.initial.wrapperDisplay,old.initial.wrapperDisplay);
    results.push({case:'layout-preserved',layout,position,viewport});
  }
});

test('real Activity hide/reveal retains a typed fixture draft without focusing the anchor',async()=>{
  await withFixture('patched','flow','relative',{width:412,height:860},async page=>{
    const field=page.getByLabel('Synthetic field');await field.fill('Known synthetic retained draft');
    await page.locator('#outside-focus').focus();
    await page.evaluate(()=>{
      qa.retainedInput=document.querySelector('input');qa.anchorFocusEvents=0;
      document.addEventListener('focusin',event=>{if(event.target?.hasAttribute?.('data-experience-scroll-target'))qa.anchorFocusEvents++;});
      qa.setVisible(false);
    });
    assert.equal(await field.isVisible(),false);
    assert.equal(await page.evaluate(()=>qa.fragmentRectCount()),0,'Hidden Activity must not leave a usable scroll target');
    await page.evaluate(()=>qa.setVisible(true));await field.waitFor({state:'visible'});
    assert.equal(await field.inputValue(),'Known synthetic retained draft');
    const state=await page.evaluate(()=>({sameInput:document.querySelector('input')===qa.retainedInput,rectCount:qa.fragmentRectCount(),anchorFocusEvents:qa.anchorFocusEvents,focusId:document.activeElement.id}));
    assert.deepEqual(state,{sameInput:true,rectCount:1,anchorFocusEvents:0,focusId:'outside-focus'});
    results.push({case:'actual-react-activity-retained-draft',...state});
  });
});
