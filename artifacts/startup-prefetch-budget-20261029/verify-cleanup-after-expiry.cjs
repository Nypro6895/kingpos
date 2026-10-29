const fs=require('fs'),cp=require('child_process');
const p='artifacts/startup-prefetch-budget-20261029/',deployment='dpl_DQAyjLPjF7yApXvJaKhLxwdVzxi9';
async function query(kind,q,since,until){return new Promise((resolve,reject)=>cp.execFile('cmd.exe',['/d','/c',`npx.cmd vercel logs ${kind} --project kingpos --scope kingpos --deployment ${deployment} --query ${q} --since ${since} --until ${until} --limit 1000 --json`],{encoding:'utf8',maxBuffer:12e6},(e,out)=>{if(e)return reject(e);try{const rows=out.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse),summary=rows.find(r=>r.type==='summary');if(!summary||summary.pagination?.hasMore||summary.excludedIntervals?.length)throw Error('Incomplete log coverage');resolve({rows,summary});}catch(e){reject(e)}}));}
(async()=>{
const source=JSON.parse(fs.readFileSync(p+'web-live-source-verified.json'));if(source.deployment!==deployment||source.state!=='READY'||source.mismatches.length||source.extras.length)throw Error('Live source not verified');
let probe=fs.existsSync(p+'cleanup-after-expiry-public-probe.json')?JSON.parse(fs.readFileSync(p+'cleanup-after-expiry-public-probe.json')):null;
const since=probe?.since??new Date().toISOString(),headers={'User-Agent':'ReylumiCoordinatorMetadataProbe/1.0'},base='https://reylumi.com';
if(!probe){
const a=await fetch(base+'/api/app-local/context?'+new URLSearchParams({path:'/explore',generation:'qa-cleanup-probe-20261029'}),{headers,signal:AbortSignal.timeout(30000)}),body=await a.json();
if(a.status!==200||typeof body.context?.scope!=='string'||body.context.authenticated)throw Error('Original public context probe failed');
const b=await fetch(base+'/api/app-local/read?'+new URLSearchParams({name:'shell.navigation',scope:body.context.scope,args:'{}'}),{headers,signal:AbortSignal.timeout(30000)});await b.arrayBuffer();if(b.status!==200)throw Error('Original allowed public read failed');
probe={at:new Date().toISOString(),since,deployment,contextStatus:a.status,readStatus:b.status,anonymous:true,writes:0,noBodyHeadersOrIdentityRetained:true};fs.writeFileSync(p+'cleanup-after-expiry-public-probe.json',JSON.stringify(probe,null,2));
}
await new Promise(r=>setTimeout(r,10000));const until=new Date().toISOString();
const querySince=new Date(Date.parse(since)-2000).toISOString();
const [cdn,runtime]=await Promise.all([query('requests','clientUserAgent:ReylumiCoordinatorMetadataProbe/1.0',querySince,until),query('runtime','app_local_read_observation_v1',querySince,until)]);
const requests=cdn.rows.filter(r=>r.type==='request').map(r=>({utc:new Date(r.data.timestamp).toISOString(),path:new URL(r.data.requestPath,'https://reylumi.com').pathname,method:r.data.requestMethod,status:r.data.httpStatus}));
let emitted=0;for(const r of runtime.rows.filter(r=>r.type==='log')){try{if(JSON.parse(r.data.message).event==='app_local_read_observation_v1')emitted++;}catch{}}
fs.writeFileSync(p+'cleanup-after-expiry-log-readback-attempt.json',JSON.stringify({at:new Date().toISOString(),since,querySince,until,requests,events:emitted,cdnSummary:cdn.summary,runtimeSummary:runtime.summary},null,2));
if(!['/api/app-local/context','/api/app-local/read'].every(path=>requests.some(r=>r.path===path&&r.status===200))||emitted)throw Error('Controlled read log coverage / observer silence failed: requests='+requests.length+' events='+emitted);
const proof={at:new Date().toISOString(),deployment,since,querySince,until,probe,controlledCdnRequests:requests.length,requests,newObservationEvents:emitted,cdnSummary:cdn.summary,runtimeSummary:runtime.summary,originalHooksRemovedAndSourceVerified:true,expiryExtended:false,probeBeforeOriginalExpiry:Date.parse(probe.at)<Date.parse('2026-10-29T11:30:00Z'),cleanupPerformed:true,privacy:'Only public metadata probe, no bodies/raw headers/cookies/IDs stored. Existing frozen measurements retained; provider historical log retention unchanged.'};fs.writeFileSync(p+'live-cleanup-after-expiry-verified.json',JSON.stringify(proof,null,2));console.log({cleanup:true,deployment,requests:requests.length,newObservationEvents:emitted,beforeExpiry:proof.probeBeforeOriginalExpiry});
})().catch(e=>{console.error(e.message);process.exitCode=1});
