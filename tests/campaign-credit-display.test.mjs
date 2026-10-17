import test from 'node:test';import assert from 'node:assert/strict';import {build}from'esbuild';
const result=await build({entryPoints:['lib/campaign-credit-display.ts','app/role-navigation.ts'],outdir:'out',bundle:true,write:false,format:'esm',platform:'node'});
const load=async name=>import('data:text/javascript;base64,'+Buffer.from(result.outputFiles.find(f=>f.path.endsWith(name+'.js')).text).toString('base64'));
const {displayCredits,creditUnits,formatCredits}=await load('campaign-credit-display');
const {ROLE_MORE_ITEMS,ROLE_NAVIGATION,OWNER_MORE_GROUPS}=await load('role-navigation');
test('credit denomination preserves every stored unit without repricing or rounding away value',()=>{for(const n of [0,1,2,99,100,294,500,1500,5000,100000])assert.equal(creditUnits(displayCredits(n)),n);assert.equal(formatCredits(500),'60');assert.equal(formatCredits(294),'35.28');for(const n of [NaN,Infinity,-1,1.01])assert.throws(()=>creditUnits(n));});
test('all owner More surfaces have one priority and no missing entries',()=>{const ids=OWNER_MORE_GROUPS.flatMap(g=>g.ids);assert.deepEqual(ROLE_MORE_ITEMS.owner.map(i=>i.id),ids);assert.deepEqual(ROLE_NAVIGATION.owner.moreLinks.map(i=>i.id),ids);assert.deepEqual(ids.slice(0,7),['owner-pos','owner-ticket','owner-customers','owner-report','owner-payroll','owner-staff','owner-services']);assert.equal(new Set(ids).size,ids.length);});
