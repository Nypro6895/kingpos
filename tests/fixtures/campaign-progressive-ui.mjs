import {build} from 'esbuild';
import {createServer} from 'node:http';
import path from 'node:path';

export async function campaignFixture(port = 0) {
  const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{OwnerSponsoredPost}from'./components/owner-sponsored-post';
    function App(){const[state,set]=useState({mode:'mixed',role:'Guest',visible:true});window.setCampaignFixture=set;window.fixtureMode=state.mode;
    return <><header><strong>Campaigns · LOCAL FIXTURE</strong><p>Mock {state.role} · No production requests</p></header><div id="summary"/><OwnerSponsoredPost key={state.role+':'+state.visible} location={state.visible?state.mode:''} latitude={43.1} longitude={-87.98}/><p>Organic content stays available</p></>}
    createRoot(document.getElementById('root')).render(<App/>);`;
  const mock = `export {prepareAdImage} from ${JSON.stringify(path.resolve('lib/advertising-client.ts'))};
    export async function adRequest(url,init){const body=init?.body?JSON.parse(init.body):{};window.campaignRequests??=[];window.campaignRequests.push({url,body,at:performance.now()});
    if(body.kind==='view'||body.kind==='click'){if(body.ticket.startsWith('claim-delayed'))await new Promise(r=>setTimeout(r,700));if(body.ticket.startsWith('uncertain'))throw Error('Mock uncertain response');return{ok:!body.ticket.startsWith('deny')}};
    const mode=body.location; if(mode==='delayed')await new Promise(r=>setTimeout(r,700));
    if(['outside','paused','expired'].includes(mode))return null;
    const ad=(name,image='/fast.svg')=>({title:name,caption:'Local test salon',href:'#',image,ticket:mode+'-'+name});
    return mode==='mixed'?[ad('Fast salon'),ad('Slow salon','/slow.svg'),ad('Other ready salon'),ad('Broken salon','/broken.svg'),ad('Text salon',null),ad('Excluded sixth')]:mode==='slow-first'?[ad('Slow first','/slow.svg?first'),ad('Ready second')]:[ad(mode+' salon')];}`;
  const output = await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outfile:'fixture.js',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},alias:{'@':process.cwd()},plugins:[{name:'local-only',setup(b){
    b.onResolve({filter:/^@\/lib\/advertising-client$/},()=>({path:'mock',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mock,loader:'js',resolveDir:process.cwd()}));
  }}]});
  const js=output.outputFiles.find(f=>f.path.endsWith('.js')).text,css=output.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const server=createServer((req,res)=>{
    const send=(type,body)=>{res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body)};
    if(req.url==='/fixture.js')return send('text/javascript',js);
    if(req.url.startsWith('/slow.svg')){const t=setTimeout(()=>send('image/svg+xml',svg),7000);res.on('close',()=>clearTimeout(t));return}
    if(req.url==='/broken.svg'){res.writeHead(404);res.end();return}
    if(req.url==='/fast.svg')return send('image/svg+xml',svg);
    if(req.url.startsWith('/api/')){res.writeHead(500);res.end('Unexpected API request');return}
    send('text/html',`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'"><style>body{font:16px -apple-system,sans-serif;background:#f8fafc;color:#172031;padding:16px;margin:0}*{box-sizing:border-box}header{padding:12px;background:#dbeafe;border-radius:12px;margin-bottom:16px}header p{font-size:13px}button,a{min-height:44px}a{color:#2249a5}${css}</style><div id="root"></div><script src="/fixture.js"></script><script>(${campaignChecks.toString()})();</script>`);
  });
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r)})};
}
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#dfc4ac"/><text x="60" y="220" font-size="60" fill="#402f23">TEST SALON</text></svg>';

