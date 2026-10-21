import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const mock=`export const getCurrentBusinessContext=async()=>globalThis.context;export const isOwnerMembership=m=>m?.role==='owner';export const isSalonManageContext=c=>c.workspace==='owner';export const getSalonProfileMediaUrl=p=>p?'/local/'+p:null;export const advertisingClient=()=>globalThis.client;`;
const bundle=await build({entryPoints:['app/campaigns/preview-actions.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'db',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/(current-context|explore-advertising|salon-profile)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='empty'?'':mock,loader:'js'}))}}]});
const{loadCampaignPreviewAction}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const id='00000000-0000-0000-0000-000000000001',salon='10000000-0000-0000-0000-000000000001';
const owner={user:{id:'owner',status:'active'},currentAccount:{status:'active'},currentSalon:{id:salon,status:'active'},currentMembership:{role:'owner'},workspace:'owner'};
const campaign={id,salon_id:salon,source_type:'custom',source_id:'creative',title:'Local salon',status:'running',views:7,spent_cents:2,total_price_cents:100,reserved_credits:100,released_credits:0};
test('actual owner guard, salon-scoped preview reads, repeat inspection and unavailable post have zero billing effects',async()=>{
 const calls=[];let installed=true,post=true;
 globalThis.client={rpc:async(name,args)=>{calls.push({name,args});if(name==='campaign_plugin_installed')return{data:installed};if(name==='owner_campaign_post')return{data:post?{media_path:'salon/v1/main.webp',caption:'red nails'}:null};throw Error('Unexpected RPC '+name)},from(table){calls.push({table});const filters={};return{select(){return this},eq(k,v){filters[k]=v;return this},async single(){calls.push({filters});return{data:filters.id===id&&filters.salon_id===salon?structuredClone(campaign):null}}}},storage:{from(bucket){return{createSignedUrl:async(path,expires)=>{calls.push({bucket,path,expires});return{data:{signedUrl:'/fixture-image'}}}}}}};
 for(const context of [{...owner,user:null},{...owner,workspace:'personal'},{...owner,currentMembership:{role:'staff'}},{...owner,currentAccount:{status:'inactive'}},{...owner,currentSalon:{id:salon,status:'inactive'}}]){globalThis.context=context;await assert.rejects(()=>loadCampaignPreviewAction(id));}assert.equal(calls.length,0,'unauthorized roles do not access DB');
 globalThis.context=owner;installed=false;await assert.rejects(()=>loadCampaignPreviewAction(id));installed=true;
 await assert.rejects(()=>loadCampaignPreviewAction('bad'));await assert.rejects(()=>loadCampaignPreviewAction('00000000-0000-0000-0000-000000000099'));
 globalThis.context={...owner,currentSalon:{id:'another',status:'active'}};await assert.rejects(()=>loadCampaignPreviewAction(id));globalThis.context=owner;
 for(let i=0;i<3;i++){const r=await loadCampaignPreviewAction(id);assert.equal(r.campaign.spent_cents,2);assert.equal(r.campaign.views,7);assert.equal(r.creative.image,'/fixture-image');assert.equal('ticket' in r,false);assert.equal('href' in r.creative,false);}
 post=false;assert.equal((await loadCampaignPreviewAction(id)).creative,null);
 assert.ok(calls.filter(c=>c.name).every(c=>['campaign_plugin_installed','owner_campaign_post'].includes(c.name)),'no close expired, admission, wallet or ledger RPC');
 assert.ok(calls.filter(c=>c.filters).every(c=>c.filters.id&&c.filters.salon_id),'all campaign reads scoped');
 assert.deepEqual(campaign,{id,salon_id:salon,source_type:'custom',source_id:'creative',title:'Local salon',status:'running',views:7,spent_cents:2,total_price_cents:100,reserved_credits:100,released_credits:0});
});
