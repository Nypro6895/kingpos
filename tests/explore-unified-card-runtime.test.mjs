import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

function load(file,deps={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports,require:name=>deps[name]??{}});
 return exports;
}
const defaults=load('lib/default-nail-images.ts');
const social={useSalonSocial:()=>({state:{hidden:false}}),ExploreSalonFollow:()=>null,ExploreSalonMenu:()=>null,ExploreSocialActions:()=>null};
const {ExploreSalonCard}=load('app/explore/explore-salon-card.tsx',{
 react:React,'react/jsx-runtime':jsx,
 'next/link':{__esModule:true,default:({prefetch,...props})=>React.createElement('a',props)},
 'next/image':{__esModule:true,default:({fill,...props})=>React.createElement('img',props)},
 './explore-viewport-image':{ExploreViewportImage:({fill,...props})=>React.createElement('img',props)},
 '@/components/explore-social':social,'@/lib/explore-social':{isSalonId:value=>/^[0-9a-f-]{36}$/.test(value)},
 '@/lib/default-nail-images':defaults,'@/components/nail-illustration-credit':{NailIllustrationCredit:()=>null},
 '@/components/salon-trust-line':{SalonVerifiedBadge:()=>null},'./explore-salon-card.module.css':{default:{}},
});
const salon={id:'10000000-0000-4000-8000-000000000001',name:'Same Nails',city:'Milwaukee',state:'WI',serviceCategories:['Nails'],coverImageUrl:null,bookingEnabled:false,bookingHref:null};
const render=patch=>renderToStaticMarkup(React.createElement(ExploreSalonCard,{salon:{...salon,...patch}}));

test('suggested image retains one salon identity, no style title, and matching image/name destinations',()=>{
 const html=render({coverImageUrl:'/inspiration/nails/cherry-stiletto.webp',imageProvenance:'suggested'});
 assert.match(html,/Suggested image/);assert.match(html,/not actual salon work/);
 assert.equal((html.match(new RegExp(`href="/explore/salons/${salon.id}"`,'g'))??[]).length,3);
 assert.doesNotMatch(html,/Cherry stiletto|Browse nail|\/explore\/inspiration\//);
 assert.match(html,/text-xs text-white">Suggested image/);assert.doesNotMatch(html,/font-(bold|semibold|medium)[^"]*">Suggested image/);
});

test('only owner-matched public media renders as salon work and claim state does not gate replacement',()=>{
 for(const imageProvenance of ['salon_post','customer_post','salon_cover']){
  for(const claimed of [false,true]){
   const html=render({coverImageUrl:'/real.webp',imageProvenance,imageSourceSalonId:salon.id,hasPublicProfile:claimed,mediaRevision:'new-public-photo'});
   assert.match(html,/src="\/real.webp"/);assert.doesNotMatch(html,/Suggested image|not actual salon work/);
  }
  const mismatched=render({coverImageUrl:'/another-salon.webp',imageProvenance,imageSourceSalonId:'10000000-0000-4000-8000-000000000002'});
  assert.doesNotMatch(mismatched,/another-salon.webp/);assert.match(mismatched,/Suggested image/);
 }
});
