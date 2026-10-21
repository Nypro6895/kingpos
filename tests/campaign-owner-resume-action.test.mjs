import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const mock=`export const getCurrentBusinessContext=async()=>globalThis.resumeContext;export const isOwnerMembership=m=>m?.role==='owner';export const isSalonManageContext=c=>c.workspace==='owner';export const advertisingClient=()=>globalThis.resumeClient;export const revalidatePath=path=>globalThis.resumeRevalidations.push(path);`;
const bundle=await build({entryPoints:['app/campaigns/actions.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'action-boundary',setup(b){
  b.onResolve({filter:/^(server-only|next\/cache|@\/lib\/(current-context|explore-advertising))$/},a=>({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='server-only'?'':mock,loader:'js'}));
}}]});
const {changeOwnerCampaignAction}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const campaign='00000000-0000-0000-0000-000000000001',episode='00000000-0000-0000-0000-000000000002',newEpisode='00000000-0000-0000-0000-000000000003';
function fixture({sticky=false}={}){
  const calls=[];
  globalThis.resumeContext={user:{id:'owner',status:'active'},currentAccount:{status:'active'},currentSalon:{id:'salon',status:'active'},currentMembership:{role:'owner'},workspace:'owner'};
  globalThis.resumeRevalidations=[];
  globalThis.resumeClient={async rpc(name,args){calls.push({name,args});if(name==='campaign_plugin_installed')return {data:true};if(name==='owner_campaign_resume')return args.p_episode===newEpisode?{error:null}:{error:{message:'This pause changed. Refresh before resuming.'}};if(name==='owner_campaign_change')return sticky&&args.p_action==='resume'?{error:{message:'Refresh before resuming an owner pause.'}}:{error:null};assert.fail('Unexpected RPC '+name)},from(){assert.fail('Never read the latest pause episode to repair a stale request')}};
  return calls;
}
function cleanup(){delete globalThis.resumeContext;delete globalThis.resumeClient;delete globalThis.resumeRevalidations;}

test('Resume requires the pause episode the owner actually saw; missing and malformed tokens never mutate',async()=>{
  const calls=fixture();
  try{
    for(const token of [undefined,null,'',123,'not-a-uuid']){
      const r=await changeOwnerCampaignAction(campaign,'resume',token);assert.equal(r.ok,false);assert.match(r.message,/Refresh/);
    }
    assert.ok(calls.every(x=>x.name==='campaign_plugin_installed'));assert.deepEqual(globalThis.resumeRevalidations,[]);
  }finally{cleanup();}
});

test('delayed Resume keeps its old token and cannot resume a newer owner Pause',async()=>{
  const calls=fixture();
  try{
    const stale=await changeOwnerCampaignAction(campaign,'resume',episode);assert.equal(stale.ok,false);assert.match(stale.message,/pause changed/);
    assert.deepEqual(calls.find(x=>x.name==='owner_campaign_resume').args,{p_id:campaign,p_salon:'salon',p_user:'owner',p_episode:episode});
    assert.ok(!calls.some(x=>x.name==='owner_campaign_change'));assert.deepEqual(globalThis.resumeRevalidations,[]);
    const current=await changeOwnerCampaignAction(campaign,'resume',newEpisode);assert.equal(current.ok,true);assert.deepEqual(globalThis.resumeRevalidations,['/campaigns']);
  }finally{cleanup();}
});

test('Pause and explicit Cancel retain their original authorized mutation path',async()=>{
  const calls=fixture();
  try{
    for(const action of ['pause','cancel'])assert.equal((await changeOwnerCampaignAction(campaign,action)).ok,true);
    assert.deepEqual(calls.filter(x=>x.name==='owner_campaign_change').map(x=>x.args.p_action),['pause','cancel']);
    assert.ok(!calls.some(x=>x.name==='owner_campaign_resume'));
  }finally{cleanup();}
});

test('explicit unmarked admin Pause resumes through the legacy server guard without inventing an episode',async()=>{
  for(const sticky of [false,true]){
    const calls=fixture({sticky});
    try{
      const result=await changeOwnerCampaignAction(campaign,'resume',null,'non_owner');
      assert.equal(result.ok,!sticky);
      assert.deepEqual(calls.find(x=>x.name==='owner_campaign_change').args,{p_id:campaign,p_salon:'salon',p_user:'owner',p_action:'resume'});
      assert.ok(!calls.some(x=>x.name==='owner_campaign_resume'));
      assert.deepEqual(globalThis.resumeRevalidations,sticky?[]:['/campaigns']);
      if(sticky)assert.match(result.message,/owner pause/);
    }finally{cleanup();}
  }
});

test('the explicit admin mode still requires a displayed null token and never repairs malformed input',async()=>{
  const calls=fixture();
  try{
    for(const token of [undefined,'','malformed'])assert.equal((await changeOwnerCampaignAction(campaign,'resume',token,'non_owner')).ok,false);
    assert.ok(calls.every(x=>x.name==='campaign_plugin_installed'));
  }finally{cleanup();}
});

test('non-owner Resume never reaches the database',async()=>{
  const calls=fixture();globalThis.resumeContext.currentMembership.role='staff';
  try{assert.equal((await changeOwnerCampaignAction(campaign,'resume',newEpisode)).ok,false);assert.deepEqual(calls,[]);}
  finally{cleanup();}
});