function campaignChecks(){
  const firstReadyObserver=new MutationObserver(()=>{if(document.querySelector('h3')){window.campaignFirstReadyAt=performance.now();firstReadyObserver.disconnect()}});
  firstReadyObserver.observe(document.getElementById('root'),{childList:true,subtree:true});
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const check=(ok,label)=>{if(!ok)throw Error(label);window.campaignResults.checks.push(label)};
  const wait=async(fn,label,ms=2000)=>{const end=performance.now()+ms;while(!fn()){if(performance.now()>end)throw Error(label);await sleep(20)}};
  const headings=()=>[...document.querySelectorAll('h3')].map(x=>x.textContent);
  const set=async(mode,role='Guest',visible=true)=>{window.setCampaignFixture({mode,role,visible});await sleep(50)};
  window.runCampaignChecks=async()=>{
    window.campaignResults={checks:[],environment:'local actual React component, real image preparation, mocked delivery/roles; no production'};
    await wait(()=>window.setCampaignFixture,'React mount');
    await wait(()=>headings().includes('Fast salon'),'fast image ready');
    window.campaignResults.firstReadyAfterSelectionMs=window.campaignFirstReadyAt-window.campaignRequests[0].at;
    check(window.campaignResults.firstReadyAfterSelectionMs<1500,'first ready card does not wait for six-second sibling timeout');
    check(!headings().includes('Slow salon'),'fast sibling visible while slow image pending');
    check(headings().includes('Other ready salon'),'multiple ready cards independent');
    check(!headings().includes('Excluded sixth'),'max five selection preserved');
    check(document.querySelectorAll('[aria-label="Loading sponsored post"]').length>=1,'loading slot reserved');
    await sleep(1300);
    check(window.campaignRequests.filter(x=>x.body.kind==='view'&&x.body.ticket==='mixed-Fast salon').length===1,'one admission request for visible ready card');
    check(!window.campaignRequests.some(x=>x.body.kind==='view'&&x.body.ticket.includes('Slow')),'no view for pending image');
    check(!window.campaignRequests.some(x=>x.body.kind==='view'&&x.body.ticket.includes('Broken')),'no view for failed image');
    check(document.documentElement.scrollWidth<=innerWidth,'no horizontal page overflow');
    window.webkit?.messageHandlers?.campaignFixture?.postMessage({stage:'pending',result:window.campaignResults});
    await wait(()=>document.querySelectorAll('[aria-label="Loading sponsored post"]').length===0,'bounded failed-image fallback',6500);
    check(headings().join('|')==='Fast salon|Other ready salon|Text salon','only failed images removed; server order retained');
    await set('slow-first');await wait(()=>headings().includes('Ready second'),'ready second independent of slow first');
    check(document.querySelector('section').firstElementChild.querySelector('[aria-busy="true"]'),'slow first slot retains order');
    await set('delayed');await set('new');await wait(()=>headings().includes('new salon'),'new selection');await sleep(800);
    check(!headings().includes('delayed salon')&&!headings().includes('Slow first'),'aborted request/image cannot revive prior selection');
    for(const mode of ['outside','paused','expired']){await set(mode);await sleep(100);check(headings().length===0,mode+' empty mock response clears old ads')}
    for(const role of ['Personal','Owner','Guest']){await set(role,role);await wait(()=>headings().includes(role+' salon'),'mock role scope');check(headings().length===1,'mock '+role+' remount has only current card')}
    await set('deny');await wait(()=>headings().includes('deny salon'),'deny loaded');await wait(()=>headings().length===0,'denied admission removes card',2500);
    await set('return');await wait(()=>headings().includes('return salon'),'return first');await set('return','Guest',false);await set('return');await wait(()=>headings().includes('return salon'),'return mount');
    check(window.campaignRequests.filter(x=>x.body.kind==='select'&&x.body.location==='return').length===2,'return requests fresh delivery');
    document.querySelector('[aria-label="Hide sponsored post"]').click();await sleep(50);check(headings().length===0,'dismiss works');
    await set('Finished');await wait(()=>headings().includes('Finished salon'),'finished');
    window.campaignResults.passed=true;document.getElementById('summary').textContent=window.campaignResults.checks.length+' checks passed · mock data';
    window.webkit?.messageHandlers?.campaignFixture?.postMessage({stage:'complete',result:window.campaignResults});return window.campaignResults;
  };
  if(new URLSearchParams(location.search).has('auto'))setTimeout(()=>window.runCampaignChecks().catch(e=>{document.getElementById('summary').textContent='FAIL: '+e.message;window.webkit?.messageHandlers?.campaignFixture?.postMessage({stage:'failed',error:e.message,result:window.campaignResults})}),100);
}
