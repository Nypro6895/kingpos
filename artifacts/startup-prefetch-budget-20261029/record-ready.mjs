import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {recordEvent} from '../../scripts/release-journal.mjs';
const p='artifacts/startup-prefetch-budget-20261029/', commit='7ccb53a507839d6f439ecda90e162d7638d9e08c';
const snapshot=path.resolve(p+'ready-source'), read=n=>JSON.parse(fs.readFileSync(p+n));
const w=read('web-candidate-source-verified.json'), scope=read('source-cleanup-verified.json');
if(w.state!=='READY'||w.sourceCommit!==commit||w.mismatches.length||w.extras.length||!scope.deletedObserver||scope.restoredOriginalRoutes.some(x=>!x.byteIdenticalToBeforeObserver))throw Error('Frozen build/source proof missing');
if(!/tests 23\s+[\s\S]*pass 23\s+[\s\S]*fail 0/.test(fs.readFileSync(p+'tests.log','utf8')))throw Error('23 tests not passed');
const files=['lib/app-local-prefetch.ts','tests/app-local-prefetch-runtime.test.mjs','app/api/app-local/context/route.ts','app/api/app-local/read/route.ts'];
for(const file of files){const dest=path.join(snapshot,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,cp.execFileSync('git',['show',commit+':'+file]));}
if(fs.existsSync(p+'prefetch-ready-event.json')||fs.existsSync(p+'cleanup-ready-event.json'))throw Error('Ready already recorded');
const a=recordEvent({kind:'change',changeId:'startup-prefetch-budget-20261029',status:'ready',summary:'Bound off-route speculative DTO reads to two per accepted identity; selected route remains eligible, preserving existing authority, freshness, invalidation and retained visited-page DTOs. Before regression drains twelve hidden reads; after23/23 browser/plan tests pass. Unwarmed pages load normally when selected.',channels:['web','ios'],files:files.slice(0,2),source:{snapshot,commit},validation:[{name:'23 actual-browser runtime and plan tests, zero skipped',result:'passed',evidence:p+'tests.log'},{name:'Frozen production web build and3546 exact uploaded source files',result:'passed',evidence:p+'web-candidate-source-verified.json'}]});
fs.writeFileSync(p+'prefetch-ready-event.json',JSON.stringify(a,null,2));
const deleted=['lib/app-local-read-observation.ts','tests/app-local-read-observation.test.mjs'];
const b=recordEvent({kind:'change',changeId:'startup-read-observation-20261029',status:'ready',summary:'Remove finite startup observation helper and privacy test, restore both API routes byte-for-byte to pre-observer production. Preserve all frozen measurement evidence; no TTL extension, future-log live readback required for publication receipt.',channels:['web'],files:[...files.slice(2),...deleted],deletedFiles:deleted,source:{snapshot,commit},supersedesEvents:['f5d715a7-34ba-4cd9-8a42-29797da193c5'],validation:[{name:'Exact original API route bytes and observer absence',result:'passed',evidence:p+'source-cleanup-verified.json'},{name:'Frozen production build and exact source match',result:'passed',evidence:p+'web-candidate-source-verified.json'}]});
fs.writeFileSync(p+'cleanup-ready-event.json',JSON.stringify(b,null,2));
console.log({prefetch:a.id,cleanup:b.id,commit});
