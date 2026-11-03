
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
process.env.ADVERTISING_IP_HASH_SECRET='isolated-campaign-ticket-test';
const viewer='00000000-0000-0000-0000-000000000002',cookie='90000000-0000-0000-0000-000000000001';
const built=await build({entryPoints:['app/api/campaigns/delivery/route.ts','lib/owner-campaign-delivery.ts'],bundle:true,write:false,outdir:'out',format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'isolated-server',setup(b){
 const stub={
  'server-only':'',
  'next/headers':"export const cookies=async()=>({get:()=>({value:'90000000-0000-0000-0000-000000000001'})});",
  '@/lib/current-context':"export const getCurrentBusinessContext=async()=>({user:{id:globalThis.testViewer}});",
  '@/lib/explore-advertising':'export const advertisingClient=()=>({rpc:async(name,args)=>{globalThis.testRpc.push({name,args});return {data:true,error:null}}});',
  '@/lib/owner-campaigns':'export const ownerCampaignSettings=async()=>({enabled:true});',
  '@/lib/salon-profile':'export const getSalonProfileMediaUrl=()=>null;',
  '@/lib/campaign-search-intent':'export const campaignSearchIntent=async()=>null;',
  '@/lib/campaign-delivery-area':'export const resolveCampaignDeliveryArea=async()=>null;',
  '@/lib/location/explore-gps-area':'export const resolveExploreGpsArea=async()=>({area:null});',
 };
 b.onResolve({filter:/.*/},a=>Object.hasOwn(stub,a.path)?{path:a.path,namespace:'stub'}:null);
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stub[a.path],loader:'js'}));
}}]});
const modules=await Promise.all(built.outputFiles.map(f=>import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'))));
const route=modules.find(m=>m.POST),tickets=modules.find(m=>m.signCampaignTicket);
function token(){return tickets.signCampaignTicket({id:'30000000-0000-0000-0000-000000000001',visitor:tickets.campaignVisitorHash('account:'+viewer),viewer,area:{country:'US',state:'WI',city:'Milwaukee'},expires:Date.now()+600000,nonce:'40000000-0000-0000-0000-000000000001'})}
const post=(body,origin='http://localhost')=>route.POST(new Request('http://localhost/api/campaigns/delivery',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
test('real delivery route authenticates signed clicks and routes them separately from billable views',async()=>{
 globalThis.testViewer=viewer;globalThis.testRpc=[];
 assert.deepEqual(await (await post({ticket:token(),kind:'click'})).json(),{ok:true});
 assert.equal(globalThis.testRpc[0].name,'owner_campaign_click');assert.equal('p_kind' in globalThis.testRpc[0].args,false);
 assert.deepEqual(await (await post({ticket:token(),kind:'view'})).json(),{ok:true});
 assert.equal(globalThis.testRpc[1].name,'owner_campaign_admit');assert.equal(globalThis.testRpc[1].args.p_kind,'view');
 assert.equal((await post({ticket:token(),kind:'click'},'https://evil.invalid')).status,403);
 assert.equal((await post({ticket:token()+'altered',kind:'click'})).status,403);
 globalThis.testViewer='00000000-0000-0000-0000-000000000003';
 assert.equal((await post({ticket:token(),kind:'click'})).status,403);
 assert.equal(globalThis.testRpc.length,2);
});
