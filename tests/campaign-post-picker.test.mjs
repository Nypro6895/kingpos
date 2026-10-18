import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('post picker supports original post schema and excludes held/deleted or other-salon posts',async()=>{
 const rows=[{id:'visible',title:'Salon nails',salon_id:'salon',status:'published'},{id:'draft',salon_id:'salon',status:'draft'},{id:'held',salon_id:'salon',status:'published',safety_hold:true},{id:'deleted',salon_id:'salon',status:'published',deleted_at:'2026-10-17'},{id:'other',salon_id:'other',status:'published'}];
 globalThis.__postRows=rows;
 const result=await build({entryPoints:['app/campaigns/actions.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'dependencies',setup(b){b.onResolve({filter:/^(next\/cache|@\/lib\/owner-campaigns)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='next/cache'?'export function revalidatePath(){}':`export async function ownerCampaignSettings(){};export async function requireCampaignOwner(){return{salonId:'salon',client:{from(){let rows=globalThis.__postRows;return{select(){return this},eq(key,value){rows=rows.filter(r=>r[key]===value);return this},is(){throw Error('Optional column is absent in original schema')},order(){return this},limit(){return Promise.resolve({data:rows,error:null})}}}}}}`,loader:'js'}));}}]});
 const {loadCampaignPostsAction}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
 const posts=await loadCampaignPostsAction();
 assert.deepEqual(posts.map(p=>[p.sourceType,p.sourceId,p.salonId]),[['salon_profile_look','visible','salon'],['salon_profile_update','visible','salon']]);
 delete globalThis.__postRows;
});
