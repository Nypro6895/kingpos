import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

function load(file,imports={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,URLSearchParams,require:name=>{
   if(name==='react')return React;
   if(name==='react/jsx-runtime')return jsx;
   if(name==='next/link')return {default:({prefetch,...props})=>React.createElement('a',props)};
   if(name==='next/image')return {default:({fill,...props})=>React.createElement('img',props)};
   return imports[name]??{};
  },
 });return exports;
}
const catalog=load('lib/nail-inspiration-catalog.ts');
const logic=load('lib/nail-inspiration.ts',{'@/lib/nail-inspiration-catalog':catalog});
const components=load('app/explore/nail-inspiration.tsx',{
 '@/lib/nail-inspiration':logic,'@/lib/nail-inspiration-catalog':catalog,
 '@/components/nail-illustration-credit':{LumiAiWatermark:()=>null},
 '@/components/explore-account-actions':{ExploreReferenceLove:()=>null,ExploreBookButton:({href})=>React.createElement('a',{href},'Book')},
});
const salon={id:'00000000-0000-4000-8000-000000000001',name:'Honolulu Nails',city:'Honolulu',state:'HI',distanceMiles:.5,phone:'8085550100',bookingEnabled:false};
const look=catalog.nailLookById('fawn-print-almond');

test('paired AI reference names and links the salon for both contact and bookable businesses',()=>{
 for(const bookable of [false,true]){
  const html=renderToStaticMarkup(React.createElement(components.NailInspirationCard,{look,salon:{...salon,bookingEnabled:bookable,bookingHref:bookable?'/book/'+salon.id:null},location:'Honolulu, HI'}));
  assert.match(html,/Honolulu Nails/);assert.match(html,/0.5 mi/);
  assert.match(html,new RegExp(`href="/explore/salons/${salon.id}"[^>]*aria-label="View Honolulu Nails"`));
  assert.match(html,/Not a photo of this salon’s work/);
  assert.doesNotMatch(html,/Find a salon for this look|type=posts/);
 }
});

test('unpaired reference has a salon destination, not another style search',()=>{
 const html=renderToStaticMarkup(React.createElement(components.NailInspirationCard,{look,location:'Honolulu, HI'}));
 assert.match(html,/type=salons/);assert.match(html,/category=Nails/);assert.match(html,/location=Honolulu%2C\+HI/);
 assert.doesNotMatch(html,/type=posts|q=brown/);
});

test('opening a look in a chosen area resolves a real nearby salon; empty/error cases stay navigable',async()=>{
 const inputs=[];let response={error:null,results:[{...salon,id:'showcase-fake'},salon]};
 const page=load('app/(app)/explore/inspiration/[lookId]/page.tsx',{
  'next/navigation':{notFound:()=>{throw Error('not found');}},
  '@/app/explore/nail-inspiration':components,'@/lib/nail-inspiration-catalog':catalog,'@/lib/nail-inspiration':logic,
  '@/lib/explore-search':{searchExploreSalons:async input=>{inputs.push(input);return response;}},
 }).default;
 const props={params:Promise.resolve({lookId:look.id}),searchParams:Promise.resolve({location:'Honolulu, HI'})};
 let html=renderToStaticMarkup(await page(props));
 assert.match(html,/Honolulu Nails/);assert.doesNotMatch(html,/data-salon-id="showcase/);
 assert.equal(inputs[0].location,'Honolulu, HI');assert.equal(inputs[0].scopePolicy,'fixed');
 assert.equal(inputs[0].sort,'closest');assert.equal(inputs[0].query,'');
 for(const error of [null,'Unavailable']){
  response={error,results:[]};html=renderToStaticMarkup(await page(props));assert.match(html,/type=salons/);
 }
 await page({...props,searchParams:Promise.resolve({})});
 assert.equal(inputs.length,3,'missing location does not invent a nearby business from a global query');
});
