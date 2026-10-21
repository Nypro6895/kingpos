import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const mock=`export const getCurrentBusinessContext=async()=>globalThis.previewContext;export const isOwnerMembership=m=>m?.role==='owner';export const isSalonManageContext=c=>c.workspace==='owner';export const getSalonProfileMediaUrl=p=>p?'/local/'+p:null;export const advertisingClient=()=>globalThis.previewClient;`;
const bundle=await build({entryPoints:['app/campaigns/preview-actions.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'read-authorities',setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'mock'}));
  b.onResolve({filter:/^@\/lib\/(current-context|explore-advertising|salon-profile)$/},a=>({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='empty'?'':mock,loader:'js'}));
}}]});
const {loadCampaignPreviewAction}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const id='00000000-0000-0000-0000-000000000001',salon='10000000-0000-0000-0000-000000000001';
const owner={user:{id:'owner',status:'active'},currentAccount:{status:'active'},currentSalon:{id:salon,status:'active'},currentMembership:{role:'owner'},workspace:'owner'};

function fixture(){
  const calls=[],state={installed:true,accountingError:false,postError:false,signError:false,mediaError:false,missingPost:false,postHang:false,signHang:false};
  const report={campaign:{id,salon_id:salon,source_type:'custom',source_id:'creative',title:'Local salon',status:'running',area:'city',location:'Milwaukee',country:'US',state:'WI',city:'Milwaukee',starts_at:'2026-10-20T00:00:00Z',ends_at:'2026-10-22T00:00:00Z',created_at:'2026-10-19T00:00:00Z',views:7,spent_cents:20,total_price_cents:60,reserved_credits:60,released_credits:0},returns:{total:40,known:40,closure:0,limit:40,complete:true,reason:null},checkedAt:'2026-10-21T12:00:00Z'};
  globalThis.previewContext=structuredClone(owner);
  globalThis.previewClient={
    async rpc(name,args){
      calls.push({name,args});
      if(name==='campaign_plugin_installed')return {data:state.installed,error:null};
      if(name==='campaign_owner_accounting'){
        assert.deepEqual(Object.keys(args).sort(),['p_id','p_owner','p_salon']);
        if(state.accountingError||args.p_id!==id||args.p_salon!==salon||args.p_owner!=='owner')return {data:null,error:{message:'Campaign preview is unavailable.'}};
        return {data:structuredClone(report),error:null};
      }
      if(name==='owner_campaign_post')return state.postHang?new Promise(()=>{}):{data:state.missingPost?null:{media_path:'salon/v1/main.webp',caption:'red nails'},error:state.postError?{message:'post unavailable'}:null};
      assert.fail('Unexpected mutation or delivery RPC '+name);
    },
    from(table){
      assert.equal(table,'beauty_post_media','accounting must come from one authorized RPC snapshot');
      return {select(){return this},eq(){return this},neq(){return this},order(){return this},limit(){return this},async maybeSingle(){return {data:{object_path:'beauty.webp'},error:state.mediaError?{message:'media unavailable'}:null}}};
    },
    storage:{from(bucket){return {
      async createSignedUrl(path,expires){calls.push({bucket,path,expires});return state.signHang?new Promise(()=>{}):{data:{signedUrl:'/fixture-image'},error:state.signError?{message:'signing unavailable'}:null}},
      getPublicUrl(path){calls.push({bucket,path});return {data:{publicUrl:'/fixture-beauty'}}},
    }}},
  };
  return {state,report,calls};
}
function cleanup(){delete globalThis.previewContext;delete globalThis.previewClient;}

test('one authorized accounting snapshot includes limit refunds and inspection has zero writes or tickets',async()=>{
  const {report,calls}=fixture(),before=structuredClone(report);
  try{
    for(let i=0;i<3;i++){
      const r=await loadCampaignPreviewAction(id);
      assert.deepEqual(r.campaign,report.campaign);assert.deepEqual(r.returns,report.returns);
      assert.equal(r.checkedAt,report.checkedAt,'DB snapshot timestamp retained');assert.equal(r.creative.image,'/fixture-image');assert.equal(r.creativeError,null);
      assert.equal('ticket' in r,false);assert.equal('href' in r.creative,false);
    }
    assert.equal(calls.filter(x=>x.name==='campaign_owner_accounting').length,3);
    assert.ok(calls.filter(x=>x.name).every(x=>['campaign_plugin_installed','campaign_owner_accounting','owner_campaign_post'].includes(x.name)));
    assert.deepEqual(report,before);
  }finally{cleanup();}
});

