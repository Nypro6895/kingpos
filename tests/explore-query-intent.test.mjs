import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/explore-query-intent.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const parse=exports.parseExploreQueryIntent;
test('service, exact brand, area and GPS phrases keep distinct meanings',()=>{
 const near=parse('nails near Milwaukee');
 assert.equal(near.target,'salons');assert.equal(near.query,'nails');assert.equal(near.categoryHint,'Nails');assert.equal(near.locationHint,'Milwaukee');assert.equal(near.nearMe,false);
 const brand=parse('King Nails in Milwaukee');
 assert.equal(brand.query,'King Nails');assert.equal(brand.categoryHint,'');assert.equal(brand.locationHint,'Milwaukee');assert.equal(brand.tentativeArea,true);
 const gps=parse('nails near me');
 assert.equal(gps.query,'nails');assert.equal(gps.nearMe,true);assert.equal(gps.locationHint,'');assert.equal(gps.cityQuery,'');
 assert.equal(parse('near Milwaukee').locationHint,'Milwaukee');
 assert.equal(parse('Walk In Nails').query,'Walk In Nails');
 assert.equal(parse('Nearby Nails').query,'Nearby Nails');
});
test('organic design phrases retain mandatory themes after category and routing cues are removed',()=>{
 const christmas=parse('christmas nail design');
 assert.equal(christmas.target,'posts');assert.equal(christmas.contentQuery,'christmas');assert.equal(christmas.categoryHint,'Nails');
 const compound=parse('red ombre nail designs near Milwaukee');
 assert.equal(compound.contentQuery,'red ombre');assert.equal(compound.locationHint,'Milwaukee');
 assert.equal(parse('nail design').contentQuery,'design','a generic content cue does not become an unfiltered directory feed');
 assert.equal(parse('King Nails',{target:'posts'}).target,'posts');
 assert.equal(parse('christmas nail design',{target:'salons'}).target,'salons');
});
test('structured city/state and postal inputs are areas while quoted names are names',()=>{
 for(const value of ['Milwaukee, WI','Milwaukee Wisconsin','Milwaukee WI']){
  const intent=parse(value);assert.equal(intent.locationHint,'Milwaukee, WI');assert.equal(intent.query,'');assert.equal(intent.locationArea.stateCode,'WI');
 }
 assert.equal(parse('Wisconsin').locationHint,'WI');assert.equal(parse('53202').locationArea.kind,'postal');
 assert.equal(parse('Milwaukee').cityQuery,'Milwaukee','an arbitrary bare city is confirmed using current public data');
 assert.equal(parse('"Milwaukee"').query,'Milwaukee');assert.equal(parse('"Milwaukee"').cityQuery,'');
 assert.equal(parse('salon named King Nails').query,'King Nails');
 assert.equal(parse('salon near Milwaukee').locationHint,'Milwaukee');
});
test('routing text is bounded and control characters cannot enter public RPC inputs',()=>{
 const intent=parse('christmas\u0000 nail\n design');assert.equal(intent.displayQuery,'christmas nail design');assert.equal(intent.contentQuery,'christmas');
 assert.equal(parse('x'.repeat(200)).displayQuery.length,160);
});

test('style and specific service constraints survive content routing',()=>{
 for(const [input,category,theme] of [
  ['French nail design','Nails','french'],['gel nail designs','Nails','gel'],
  ['acrylic nail ideas','Nails','acrylic'],['hair extensions ideas','Hair','extensions'],
  ['full set nail design','Nails','full set'],['classic lash looks','Lashes','classic'],
  ['pedicure inspiration','Nails','pedicure'],['French gel nail design near Milwaukee','Nails','french gel'],
 ]) {const p=parse(input);assert.equal(p.target,'posts');assert.equal(p.categoryHint,category);assert.equal(p.contentQuery,theme);}
 const quoted=parse('"French Nails"',{target:'posts'});assert.equal(quoted.contentQuery,'french nails');
 assert.equal(parse('Gel Nails',{target:'salons'}).query,'Gel Nails');
 assert.equal(parse('Christmas nail design').contentQuery,'christmas');
});
test('common near-by and current-location aliases preserve service, explicit city and quoted brand meanings',()=>{
 for(const query of ['nails near by','nails near by me','nails near my location','nails near current location']){
  const result=parse(query);assert.equal(result.nearMe,true);assert.equal(result.query,'nails');assert.equal(result.categoryHint,'Nails');assert.equal(result.locationHint,'');assert.equal(result.displayQuery,query);
 }
 const city=parse('King Nails near by Milwaukee');assert.equal(city.query,'King Nails');assert.equal(city.locationHint,'Milwaukee');assert.equal(city.nearMe,false);assert.equal(city.tentativeArea,false);
 assert.equal(parse('near by Milwaukee').locationHint,'Milwaukee');
 const quoted=parse('"KingNails near by"');assert.equal(quoted.query,'KingNails near by');assert.equal(quoted.nearMe,false);assert.equal(quoted.locationHint,'');
});

test('combined service and area text preserves the service before state, ZIP and tentative city recognition',()=>{
 for(const [query,area,kind] of [['nails WI','WI','state'],['nails Wisconsin','Wisconsin','state'],['nails 53202','53202','postal'],['nails 53202-1234','53202-1234','postal']]) {
  const p=parse(query);assert.equal(p.query,'nails');assert.equal(p.categoryHint,'Nails');assert.equal(p.locationHint,area);assert.equal(p.locationArea.kind,kind);assert.equal(p.directArea,false);assert.equal(p.cityQuery,'');
 }
 const city=parse('nails Milwaukee');assert.equal(city.query,'nails');assert.equal(city.locationHint,'Milwaukee');assert.equal(city.cityQuery,'Milwaukee');assert.equal(city.tentativeArea,true);
 const constrained=parse('nail place Milwaukee WI');assert.equal(constrained.query,'nail place');assert.equal(constrained.locationArea.city,'Milwaukee');assert.equal(constrained.locationArea.stateCode,'WI');
 const brand=parse('King Nails Milwaukee');assert.equal(brand.query,'King Nails');assert.equal(brand.locationHint,'Milwaukee');
 assert.equal(parse('King Nails').query,'King Nails');assert.equal(parse('King Nails').locationHint,'');
 assert.equal(parse('"Nails WI"').query,'Nails WI');assert.equal(parse('"Nails WI"').locationHint,'');
});

test('combined content and service searches retain styles while proposing a separate area',()=>{
 for(const [query,theme,area] of [['French gel nail design Milwaukee','french gel','Milwaukee'],['red ombre nail designs WI','red ombre','WI'],['hair extensions ideas 53202','extensions','53202']]) {
  const p=parse(query);assert.equal(p.target,'posts');assert.equal(p.contentQuery,theme);assert.equal(p.locationHint,area);
 }
 assert.equal(parse('French gel nails WI').query,'French gel nails');assert.equal(parse('French gel nails WI').categoryOnly,false);
});
