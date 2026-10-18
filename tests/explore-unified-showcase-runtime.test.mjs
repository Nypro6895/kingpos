import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
test('even explicit demo mode cannot inject fake salons into a unified search',()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync('lib/explore-showcase-content.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,process:{env:{EXPLORE_ENABLE_DEMO_CONTENT:'true'}}});
 for(const error of [null,'unavailable']) {
  const searchResponse={searchVersion:3,query:'nonexistent',error,results:[],sections:{bestMatches:[],nearby:[],recommended:[],reference:[]},totalCount:0};
  const actual=exports.enrichExploreShowcaseContent({searchResponse,discoveryContent:{shortcuts:[]},initialFeed:{items:[]},homeContent:{recommendedSalons:[],newSalons:[],inspiration:{items:[]},popularServices:[]}});
  assert.equal(actual.searchResponse,searchResponse);assert.equal(actual.searchResponse.results.length,0);
  assert.ok(actual.homeContent.recommendedSalons.length>0,'independent opt-in home demos remain intact');
 }
});