test('wrong owner/salon, missing campaign and accounting failures never fall back to counters or creative',async()=>{
  const {state,calls}=fixture();
  try{
    globalThis.previewContext={...owner,currentSalon:{id:'another',status:'active'}};await assert.rejects(()=>loadCampaignPreviewAction(id));
    globalThis.previewContext={...owner,user:{id:'another-owner',status:'active'}};await assert.rejects(()=>loadCampaignPreviewAction(id));
    globalThis.previewContext=structuredClone(owner);await assert.rejects(()=>loadCampaignPreviewAction('00000000-0000-0000-0000-000000000099'));
    state.accountingError=true;await assert.rejects(()=>loadCampaignPreviewAction(id));
    assert.ok(!calls.some(x=>x.name==='owner_campaign_post'));
  }finally{cleanup();}
});

test('incomplete historical or inconsistent refund totals remain unknown, not zero',async()=>{
  const {report}=fixture();
  try{
    for(const reason of ['legacy_unattributed_refunds','ledger_mismatch']){
      report.returns={total:null,known:40,closure:30,limit:10,complete:false,reason};
      const r=await loadCampaignPreviewAction(id);assert.deepEqual(r.returns,report.returns);
    }
  }finally{cleanup();}
});

test('post RPC and custom signing failure preserve accounting; creative retry remains read-only',async()=>{
  const {state,report,calls}=fixture(),before=structuredClone(report);
  try{
    for(const key of ['postError','signError']){
      state[key]=true;const r=await loadCampaignPreviewAction(id);
      assert.deepEqual(r.campaign,report.campaign);assert.deepEqual(r.returns,report.returns);assert.equal(typeof r.creativeError,'string');assert.ok(r.creativeError.length>0);
      state[key]=false;const retried=await loadCampaignPreviewAction(id);assert.equal(retried.creativeError,null);assert.equal(retried.creative.image,'/fixture-image');
    }
    state.missingPost=true;const r=await loadCampaignPreviewAction(id);assert.equal(r.creative,null);assert.equal(r.creativeError,null);assert.deepEqual(r.campaign,report.campaign);
    assert.deepEqual(report,before);assert.ok(!calls.some(x=>/admit|close|fund|reserve|release/i.test(x.name??'')));
  }finally{cleanup();}
});

test('beauty media failure is independent of accounting and retry restores the image',async()=>{
  const {state,report}=fixture();report.campaign.source_type='beauty_post';state.mediaError=true;
  try{
    const r=await loadCampaignPreviewAction(id);assert.deepEqual(r.campaign,report.campaign);assert.equal(typeof r.creativeError,'string');assert.equal(r.creative?.image??null,null);
    state.mediaError=false;const retried=await loadCampaignPreviewAction(id);assert.equal(retried.creativeError,null);assert.equal(retried.creative.image,'/fixture-beauty');
  }finally{cleanup();}
});

test('never-resolving optional post or image reads cannot indefinitely hide successful accounting',async()=>{
  for(const key of ['postHang','signHang']){
    const {state,report,calls}=fixture();state[key]=true;let timer;
    try{
      const result=await Promise.race([loadCampaignPreviewAction(id),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Optional media prevented accounting from returning within 4 seconds')),4000)})]);
      assert.deepEqual(result.campaign,report.campaign);assert.deepEqual(result.returns,report.returns);assert.equal(typeof result.creativeError,'string');
      assert.ok(calls.filter(x=>x.name).every(x=>['campaign_plugin_installed','campaign_owner_accounting','owner_campaign_post'].includes(x.name)));
    }finally{clearTimeout(timer);cleanup();}
  }
});
