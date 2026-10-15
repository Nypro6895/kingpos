import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync('lib/explore-search-metrics.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
const metric=exports.exploreSearchMetric;
test('operational search metrics distinguish real empty, content delegation, location and failure without private values',()=>{
 const input={query:'private phrase',latitude:43.123456,longitude:-87.654321,sort:'trusted',cursor:{id:'private-id'}};
 const base={results:[],target:'salons',hasMore:false,location:'My home',locationSource:'gps',scope:{policy:'fixed',stage:'A'},error:null};
 assert.equal(metric(input,base,234.4).outcome,'empty');
 assert.equal(metric(input,{...base,error:'timeout',errorKind:'timeout'},1).outcome,'timeout');
 assert.equal(metric(input,{...base,target:'posts'},1).outcome,'content_search');
 assert.equal(metric(input,{...base,requiresGps:true},1).outcome,'needs_location');
 const value=metric(input,{...base,results:[{id:'private-id'}],appliedSort:'relevance'},234.4);
 assert.equal(value.outcome,'matches');assert.equal(value.durationMs,234);assert.equal(value.continuation,true);assert.equal(value.requestedSort,'trusted');
 const text=JSON.stringify(value);for(const secret of ['private phrase','private-id','My home','43.123456','87.654321'])assert.ok(!text.includes(secret));
 assert.equal(metric({sort:'raw malicious sort'},{...base,locationSource:'raw-location'},Infinity).durationMs,0);
});
