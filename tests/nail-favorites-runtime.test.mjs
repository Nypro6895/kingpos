import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,imports){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:key=>{assert.ok(key in imports,key);return imports[key];}});return exports;}
function fixture(){
 const actor='11111111-1111-4111-8111-111111111111';let authenticated=true;let calls=0;const rows=new Map();
 function query(){let selectedUser,key,keys,operation='read';return {
  select(){return this;},eq(field,value){if(field==='user_id')selectedUser=value;if(field==='item_key')key=value;return this;},in(_field,value){keys=value;return this;},
  async upsert(row){calls++;assert.equal(row.user_id,actor);rows.set(row.user_id+':'+row.item_key,row);return{error:null};},delete(){operation='delete';return this;},
  async maybeSingle(){calls++;assert.equal(selectedUser,actor);return{data:rows.get(actor+':'+key)??null,error:null};},
  then(resolve){calls++;assert.equal(selectedUser,actor);if(operation==='delete')rows.delete(actor+':'+key);resolve({data:[...rows.values()].filter(row=>row.user_id===actor&&(!keys||keys.includes(row.item_key))),error:null});}
 };}
 const actions=load('app/explore/account-actions.ts',{
  '@/lib/supabase/server':{getSupabaseAuthUser:async()=>authenticated?{id:'different-auth-id'}:null,createAuthenticatedSupabaseServerClient:async()=>({rpc:async()=>({data:actor,error:null})})},
  'next/cache':{revalidatePath:()=>{}},'@/lib/explore-advertising':{advertisingClient:()=>({from:()=>query()})},
  '@/lib/explore-reference-favorites':{validReferenceFavoriteKey:key=>typeof key==='string'&&/^look:nail-[a-z-]+$/.test(key),resolveReferenceFavorites:async keys=>({items:keys.includes('look:nail-cherry-stiletto')?[{key:'look:nail-cherry-stiletto'}]:[],error:null})},
 });
 return {actions,rows,actor,calls:()=>calls,logout:()=>authenticated=false};
}
test('a look saved through two salons has one account record, reloads, and can be removed',async()=>{
 const f=fixture(),key='look:nail-cherry-stiletto';
 assert.equal((await f.actions.referenceLoveAction(key,true)).active,true);
 assert.equal((await f.actions.referenceLoveAction(key,true)).active,true);
 assert.equal(f.rows.size,1);
 assert.equal((await f.actions.referenceLoveAction(key)).active,true);
 const loaded=await f.actions.referenceLoveStatesAction([key,'look:nail-other']);assert.deepEqual(Array.from(loaded.keys),[key]);
 assert.equal((await f.actions.referenceLoveAction(key,false)).active,false);assert.equal(f.rows.size,0);
 assert.equal((await f.actions.referenceLoveAction('look:nail-invented',true)).error,'This item is unavailable.');
});
test('favorite batches use mapped identity, never another actor, reject oversized input and skip guest DB reads',async()=>{
 const f=fixture();f.rows.set('other',{user_id:'another-user',item_key:'look:nail-cherry-stiletto'});
 const result=await f.actions.referenceLoveStatesAction(['look:nail-cherry-stiletto']);assert.equal(result.keys.length,0);
 assert.ok((await f.actions.referenceLoveStatesAction(Array(41).fill('look:nail-cherry-stiletto'))).error);
 f.logout();const before=f.calls();assert.equal((await f.actions.referenceLoveStatesAction(['look:nail-cherry-stiletto'])).keys.length,0);assert.equal(f.calls(),before);
 assert.ok((await f.actions.referenceLoveAction('look:nail-cherry-stiletto',true)).error);assert.equal(f.calls(),before);
});
