import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import vm from 'node:vm';
const module={exports:{}};vm.runInNewContext(buildSync({entryPoints:['lib/reward-discovery-area.ts'],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text,{module,exports:module.exports});const area=module.exports.rewardDiscoveryArea;
test('public reward area uses explicit city/state or ZIP without protected-row reads',()=>{
 assert.equal(area('Chicago, IL').city,'Chicago');assert.equal(area('Chicago, Illinois, US').state,'IL');assert.equal(area('60601').postal,'60601');assert.equal(area('60601, IL, US').state,'IL');assert.equal(area('60601-1234').label,'ZIP 60601');
 for(const ambiguous of ['Chicago','IL','US','Anywhere','Chicago, ZZ','%','New_York, NY',''])assert.equal(area(ambiguous),null,ambiguous);
});
