import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const mock=`export const campaignSearchIntent=async()=>null;export const cookies=async()=>({get:()=>globalThis.campaignCookie?{value:globalThis.campaignCookie}:undefined});
 export const getCurrentBusinessContext=async()=>({user:globalThis.campaignUser?{id:globalThis.campaignUser}:null});
 export const advertisingClient=()=>({rpc:async(name,args)=>{globalThis.campaignAdmissions.push({name,args});return{data:true,error:null}}});
 export const ownerCampaignSettings=async()=>({enabled:true});export const getSalonProfileMediaUrl=()=>null;export const resolveExploreGpsArea=async()=>({area:null});`;
const bundle=await build({stdin:{contents:`export {POST} from './app/api/campaigns/delivery/route';export {signCampaignTicket,campaignVisitorHash} from './lib/owner-campaign-delivery';`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},define:{'process.env.ADVERTISING_IP_HASH_SECRET':'"local-fixture-secret-only"','process.env.VERCEL':'""','process.env.ADVERTISING_TRUSTED_IP_HEADER':'""'},plugins:[{name:'local-stubs',setup(b){
 b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'fixture'}));
 b.onResolve({filter:/^(next\/headers|@\/lib\/(campaign-search-intent|explore-advertising|current-context|owner-campaigns|salon-profile|location\/explore-gps-area))$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='empty'?'':mock,loader:'js'}));
}}]});
const {POST,signCampaignTicket,campaignVisitorHash}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('real signed tickets: scope, expiry, forgery and origin fail before admission; valid request passes once',async()=>{
 globalThis.campaignUser='member';globalThis.campaignCookie='00000000-0000-0000-0000-000000000001';globalThis.campaignAdmissions=[];
 const value={id:'campaign',visitor:campaignVisitorHash('account:member'),viewer:'member',area:{country:'US',state:'WI',city:'Milwaukee'},expires:Date.now()+600000,nonce:'nonce'};
 const send=(ticket,origin='https://local.test',kind='view')=>POST(new Request('https://local.test/api/campaigns/delivery',{method:'POST',headers:origin?{origin}:{},body:JSON.stringify({kind,ticket})}));
 for(const [label,ticket,origin,kind] of [
  ['expired',signCampaignTicket({...value,expires:Date.now()-1})],
  ['forged','X'+signCampaignTicket(value).slice(1)],
  ['other viewer',signCampaignTicket({...value,viewer:'another'})],
  ['other visitor',signCampaignTicket({...value,visitor:campaignVisitorHash('account:another')})],
  ['missing origin',signCampaignTicket(value),''],
  ['foreign origin',signCampaignTicket(value),'https://foreign.test'],
  ['invalid kind',signCampaignTicket(value),'https://local.test','charge'],
  ['oversized ticket','x'.repeat(9000)],
 ]){const r=await send(ticket,origin,kind);assert.ok(r.status>=400,label);assert.equal(globalThis.campaignAdmissions.length,0,label+' never reaches billing admission')}
 const signed=signCampaignTicket(value);globalThis.campaignUser=null;
 assert.equal((await send(signed)).status,403,'account ticket invalid after logout');assert.equal(globalThis.campaignAdmissions.length,0);
 globalThis.campaignUser='member';globalThis.campaignCookie=null;
 assert.equal((await send(signed)).status,403,'cookie missing');assert.equal(globalThis.campaignAdmissions.length,0);
 globalThis.campaignCookie='00000000-0000-0000-0000-000000000001';
 assert.deepEqual(await (await send(signed)).json(),{ok:true});assert.equal(globalThis.campaignAdmissions.length,1);
 assert.equal(globalThis.campaignAdmissions[0].name,'owner_campaign_admit');assert.deepEqual(globalThis.campaignAdmissions[0].args,{p_id:value.id,p_visitor:value.visitor,p_kind:'view',p_area:value.area,p_viewer:value.viewer,p_nonce:value.nonce});
});
